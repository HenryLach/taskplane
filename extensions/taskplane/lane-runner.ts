/**
 * Lane Runner — Headless per-lane execution for Runtime V2
 *
 * Replaces the legacy TMUX-backed lane execution path with a
 * deterministic Node process that owns:
 *   - worker iteration loops
 *   - STATUS.md progression
 *   - .DONE creation detection
 *   - reviewer orchestration (future)
 *   - lane snapshot emission
 *
 * No Pi extension dependency. No TMUX. No TASK_AUTOSTART.
 *
 * @module taskplane/lane-runner
 * @since TP-105
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

import {
	parsePromptMd,
	parseStatusMd,
	generateStatusMd,
	updateStatusField,
	updateStepStatus,
	logExecution,
	isStepComplete,
	type StepInfo,
	type CoreParsedTask,
} from "./task-executor-core.ts";

import { spawnAgent, type AgentHostOptions, type AgentHostResult } from "./agent-host.ts";

import {
	appendAgentEvent,
	writeLaneSnapshot,
} from "./process-registry.ts";

import {
	readOutbox,
	ackOutboxMessage,
	appendMailboxAuditEvent,
} from "./mailbox.ts";

import {
	resolvePacketPaths,
	buildRuntimeAgentId,
	runtimeAgentEventsPath,
	type ExecutionUnit,
	type RuntimeAgentId,
	type RuntimeLaneSnapshot,
	type RuntimeAgentTelemetrySnapshot,
	type RuntimeTaskProgress,
	type RuntimeAgentStatus,
	type PacketPaths,
	type LaneTaskOutcome,
	type LaneTaskStatus,
	type SupervisorAlertCallback,
} from "./types.ts";

const LANE_RUNNER_DIR = dirname(fileURLToPath(import.meta.url));

// ── Types ────────────────────────────────────────────────────────────

/**
 * Configuration for a lane-runner execution.
 *
 * @since TP-105
 */
export interface LaneRunnerConfig {
	/** Batch ID */
	batchId: string;
	/** Operator prefix for agent IDs (e.g., "orch-henrylach") */
	agentIdPrefix: string;
	/** Lane number (1-indexed) */
	laneNumber: number;
	/** Absolute path to the lane worktree */
	worktreePath: string;
	/** Git branch checked out in the worktree */
	branch: string;
	/** Repo ID */
	repoId: string;
	/** State root for runtime artifacts (workspace root or repo root) */
	stateRoot: string;
	/** Worker model (empty string = inherit from session) */
	workerModel: string;
	/** Worker tools */
	workerTools: string;
	/** Worker thinking mode */
	workerThinking: string;
	/** Worker system prompt */
	workerSystemPrompt: string;
	/** Max worker iterations before giving up */
	maxIterations: number;
	/** No-progress stall limit */
	noProgressLimit: number;
	/** Max worker time in minutes per iteration */
	maxWorkerMinutes: number;
	/** Context pressure warn threshold (0-100) */
	warnPercent: number;
	/** Context pressure kill threshold (0-100) */
	killPercent: number;
	/** Optional callback for surfacing runtime mailbox replies/escalations to supervisor */
	onSupervisorAlert?: SupervisorAlertCallback;
}

/**
 * Result of executing one task through the lane-runner.
 *
 * @since TP-105
 */
export interface LaneRunnerTaskResult {
	/** Standard lane task outcome compatible with the engine */
	outcome: LaneTaskOutcome;
	/** Total worker iterations consumed */
	iterations: number;
	/** Cumulative worker cost in USD */
	costUsd: number;
	/** Total tokens used */
	totalTokens: number;
}

// ── Core Execution ───────────────────────────────────────────────────

/**
 * Execute a single task in a lane using the Runtime V2 headless backend.
 *
 * This is the core function that replaces the legacy TMUX-backed
 * `executeLane()` → `spawnLaneSession()` → `task-runner TASK_AUTOSTART`
 * path with direct child-process hosting.
 *
 * Execution loop:
 *   1. Parse task and ensure STATUS.md exists
 *   2. For each iteration:
 *      a. Determine remaining steps
 *      b. Spawn worker agent via agent-host
 *      c. Wait for worker to exit
 *      d. Check progress (checkboxes)
 *      e. If all steps complete → success
 *      f. If no progress → increment stall counter
 *      g. If stall limit or iteration limit hit → fail
 *   3. If all steps complete, check for .DONE
 *   4. Return LaneTaskOutcome
 *
 * @since TP-105
 */
export async function executeTaskV2(
	unit: ExecutionUnit,
	config: LaneRunnerConfig,
	pauseSignal: { paused: boolean },
): Promise<LaneRunnerTaskResult> {
	const startTime = Date.now();
	const statusPath = unit.packet.statusPath;
	const donePath = unit.packet.donePath;
	const promptPath = unit.packet.promptPath;
	const taskFolder = unit.packet.taskFolder;
	const taskId = unit.taskId;
	const workerAgentId = buildRuntimeAgentId(config.agentIdPrefix, config.laneNumber, "worker");

	// ── 1. Ensure STATUS.md exists ──────────────────────────────────
	if (!existsSync(statusPath)) {
		const content = readFileSync(promptPath, "utf-8");
		const parsed = parsePromptMd(content, promptPath);
		writeFileSync(statusPath, generateStatusMd(parsed));
	}

	updateStatusField(statusPath, "Status", "🟡 In Progress");
	updateStatusField(statusPath, "Last Updated", new Date().toISOString().slice(0, 10));
	logExecution(statusPath, "Task started", "Runtime V2 lane-runner execution");

	// ── 2. Iteration loop ───────────────────────────────────────────
	let noProgressCount = 0;
	let totalIterations = 0;
	let cumulativeCostUsd = 0;
	let cumulativeTokens = 0;
	// TP-115: carry latest worker telemetry across iterations and into post-loop terminal snapshots
	let lastTelemetry: Partial<AgentHostResult> = {};

	for (let iter = 0; iter < config.maxIterations; iter++) {
		if (pauseSignal.paused) {
			logExecution(statusPath, "Paused", `User paused at iteration ${totalIterations}`);
			return makeResult(taskId, workerAgentId, "skipped", startTime,
				"Paused by user", false, totalIterations, cumulativeCostUsd, cumulativeTokens, config, statusPath);
		}

		// Determine remaining steps
		const currentStatus = parseStatusMd(readFileSync(statusPath, "utf-8"));
		const parsed = parsePromptMd(readFileSync(promptPath, "utf-8"), promptPath);
		const remainingSteps = parsed.steps.filter(step => {
			const ss = currentStatus.steps.find(s => s.number === step.number);
			return !isStepComplete(ss);
		});

		if (remainingSteps.length === 0) break; // All done

		totalIterations++;
		updateStatusField(statusPath, "Current Step", `Step ${remainingSteps[0].number}: ${remainingSteps[0].name}`);
		updateStatusField(statusPath, "Iteration", `${totalIterations}`);

		// Mark first incomplete step as in-progress
		const firstStep = remainingSteps[0];
		const firstStepStatus = currentStatus.steps.find(s => s.number === firstStep.number);
		if (firstStepStatus?.status !== "in-progress") {
			updateStepStatus(statusPath, firstStep.number, "in-progress");
			logExecution(statusPath, `Step ${firstStep.number} started`, firstStep.name);
		}

		// Count checkboxes before worker runs
		const prevTotalChecked = currentStatus.steps.reduce((sum, s) => sum + s.totalChecked, 0);

		// ── Build worker prompt ─────────────────────────────────────
		const wrapUpFile = join(taskFolder, ".task-wrap-up");
		if (existsSync(wrapUpFile)) try { unlinkSync(wrapUpFile); } catch { /* ignore */ }

		const promptLines = [
			`Read your task instructions at: ${promptPath}`,
			`Read your execution state at: ${statusPath}`,
			``,
			`Task: ${taskId}`,
			`Task folder: ${taskFolder}/`,
			`Iteration: ${totalIterations}`,
			`Wrap-up signal file: ${wrapUpFile}`,
			``,
			`⚠️ ORCHESTRATED RUN: Do NOT archive or move the task folder. The orchestrator handles post-merge archival.`,
		];

		if (totalIterations > 1 && remainingSteps.length > 0) {
			const remainingSet = new Set(remainingSteps.map(s => s.number));
			const completedSteps = parsed.steps.filter(s => !remainingSet.has(s.number));
			promptLines.push(
				``,
				`IMPORTANT: You exited previously without completing all steps.`,
				`Completed (do not redo): ${completedSteps.map(s => `Step ${s.number}: ${s.name}`).join(", ") || "(none)"}`,
				`Remaining (focus here): ${remainingSteps.map(s => `Step ${s.number}: ${s.name}`).join(", ")}`,
			);
		}

		// ── Spawn worker ────────────────────────────────────────────
		const eventsPath = runtimeAgentEventsPath(config.stateRoot, config.batchId, workerAgentId);

		const mailboxDir = join(config.stateRoot, ".pi", "mailbox", config.batchId, workerAgentId);
		mkdirSync(join(mailboxDir, "inbox"), { recursive: true });

		const steeringPendingPath = join(taskFolder, ".steering-pending");

		// TP-106: Bridge extension wiring for agent-side reply/escalate tools
		const outboxDir = join(config.stateRoot, ".pi", "mailbox", config.batchId, workerAgentId, "outbox");
		const bridgeExtensionPath = join(LANE_RUNNER_DIR, "agent-bridge-extension.ts");

		const hostOpts: AgentHostOptions = {
			agentId: workerAgentId,
			role: "worker",
			batchId: config.batchId,
			laneNumber: config.laneNumber,
			taskId,
			repoId: config.repoId,
			cwd: config.worktreePath,
			prompt: promptLines.join("\n"),
			systemPrompt: config.workerSystemPrompt || undefined,
			model: config.workerModel || undefined,
			tools: config.workerTools || "read,write,edit,bash,grep,find,ls",
			thinking: config.workerThinking || undefined,
			mailboxDir,
			steeringPendingPath,
			eventsPath,
			exitSummaryPath: eventsPath.replace(/\.jsonl$/, "-exit.json"),
			timeoutMs: config.maxWorkerMinutes * 60_000,
			stateRoot: config.stateRoot,
			packet: unit.packet,
			extensions: [bridgeExtensionPath],
			env: {
				TASKPLANE_OUTBOX_DIR: outboxDir,
				TASKPLANE_AGENT_ID: workerAgentId,
				ORCH_BATCH_ID: config.batchId,
			},
		};

		// Context pressure: write wrap-up signal before kill
		let workerKillReason: "context" | "timer" | null = null;

		const spawned = spawnAgent(hostOpts, undefined, (telemetry) => {
			// Context pressure check
			if (telemetry.contextUsage) {
				const pct = telemetry.contextUsage.percent;
				if (pct >= config.warnPercent) {
					const msg = `Wrap up (context ${Math.round(pct)}%)`;
					if (!existsSync(wrapUpFile)) writeFileSync(wrapUpFile, msg);
				}
				if (pct >= config.killPercent) {
					workerKillReason = "context";
					spawned.kill();
				}
			}

			lastTelemetry = telemetry;
			// Emit lane snapshot
			emitSnapshot(config, taskId, "running", telemetry, statusPath);
		});

		const workerResult = await spawned.promise;

		// TP-115: Update lastTelemetry with definitive final values from AgentHostResult
		lastTelemetry = workerResult;

		// Clean up wrap-up signal
		if (existsSync(wrapUpFile)) try { unlinkSync(wrapUpFile); } catch { /* ignore */ }

		// Accumulate costs
		cumulativeCostUsd += workerResult.costUsd;
		cumulativeTokens += workerResult.inputTokens + workerResult.outputTokens +
			workerResult.cacheReadTokens + workerResult.cacheWriteTokens;

		// ── TP-106: Poll worker outbox for replies/escalations ─────
		try {
			const outboxMessages = readOutbox(config.stateRoot, config.batchId, workerAgentId);
			for (const msg of outboxMessages) {
				const sanitized = msg.content.replace(/\r?\n/g, " / ").slice(0, 200);
				logExecution(statusPath, `Agent ${msg.type}`, sanitized);

				if (msg.type === "reply" || msg.type === "escalate") {
					appendAgentEvent(config.stateRoot, config.batchId, workerAgentId, {
						batchId: config.batchId,
						agentId: workerAgentId,
						role: "worker",
						laneNumber: config.laneNumber,
						taskId,
						repoId: config.repoId,
						ts: Date.now(),
						type: msg.type === "reply" ? "reply_sent" : "escalation_sent",
						payload: {
							messageId: msg.id,
							replyTo: msg.replyTo ?? null,
							content: sanitized,
						},
					});

					appendMailboxAuditEvent(config.stateRoot, config.batchId, {
						type: msg.type === "reply" ? "message_replied" : "message_escalated",
						from: workerAgentId,
						to: "supervisor",
						messageId: msg.id,
						messageType: msg.type,
						contentPreview: sanitized,
					});

					if (config.onSupervisorAlert) {
						const isEscalation = msg.type === "escalate";
						try {
							config.onSupervisorAlert({
								category: "agent-message",
								summary:
									`${isEscalation ? "🚨" : "📨"} Agent ${isEscalation ? "escalation" : "reply"} from ${workerAgentId}\n` +
									`  Task: ${taskId}\n` +
									`  Lane: lane-${config.laneNumber}\n` +
									`  Message: ${sanitized}`,
								context: {
									taskId,
									laneId: `lane-${config.laneNumber}`,
									laneNumber: config.laneNumber,
									agentId: workerAgentId,
									messageId: msg.id,
									exitReason: `${isEscalation ? "agent_escalation" : "agent_reply"}: ${sanitized}`,
								},
							});
						} catch { /* best effort */ }
					}
				}

				// Consume outbox message to prevent duplicate processing in later iterations.
				ackOutboxMessage(config.stateRoot, config.batchId, workerAgentId, msg.id);
			}
		} catch { /* best effort */ }

		// ── Steering annotation ─────────────────────────────────────
		try {
			if (existsSync(steeringPendingPath)) {
				const raw = readFileSync(steeringPendingPath, "utf-8");
				for (const line of raw.split("\n").filter(l => l.trim())) {
					try {
						const entry = JSON.parse(line) as { ts: number; content: string; id: string };
						const sanitized = entry.content.replace(/\r?\n/g, " / ").replace(/\|/g, "\\|").slice(0, 200);
						const ts = new Date(entry.ts).toISOString().slice(0, 16).replace("T", " ");
						logExecution(statusPath, "⚠️ Steering", sanitized);
					} catch { /* skip malformed */ }
				}
				unlinkSync(steeringPendingPath);
			}
		} catch { /* non-fatal */ }

		// Log iteration result
		const statusMsg = workerResult.killed
			? `killed (${workerKillReason === "context" ? "context limit" : "wall-clock timeout"})`
			: (workerResult.exitCode === 0 ? "done" : `error (code ${workerResult.exitCode})`);
		logExecution(statusPath, `Worker iter ${totalIterations}`,
			`${statusMsg} in ${Math.round(workerResult.durationMs / 1000)}s, tools: ${workerResult.toolCalls}`);

		// ── Check progress ──────────────────────────────────────────
		const afterStatus = parseStatusMd(readFileSync(statusPath, "utf-8"));
		const afterTotalChecked = afterStatus.steps.reduce((sum, s) => sum + s.totalChecked, 0);
		const progressDelta = afterTotalChecked - prevTotalChecked;

		if (progressDelta <= 0) {
			noProgressCount++;
			logExecution(statusPath, "No progress",
				`Iteration ${totalIterations}: 0 new checkboxes (${noProgressCount}/${config.noProgressLimit} stall limit)`);
			if (noProgressCount >= config.noProgressLimit) {
				logExecution(statusPath, "Task blocked", `No progress after ${noProgressCount} iterations`);
				return makeResult(taskId, workerAgentId, "failed", startTime,
					`No progress after ${noProgressCount} iterations`, false, totalIterations, cumulativeCostUsd, cumulativeTokens, config, statusPath, lastTelemetry);
			}
		} else {
			noProgressCount = 0;
		}

		// Mark completed steps
		for (const step of parsed.steps) {
			const ss = afterStatus.steps.find(s => s.number === step.number);
			if (isStepComplete(ss)) {
				updateStepStatus(statusPath, step.number, "complete");
			}
		}

		// Check if all steps are now complete
		const allComplete = parsed.steps.every(step => {
			const ss = afterStatus.steps.find(s => s.number === step.number);
			return isStepComplete(ss);
		});
		if (allComplete) break;
	}

	// ── 3. Post-loop completion check ───────────────────────────────
	const finalStatus = parseStatusMd(readFileSync(statusPath, "utf-8"));
	const parsed = parsePromptMd(readFileSync(promptPath, "utf-8"), promptPath);
	const allStepsComplete = parsed.steps.every(step => {
		const ss = finalStatus.steps.find(s => s.number === step.number);
		return isStepComplete(ss);
	});

	if (!allStepsComplete) {
		const incomplete = parsed.steps
			.filter(step => {
				const ss = finalStatus.steps.find(s => s.number === step.number);
				return !isStepComplete(ss);
			})
			.map(s => `Step ${s.number}`)
			.join(", ");
		logExecution(statusPath, "Task incomplete", `Max iterations reached. Incomplete: ${incomplete}`);
		return makeResult(taskId, workerAgentId, "failed", startTime,
			`Max iterations (${config.maxIterations}) reached with incomplete steps: ${incomplete}`,
			false, totalIterations, cumulativeCostUsd, cumulativeTokens, config, statusPath, lastTelemetry);
	}

	// Create .DONE if not already present
	if (!existsSync(donePath)) {
		writeFileSync(donePath, `Completed: ${new Date().toISOString()}\nTask: ${taskId}\n`);
	}
	updateStatusField(statusPath, "Status", "✅ Complete");
	logExecution(statusPath, "Task complete", ".DONE created");

	return makeResult(taskId, workerAgentId, "succeeded", startTime,
		".DONE file created by lane-runner", true, totalIterations, cumulativeCostUsd, cumulativeTokens, config, statusPath, lastTelemetry);
}

// ── Helpers ──────────────────────────────────────────────────────────

export function mapLaneTaskStatusToTerminalSnapshotStatus(
	status: LaneTaskStatus,
): "idle" | "complete" | "failed" {
	if (status === "succeeded") return "complete";
	if (status === "skipped") return "idle";
	return "failed";
}

export function mapLaneSnapshotStatusToWorkerStatus(
	status: "running" | "idle" | "complete" | "failed",
): RuntimeAgentStatus {
	if (status === "running") return "running";
	if (status === "complete") return "exited";
	if (status === "idle") return "wrapping_up";
	return "crashed";
}

function makeResult(
	taskId: string,
	sessionName: string,
	status: LaneTaskStatus,
	startTime: number,
	exitReason: string,
	doneFileFound: boolean,
	iterations: number,
	costUsd: number,
	totalTokens: number,
	config?: LaneRunnerConfig,
	statusPath?: string,
	finalTelemetry?: Partial<AgentHostResult>,
): LaneRunnerTaskResult {
	const result: LaneRunnerTaskResult = {
		outcome: {
			taskId,
			status,
			startTime,
			endTime: Date.now(),
			exitReason,
			sessionName,
			doneFileFound,
		},
		iterations,
		costUsd,
		totalTokens,
	};

	// TP-115: Emit terminal snapshot with real telemetry from agent-host result
	if (config && statusPath) {
		const terminalStatus = mapLaneTaskStatusToTerminalSnapshotStatus(status);
		emitSnapshot(config, taskId, terminalStatus, finalTelemetry ?? {}, statusPath);
	}

	return result;
}

function emitSnapshot(
	config: LaneRunnerConfig,
	taskId: string,
	status: "running" | "idle" | "complete" | "failed",
	telemetry: Partial<AgentHostResult>,
	statusPath: string,
): void {
	// Parse progress from STATUS.md
	let progress: RuntimeTaskProgress | null = null;
	try {
		const content = readFileSync(statusPath, "utf-8");
		const parsed = parseStatusMd(content);
		const currentStepMatch = content.match(/\*\*Current Step:\*\*\s*(.+)/);
		const checked = parsed.steps.reduce((sum, s) => sum + s.totalChecked, 0);
		const total = parsed.steps.reduce((sum, s) => sum + s.totalItems, 0);
		progress = {
			currentStep: currentStepMatch?.[1]?.trim() || "Unknown",
			checked,
			total,
			iteration: parsed.iteration,
			reviews: parsed.reviewCounter,
		};
	} catch { /* best effort */ }

	const snapshot: RuntimeLaneSnapshot = {
		batchId: config.batchId,
		laneNumber: config.laneNumber,
		laneId: `lane-${config.laneNumber}`,
		repoId: config.repoId,
		taskId,
		segmentId: null,
		status,
		worker: {
			agentId: buildRuntimeAgentId(config.agentIdPrefix, config.laneNumber, "worker"),
			status: mapLaneSnapshotStatusToWorkerStatus(status),
			elapsedMs: telemetry.durationMs ?? 0,
			toolCalls: telemetry.toolCalls ?? 0,
			contextPct: telemetry.contextUsage?.percent ?? 0,
			costUsd: telemetry.costUsd ?? 0,
			lastTool: telemetry.lastTool ?? "",
			inputTokens: telemetry.inputTokens ?? 0,
			outputTokens: telemetry.outputTokens ?? 0,
			cacheReadTokens: telemetry.cacheReadTokens ?? 0,
			cacheWriteTokens: telemetry.cacheWriteTokens ?? 0,
		},
		reviewer: null,
		progress,
		updatedAt: Date.now(),
	};

	writeLaneSnapshot(config.stateRoot, config.batchId, config.laneNumber, snapshot as any);
}

