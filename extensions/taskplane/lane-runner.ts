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
import { join, dirname, resolve, basename } from "path";
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
	/**
	 * Reviewer model (empty string = inherit session default).
	 * Set from TASKPLANE_REVIEWER_MODEL env var, sourced from runnerConfig.reviewer.model.
	 * @since TP-160
	 */
	reviewerModel: string;
	/**
	 * Reviewer thinking mode (empty string = inherit).
	 * @since TP-160
	 */
	reviewerThinking: string;
	/**
	 * Reviewer tool allowlist (comma-separated).
	 * @since TP-160
	 */
	reviewerTools: string;
	/** Supervisor autonomy level for bridge-tool guards. */
	supervisorAutonomy?: "interactive" | "supervised" | "autonomous";
	/** Project name (for review request context) */
	projectName?: string;
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
	const reviewerStatePath = join(taskFolder, ".reviewer-state.json");
	const taskId = unit.taskId;
	const segmentId = unit.segmentId;
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

	// Pre-segment guard: remove any stale .DONE from a prior segment or prior run.
	// This closes the race window where the monitor sees .DONE before lane-runner
	// can suppress it at segment end. For non-final segments, .DONE must not exist
	// at any point during execution.
	const isNonFinalAtStart = segmentId != null
		&& Array.isArray(unit.task.segmentIds)
		&& unit.task.segmentIds.length > 1
		&& unit.task.segmentIds[unit.task.segmentIds.length - 1] !== segmentId;
	if (isNonFinalAtStart && existsSync(donePath)) {
		try { unlinkSync(donePath); } catch { /* best effort */ }
		logExecution(statusPath, "Segment start", `Removed stale .DONE before non-final segment ${segmentId}`);
	}

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
			return makeResult(taskId, segmentId, workerAgentId, "skipped", startTime,
				"Paused by user", false, totalIterations, cumulativeCostUsd, cumulativeTokens, config, statusPath, reviewerStatePath);
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
			`Execution repo context:`,
			`- Execution repo ID: ${unit.executionRepoId}`,
			`- Execution worktree (worker cwd): ${unit.worktreePath}`,
			`- Lane repo ID: ${config.repoId}`,
			`- Active segment ID: ${segmentId ?? "(none / whole-task execution)"}`,
			``,
			`Packet home context:`,
			`- Packet home repo ID: ${unit.packetHomeRepoId}`,
			`- Packet task folder: ${taskFolder}`,
			`- Packet PROMPT path: ${promptPath}`,
			`- Packet STATUS path: ${statusPath}`,
			`- Packet .DONE path: ${donePath}`,
			`- Packet .reviews path: ${unit.packet.reviewsDir}`,
			``,
			`⚠️ ORCHESTRATED RUN: Do NOT archive or move the task folder. The orchestrator handles post-merge archival.`,
			``,
			`⚠️ CHECKPOINT RULE: After completing EACH checkbox item, immediately edit STATUS.md to check it off (- [ ] → - [x]) BEFORE starting the next item. Do NOT batch checkbox updates at the end of a step.`,
		];

		const segmentDag = unit.task.explicitSegmentDag;
		if (segmentDag && segmentDag.repoIds.length > 0) {
			const edgeSummary = segmentDag.edges.length > 0
				? segmentDag.edges.map(edge => `${edge.fromRepoId}->${edge.toRepoId}`).join(", ")
				: "(no explicit edges)";
			promptLines.push(
				``,
				`Segment DAG context (from PROMPT metadata):`,
				`- Repos: ${segmentDag.repoIds.join(", ")}`,
				`- Edges: ${edgeSummary}`,
			);
		}

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
			cwd: unit.worktreePath,
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
				TASKPLANE_TASK_FOLDER: taskFolder,
				TASKPLANE_STATUS_PATH: statusPath,
				TASKPLANE_PROMPT_PATH: promptPath,
				TASKPLANE_REVIEWS_DIR: unit.packet.reviewsDir,
				TASKPLANE_REVIEWER_STATE_PATH: reviewerStatePath,
				TASKPLANE_PROJECT_NAME: config.projectName || "project",
				TASKPLANE_TASK_ID: taskId,
				TASKPLANE_ACTIVE_SEGMENT_ID: segmentId ?? "",
				TASKPLANE_SUPERVISOR_AUTONOMY: config.supervisorAutonomy || "autonomous",
				ORCH_BATCH_ID: config.batchId,
				...(config.reviewerModel ? { TASKPLANE_REVIEWER_MODEL: config.reviewerModel } : {}),
				...(config.reviewerThinking ? { TASKPLANE_REVIEWER_THINKING: config.reviewerThinking } : {}),
				...(config.reviewerTools ? { TASKPLANE_REVIEWER_TOOLS: config.reviewerTools } : {}),
			},
		};

		// Context pressure: write wrap-up signal before kill
		let workerKillReason: "context" | "timer" | null = null;
		let iterationTelemetry: Partial<AgentHostResult> = {};

		const spawned = spawnAgent(hostOpts, undefined, (telemetry) => {
			try {
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

				iterationTelemetry = telemetry;
				lastTelemetry = telemetry;
				// Emit lane snapshot
				emitSnapshot(config, taskId, segmentId, "running", telemetry, statusPath, reviewerStatePath);
			} catch { /* non-fatal: telemetry callback must never crash the engine */ }
		});

		// Reviewer telemetry is written by the worker bridge during review_step.
		// Poll snapshot refresh independently from worker message_end cadence so
		// the dashboard sees reviewer activity while tool calls are in-flight.
		let reviewerSnapshotFailures = 0;
		const reviewerRefreshFailureThreshold = 5;
		const reviewerRefresh = setInterval(() => {
			const ok = emitSnapshot(config, taskId, segmentId, "running", iterationTelemetry, statusPath, reviewerStatePath);
			if (ok) {
				reviewerSnapshotFailures = 0;
				return;
			}

			reviewerSnapshotFailures += 1;
			if (reviewerSnapshotFailures >= reviewerRefreshFailureThreshold) {
				clearInterval(reviewerRefresh);
				logExecution(
					statusPath,
					"Snapshot refresh disabled",
					`Lane ${config.laneNumber}, task ${taskId}: ${reviewerSnapshotFailures} consecutive emitSnapshot failures`,
				);
			}
		}, 1000);

		let workerResult: AgentHostResult;
		try {
			workerResult = await spawned.promise;
		} finally {
			clearInterval(reviewerRefresh);
		}

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
				return makeResult(taskId, segmentId, workerAgentId, "failed", startTime,
					`No progress after ${noProgressCount} iterations`, false, totalIterations, cumulativeCostUsd, cumulativeTokens, config, statusPath, reviewerStatePath, lastTelemetry);
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
		return makeResult(taskId, segmentId, workerAgentId, "failed", startTime,
			`Max iterations (${config.maxIterations}) reached with incomplete steps: ${incomplete}`,
			false, totalIterations, cumulativeCostUsd, cumulativeTokens, config, statusPath, reviewerStatePath, lastTelemetry);
	}

	// TP-145: Determine if this is a non-final segment of a multi-segment task.
	// If more segments remain after this one, suppress .DONE creation so that
	// the engine can advance the segment frontier and execute subsequent segments.
	// .DONE must only exist when ALL segments of a multi-segment task are complete.
	const isNonFinalSegment = segmentId != null
		&& Array.isArray(unit.task.segmentIds)
		&& unit.task.segmentIds.length > 1
		&& unit.task.segmentIds[unit.task.segmentIds.length - 1] !== segmentId;

	if (isNonFinalSegment) {
		// Segment succeeded but more segments remain — suppress .DONE and "✅ Complete" status.
		// The engine will advance the frontier and dispatch the next segment.
		// Also delete any .DONE the worker may have created directly (workers have
		// write access and sometimes create .DONE on their own, bypassing this gate).
		if (existsSync(donePath)) {
			let deleted = false;
			try { unlinkSync(donePath); deleted = true; } catch { /* best effort */ }
			if (deleted) {
				logExecution(statusPath, "Segment complete",
					`Segment ${segmentId} succeeded (non-final — removed premature worker-created .DONE)`);
			} else {
				logExecution(statusPath, "Segment complete",
					`⚠️ Segment ${segmentId} succeeded but FAILED to remove premature .DONE — downstream segments may be skipped`);
			}
		} else {
			logExecution(statusPath, "Segment complete",
				`Segment ${segmentId} succeeded (not final — .DONE suppressed)`);
		}
		return makeResult(taskId, segmentId, workerAgentId, "succeeded", startTime,
			"Segment completed (non-final — .DONE suppressed)", false, totalIterations, cumulativeCostUsd, cumulativeTokens, config, statusPath, reviewerStatePath, lastTelemetry);
	}

	// Create .DONE if not already present (final segment or single-segment/whole-task execution)
	if (!existsSync(donePath)) {
		writeFileSync(donePath, `Completed: ${new Date().toISOString()}\nTask: ${taskId}\n`);
	}
	updateStatusField(statusPath, "Status", "✅ Complete");
	logExecution(statusPath, "Task complete", ".DONE created");

	return makeResult(taskId, segmentId, workerAgentId, "succeeded", startTime,
		".DONE file created by lane-runner", true, totalIterations, cumulativeCostUsd, cumulativeTokens, config, statusPath, reviewerStatePath, lastTelemetry);
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
	segmentId: string | null,
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
	reviewerStatePath?: string,
	finalTelemetry?: Partial<AgentHostResult>,
): LaneRunnerTaskResult {
	const telemetry = status === "skipped"
		? undefined
		: {
			inputTokens: finalTelemetry?.inputTokens ?? 0,
			outputTokens: finalTelemetry?.outputTokens ?? 0,
			cacheReadTokens: finalTelemetry?.cacheReadTokens ?? 0,
			cacheWriteTokens: finalTelemetry?.cacheWriteTokens ?? 0,
			costUsd: finalTelemetry?.costUsd ?? 0,
			toolCalls: finalTelemetry?.toolCalls ?? 0,
			durationMs: finalTelemetry?.durationMs ?? 0,
		};

	const result: LaneRunnerTaskResult = {
		outcome: {
			taskId,
			status,
			segmentId,
			startTime,
			endTime: Date.now(),
			exitReason,
			sessionName,
			doneFileFound,
			laneNumber: config?.laneNumber,
			telemetry,
		},
		iterations,
		costUsd,
		totalTokens,
	};

	// TP-115: Emit terminal snapshot with real telemetry from agent-host result
	if (config && statusPath && reviewerStatePath) {
		const terminalStatus = mapLaneTaskStatusToTerminalSnapshotStatus(status);
		emitSnapshot(config, taskId, segmentId, terminalStatus, finalTelemetry ?? {}, statusPath, reviewerStatePath);
	}

	return result;
}

/** Max age for reviewer state file before it's considered stale (2 minutes). */
const REVIEWER_STATE_STALE_MS = 120_000;

export function readReviewerTelemetrySnapshot(
	config: LaneRunnerConfig,
	reviewerStatePathOrStatusPath: string,
): (RuntimeAgentTelemetrySnapshot & { reviewType?: string; reviewStep?: number }) | null {
	const reviewerPath = basename(reviewerStatePathOrStatusPath).toLowerCase() === "status.md"
		? join(dirname(reviewerStatePathOrStatusPath), ".reviewer-state.json")
		: reviewerStatePathOrStatusPath;
	if (!existsSync(reviewerPath)) return null;

	try {
		const raw = readFileSync(reviewerPath, "utf-8");
		const parsed = JSON.parse(raw) as Partial<{
			status: string;
			elapsedMs: number;
			toolCalls: number;
			contextPct: number;
			costUsd: number;
			lastTool: string;
			inputTokens: number;
			outputTokens: number;
			cacheReadTokens: number;
			cacheWriteTokens: number;
			updatedAt: number;
			reviewType: string;
			reviewStep: number;
		}>;

		if (parsed.status !== "running") return null;

		// Stale guard: if updatedAt is present and older than threshold, ignore
		if (parsed.updatedAt && (Date.now() - parsed.updatedAt) > REVIEWER_STATE_STALE_MS) return null;

		return {
			agentId: buildRuntimeAgentId(config.agentIdPrefix, config.laneNumber, "reviewer"),
			status: "running",
			elapsedMs: Number.isFinite(parsed.elapsedMs) ? Number(parsed.elapsedMs) : 0,
			toolCalls: Number.isFinite(parsed.toolCalls) ? Number(parsed.toolCalls) : 0,
			contextPct: Number.isFinite(parsed.contextPct) ? Number(parsed.contextPct) : 0,
			costUsd: Number.isFinite(parsed.costUsd) ? Number(parsed.costUsd) : 0,
			lastTool: typeof parsed.lastTool === "string" ? parsed.lastTool : "",
			inputTokens: Number.isFinite(parsed.inputTokens) ? Number(parsed.inputTokens) : 0,
			outputTokens: Number.isFinite(parsed.outputTokens) ? Number(parsed.outputTokens) : 0,
			cacheReadTokens: Number.isFinite(parsed.cacheReadTokens) ? Number(parsed.cacheReadTokens) : 0,
			cacheWriteTokens: Number.isFinite(parsed.cacheWriteTokens) ? Number(parsed.cacheWriteTokens) : 0,
			reviewType: typeof parsed.reviewType === "string" ? parsed.reviewType : undefined,
			reviewStep: Number.isFinite(parsed.reviewStep) ? Number(parsed.reviewStep) : undefined,
		};
	} catch {
		return null;
	}
}

/**
 * Emit a lane snapshot to disk. NON-THROWING by contract — all errors are
 * caught and logged. This function is called from setInterval callbacks
 * and onTelemetry callbacks where an unhandled throw would trigger
 * uncaughtException and crash the engine-worker process.
 *
 * @returns true when snapshot write succeeds, false when it fails.
 */
function emitSnapshot(
	config: LaneRunnerConfig,
	taskId: string,
	segmentId: string | null,
	status: "running" | "idle" | "complete" | "failed",
	telemetry: Partial<AgentHostResult>,
	statusPath: string,
	reviewerStatePath: string,
): boolean {
	try {
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

		const reviewerSnapshot = readReviewerTelemetrySnapshot(config, reviewerStatePath);

		const snapshot: RuntimeLaneSnapshot = {
			batchId: config.batchId,
			laneNumber: config.laneNumber,
			laneId: `lane-${config.laneNumber}`,
			repoId: config.repoId,
			taskId,
			segmentId,
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
			reviewer: reviewerSnapshot,
			progress,
			updatedAt: Date.now(),
		};

		writeLaneSnapshot(config.stateRoot, config.batchId, config.laneNumber, snapshot as any);
		return true;
	} catch {
		// Non-fatal: snapshot is telemetry, not execution-critical.
		// Swallow to prevent uncaughtException crash in setInterval/callback contexts.
		return false;
	}
}

