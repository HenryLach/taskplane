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

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from "fs";
import { join, dirname, resolve, basename } from "path";
import { execSync } from "child_process";
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
import { loadPiSettingsPackages, filterExcludedExtensions } from "./settings-loader.ts";

import {
	appendAgentEvent,
	writeLaneSnapshot,
} from "./process-registry.ts";

import {
	readOutbox,
	readInbox,
	ackMessage,
	sessionInboxDir,
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
	type RuntimeLaneSubmoduleDiagnostics,
	type RuntimeAgentTelemetrySnapshot,
	type RuntimeTaskProgress,
	type RuntimeAgentStatus,
	type RuntimeSubmoduleSnapshot,
	type PacketPaths,
	type LaneTaskOutcome,
	type LaneTaskStatus,
	type SupervisorAlertCallback,
	type StepSegmentMapping,
} from "./types.ts";

import { captureSubmoduleStatusSnapshot } from "./git.ts";
import { classifyExit, type TaskExitDiagnostic } from "./diagnostics.ts";

const LANE_RUNNER_DIR = dirname(fileURLToPath(import.meta.url));

export function readGitHead(cwd: string): string | null {
	try {
		return execSync("git rev-parse HEAD", {
			cwd,
			timeout: 5000,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim() || null;
	} catch {
		return null;
	}
}

export function detectSoftProgress(
	worktreePath: string,
	previousHead: string | null,
): { hasProgress: boolean; reason: string | null } {
	const currentHead = readGitHead(worktreePath);
	if (previousHead && currentHead && previousHead !== currentHead) {
		return {
			hasProgress: true,
			reason: `HEAD advanced from ${previousHead.slice(0, 8)} to ${currentHead.slice(0, 8)}`,
		};
	}

	try {
		const diffOutput = execSync("git diff --stat HEAD", {
			cwd: worktreePath,
			timeout: 5000,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		const changedFiles = diffOutput.split("\n").filter(line => line.includes("|"));
		const sourceChanges = changedFiles.filter(line => !line.includes("STATUS.md") && !line.includes(".steering"));
		if (sourceChanges.length > 0) {
			return {
				hasProgress: true,
				reason: `uncommitted worktree changes in ${sourceChanges.length} file(s)`,
			};
		}
	} catch {
		// Treat command failures as no soft progress.
	}

	return { hasProgress: false, reason: null };
}

export function getStatusProgressTotals(statusContent: string): { checked: number; total: number } {
	const parsed = parseStatusMd(statusContent);
	return {
		checked: parsed.steps.reduce((sum, step) => sum + step.totalChecked, 0),
		total: parsed.steps.reduce((sum, step) => sum + step.totalItems, 0),
	};
}

function readLastKnownProgress(statusPath?: string): { lastKnownStep: number | null; lastKnownCheckbox: string | null } {
	if (!statusPath || !existsSync(statusPath)) {
		return { lastKnownStep: null, lastKnownCheckbox: null };
	}

	try {
		const parsed = parseStatusMd(readFileSync(statusPath, "utf-8"));
		const lastStep = parsed.steps[parsed.steps.length - 1] ?? null;
		const lastCheckbox = lastStep?.checkboxes[lastStep.checkboxes.length - 1] ?? null;
		return {
			lastKnownStep: lastStep?.number ?? null,
			lastKnownCheckbox: lastCheckbox?.text ?? null,
		};
	} catch {
		return { lastKnownStep: null, lastKnownCheckbox: null };
	}
}

function detectUnsafeSubmoduleKind(exitReason: string): "dirty-worktree" | "unpublished-commit" | "unreachable-ref" | null {
	if (/submodule_unreachable_ref/i.test(exitReason) || /unreachable gitlink refs/i.test(exitReason)) {
		return "unreachable-ref";
	}
	if (/Unsafe submodule state after task success:/i.test(exitReason)) {
		if (/has uncommitted submodule changes/i.test(exitReason)) {
			return "dirty-worktree";
		}
		if (/points to local commit .* not reachable on /i.test(exitReason)) {
			return "unpublished-commit";
		}
	}
	return null;
}

export function buildLaneExitDiagnostic(
	status: LaneTaskStatus,
	exitReason: string,
	doneFileFound: boolean,
	finalTelemetry?: Partial<AgentHostResult>,
	statusPath?: string,
	repoId = "default",
): TaskExitDiagnostic | undefined {
	if (status === "skipped") return undefined;

	const stallDetected = /No progress after \d+ iterations?/i.test(exitReason);
	const timerKilled = /wall-clock timeout/i.test(exitReason);
	const contextKilled = /context limit/i.test(exitReason);
	const userKilled = /paused by user|aborted by user|killed by user/i.test(exitReason);
	const unsafeSubmoduleKind = detectUnsafeSubmoduleKind(exitReason);
	const telemetryExitCode = finalTelemetry?.exitCode ?? null;
	const syntheticExitCode = stallDetected
		? 0
		: (telemetryExitCode ?? (status === "failed" ? 1 : 0));
	const syntheticSummary = {
		exitCode: syntheticExitCode,
		exitSignal: finalTelemetry?.signal ?? null,
		tokens: {
			input: finalTelemetry?.inputTokens ?? 0,
			output: finalTelemetry?.outputTokens ?? 0,
			cacheRead: finalTelemetry?.cacheReadTokens ?? 0,
			cacheWrite: finalTelemetry?.cacheWriteTokens ?? 0,
		},
		cost: finalTelemetry?.costUsd ?? 0,
		toolCalls: finalTelemetry?.toolCalls ?? 0,
		retries: [],
		compactions: finalTelemetry?.compactions ?? 0,
		durationSec: Math.max(0, Math.round((finalTelemetry?.durationMs ?? 0) / 1000)),
		lastToolCall: finalTelemetry?.lastTool ?? null,
		error: status === "failed"
			? (finalTelemetry?.error ?? exitReason)
			: (finalTelemetry?.error ?? null),
	};
	const classification = classifyExit({
		exitSummary: syntheticSummary,
		doneFileFound: doneFileFound || status === "succeeded",
		timerKilled,
		contextKilled,
		unsafeSubmoduleKind,
		stallDetected,
		userKilled,
		contextPct: finalTelemetry?.contextUsage?.percent ?? null,
	});
	const { lastKnownStep, lastKnownCheckbox } = readLastKnownProgress(statusPath);

	return {
		classification,
		exitCode: syntheticExitCode,
		errorMessage: status === "failed"
			? (finalTelemetry?.error ?? exitReason)
			: (finalTelemetry?.error ?? null),
		tokensUsed: syntheticSummary.tokens,
		contextPct: finalTelemetry?.contextUsage?.percent ?? null,
		partialProgressCommits: 0,
		partialProgressBranch: null,
		durationSec: syntheticSummary.durationSec,
		lastKnownStep,
		lastKnownCheckbox,
		repoId,
	};
}

// ── Segment Scoping Helpers (Phase A, TP-174) ────────────────────────

/**
 * Get the set of step numbers that have segments for a given repoId.
 *
 * Used to filter the "remaining steps" view so the worker only sees steps
 * that contain work for its repo.
 *
 * @param stepSegmentMap - Parsed step-segment mapping from PROMPT.md
 * @param repoId - Repo ID to filter by
 * @returns Set of step numbers that have at least one segment for this repoId
 * @since TP-174
 */
export function getStepsForRepoId(
	stepSegmentMap: StepSegmentMapping[],
	repoId: string,
): Set<number> {
	const stepNumbers = new Set<number>();
	for (const step of stepSegmentMap) {
		if (step.segments.some(seg => seg.repoId === repoId)) {
			stepNumbers.add(step.stepNumber);
		}
	}
	return stepNumbers;
}

/**
 * Extract a segment's checkbox block from STATUS.md content for a given step and repoId.
 *
 * Looks for `#### Segment: <repoId>` headers within `### Step N:` sections,
 * then returns the checkbox lines belonging to that segment block.
 *
 * @param statusContent - Raw STATUS.md content
 * @param stepNumber - Step number to look in
 * @param repoId - Repo ID of the segment
 * @returns Object with checked/unchecked counts, or null if no segment block found
 * @since TP-174
 */
export function getSegmentCheckboxes(
	statusContent: string,
	stepNumber: number,
	repoId: string,
): { checked: number; unchecked: number; total: number; uncheckedTexts: string[] } | null {
	const text = statusContent.replace(/\r\n/g, "\n");

	// Find the step section
	const stepHeaderPattern = new RegExp(`^#{2,6}\\s+Step\\s+${stepNumber}(?::\\s*|\\s+)`, "m");
	const stepMatch = text.match(stepHeaderPattern);
	if (!stepMatch || stepMatch.index === undefined) return null;

	// Find the end of this step section (next ### or end of file)
	const afterStep = text.slice(stepMatch.index + stepMatch[0].length);
	const nextStepMatch = afterStep.search(/^#{2,6}\s+Step\s+\d+(?::\s*|\s+)/m);
	const stepContent = nextStepMatch !== -1 ? afterStep.slice(0, nextStepMatch) : afterStep;

	// Find the segment header within this step
	const segHeaderPattern = new RegExp(`^####\\s+Segment:\\s*${repoId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
	const segMatch = stepContent.match(segHeaderPattern);
	if (!segMatch || segMatch.index === undefined) return null;

	// Extract content from segment header to next #### header or ### header or ---
	const afterSeg = stepContent.slice(segMatch.index + segMatch[0].length);
	const nextSectionMatch = afterSeg.search(/^(?:####\s|###\s|##\s|---)/m);
	const segContent = nextSectionMatch !== -1 ? afterSeg.slice(0, nextSectionMatch) : afterSeg;

	// Count checkboxes
	let checked = 0;
	let unchecked = 0;
	const uncheckedTexts: string[] = [];
	const cbRegex = /^\s*-\s*\[([ xX])\]\s*(.*)/gm;
	let m;
	while ((m = cbRegex.exec(segContent)) !== null) {
		if (m[1].toLowerCase() === "x") {
			checked++;
		} else {
			unchecked++;
			uncheckedTexts.push(m[2].trim());
		}
	}

	return { checked, unchecked, total: checked + unchecked, uncheckedTexts };
}

/**
 * Check if all checkboxes in a segment block are checked.
 *
 * @param statusContent - Raw STATUS.md content
 * @param stepNumber - Step number to check
 * @param repoId - Repo ID of the segment
 * @returns true when all checkboxes in the segment block are checked
 * @since TP-174
 */
export function isSegmentComplete(
	statusContent: string,
	stepNumber: number,
	repoId: string,
): boolean {
	const result = getSegmentCheckboxes(statusContent, stepNumber, repoId);
	if (!result) return false;
	if (result.total === 0) return false;
	return result.unchecked === 0;
}

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
	/** Repo ID -> absolute path map for all repos participating in the task. */
	repoPaths?: Record<string, string>;
	/** State root for runtime artifacts (workspace root or repo root) */
	stateRoot: string;
	/** Worker model (empty string = inherit from session) */
	workerModel: string;
	/** Worker tools */
	workerTools: string;
	/** Worker thinking mode */
	workerThinking: string;
	/** Worker system prompt (full-task mode) */
	workerSystemPrompt: string;
	/** Worker system prompt for segment-scoped mode (appended to base) */
	workerSegmentPrompt: string;
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
	/** Package specifiers to exclude from worker extension forwarding (exact match). @since TP-180 */
	workerExcludeExtensions?: string[];
	/** Package specifiers to exclude from reviewer extension forwarding (exact match). @since TP-180 */
	reviewerExcludeExtensions?: string[];
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
	const submoduleDiagnostics: RuntimeLaneSubmoduleDiagnostics = {
		preTask: captureTaskSubmoduleSnapshot(taskId, "pre-task", config.worktreePath),
	};

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

	// TP-174: Build segment context once for emitSnapshot calls.
	// Available outside the loop so it can be passed to makeResult too.
	const snapshotSegmentCtx: { stepSegmentMap: StepSegmentMapping[]; repoId: string } | null =
		(segmentId && unit.task.stepSegmentMap && config.repoId)
			? (() => {
				const repoSteps = getStepsForRepoId(unit.task.stepSegmentMap!, config.repoId);
				return repoSteps.size > 0
					? { stepSegmentMap: unit.task.stepSegmentMap!, repoId: config.repoId }
					: null;
			})()
			: null;

	emitSnapshot(config, taskId, segmentId, "running", {}, statusPath, reviewerStatePath, snapshotSegmentCtx, submoduleDiagnostics);

	for (let iter = 0; iter < config.maxIterations; iter++) {
		if (pauseSignal.paused) {
			logExecution(statusPath, "Paused", `User paused at iteration ${totalIterations}`);
			return makeResult(taskId, segmentId, workerAgentId, "skipped", startTime,
				"Paused by user", false, totalIterations, cumulativeCostUsd, cumulativeTokens, config, statusPath, reviewerStatePath, undefined, submoduleDiagnostics, snapshotSegmentCtx);
		}

		// Determine remaining steps
		const currentStatus = parseStatusMd(readFileSync(statusPath, "utf-8"));
		const parsed = parsePromptMd(readFileSync(promptPath, "utf-8"), promptPath);

		// TP-174: Resolve segment-scoped step filtering.
		// Use config.repoId (structured identity) instead of parsing opaque segmentId.
		const stepSegmentMap = unit.task.stepSegmentMap;
		const currentRepoId = segmentId ? config.repoId : null;
		const rawRepoStepNumbers = (stepSegmentMap && currentRepoId)
			? getStepsForRepoId(stepSegmentMap, currentRepoId)
			: null;
		// TP-174 legacy fallback: If no steps have segments for this repoId
		// (multi-segment task without explicit markers, where all checkboxes
		// are assigned to the fallback/packet repo), disable segment filtering.
		const repoStepNumbers = (rawRepoStepNumbers && rawRepoStepNumbers.size > 0)
			? rawRepoStepNumbers
			: null;

		// TP-174: Read STATUS.md content once for segment-scoped checks
		const iterStatusContent = readFileSync(statusPath, "utf-8");

		const remainingSteps = parsed.steps.filter(step => {
			// TP-174: When segment-scoped, only show steps that have work for this repoId
			if (repoStepNumbers && !repoStepNumbers.has(step.number)) return false;
			// TP-174: Use segment-scoped completion check in segment mode
			if (repoStepNumbers && currentRepoId) {
				return !isSegmentComplete(iterStatusContent, step.number, currentRepoId);
			}
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
		// TP-174: When segment-scoped, count only this segment's checkboxes
		let prevTotalChecked: number;
		if (repoStepNumbers && currentRepoId) {
			const preStatusContent = readFileSync(statusPath, "utf-8");
			const segCbs = getSegmentCheckboxes(preStatusContent, firstStep.number, currentRepoId);
			prevTotalChecked = segCbs ? segCbs.checked : 0;
		} else {
			prevTotalChecked = currentStatus.steps.reduce((sum, s) => sum + s.totalChecked, 0);
		}
		const prevHeadCommit = readGitHead(unit.worktreePath);

		// ── Build worker prompt ─────────────────────────────────────
		const wrapUpFile = join(taskFolder, ".task-wrap-up");
		if (existsSync(wrapUpFile)) try { unlinkSync(wrapUpFile); } catch { /* ignore */ }

		// TP-174/TP-501: Compute segment scope mode BEFORE building prompt.
		const isSegmentScoped = !!(stepSegmentMap && currentRepoId && repoStepNumbers
			&& remainingSteps.length > 0
			&& stepSegmentMap.find(s => s.stepNumber === remainingSteps[0].number)
				?.segments.find(seg => seg.repoId === currentRepoId));

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
			// Only show segment ID when segment-scoped. For FULL_TASK, omit to avoid
			// workers incorrectly self-scoping based on segment metadata.
			...(isSegmentScoped
				? [`- Active segment ID: ${segmentId}`]
				: []),
			``,
			`Task repo map:`,
			...Object.entries(config.repoPaths ?? unit.repoPaths)
				.sort((a, b) => a[0].localeCompare(b[0]))
				.map(([repoId, repoPath]) => `- ${repoId}: ${repoPath}`),
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

		// Only show segment DAG in segment-scoped mode
		const segmentDag = isSegmentScoped ? unit.task.explicitSegmentDag : null;
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

		// Segment scope mode is determined by which system prompt was loaded.
		// No SegmentScopeMode line needed — the prompt IS the mode.

		// TP-174: Segment-scoped prompt — show only this segment's checkboxes
		if (stepSegmentMap && currentRepoId && repoStepNumbers && remainingSteps.length > 0) {
			const currentStepNum = remainingSteps[0].number;
			const currentStepMapping = stepSegmentMap.find(s => s.stepNumber === currentStepNum);
			const mySegment = currentStepMapping?.segments.find(seg => seg.repoId === currentRepoId);

			// Only inject segment-scoped prompt when the current step has an explicit
			// segment for this repoId. If mySegment is missing (legacy task without
			// markers, or step has no work for this repo), skip and preserve legacy behavior.
			if (currentStepMapping && mySegment) {
				const otherSegments = currentStepMapping.segments.filter(seg => seg.repoId !== currentRepoId);

				// Count total segments for this repo across all steps
				const totalStepsForRepo = repoStepNumbers ? repoStepNumbers.size : 0;
				const segmentIndexInStep = currentStepMapping.segments.findIndex(seg => seg.repoId === currentRepoId) + 1;
				const totalSegmentsInStep = currentStepMapping.segments.length;

				promptLines.push(
					``,
					`Segment-scoped context (Phase A):`,
					`Active segment: ${segmentId} (Step ${currentStepNum}, segment ${segmentIndexInStep} of ${totalSegmentsInStep})`,
					`Your repo: ${currentRepoId}`,
					``,
				);

				if (mySegment && mySegment.checkboxes.length > 0) {
					promptLines.push(`Your checkboxes for this step:`);
					for (const cb of mySegment.checkboxes) {
						promptLines.push(`  ${cb}`);
					}
				}

				if (otherSegments.length > 0) {
					promptLines.push(``);
					promptLines.push(`Other segments in this step (NOT yours — do not attempt):`);
					for (const seg of otherSegments) {
						promptLines.push(`  - ${seg.repoId}: ${seg.checkboxes.length} checkbox(es) (will run in a separate segment)`);
					}
				}

				// List completed steps for this repo
				const completedForRepo = parsed.steps.filter(step => {
					if (!repoStepNumbers || !repoStepNumbers.has(step.number)) return false;
					const ss = currentStatus.steps.find(s => s.number === step.number);
					return isStepComplete(ss);
				});
				if (completedForRepo.length > 0) {
					promptLines.push(``);
					promptLines.push(`Prior steps completed: ${completedForRepo.map(s => `Step ${s.number} (${s.name})`).join(", ")}`);
				}

				promptLines.push(
					``,
					`When all YOUR checkboxes are checked, your segment is done — exit successfully.`,
					`Do NOT attempt work in other repos.`,
				);
			}
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

			// If the worker exited without checking any boxes, add a corrective directive
			if (noProgressCount > 0) {
				promptLines.push(
					``,
					`🚨 CRITICAL: You have exited ${noProgressCount} time(s) without completing work.`,
					`Your previous exit was premature. You said something like "Now let me fix this"`,
					`and then STOPPED instead of actually making the edit.`,
					``,
					`DO NOT DO THIS AGAIN. When you know what to edit, call the edit tool IMMEDIATELY.`,
					`Do not produce a text message describing what you plan to do. Just do it.`,
					`Work continuously through ALL remaining checkboxes until the task is DONE.`,
					`Do not exit between checkboxes or steps.`,
				);
			}
		}

		// ── Spawn worker ────────────────────────────────────────────
		const eventsPath = runtimeAgentEventsPath(config.stateRoot, config.batchId, workerAgentId);

		const mailboxDir = join(config.stateRoot, ".pi", "mailbox", config.batchId, workerAgentId);
		mkdirSync(join(mailboxDir, "inbox"), { recursive: true });

		const steeringPendingPath = join(taskFolder, ".steering-pending");

		// TP-106: Bridge extension wiring for agent-side reply/escalate tools
		const outboxDir = join(config.stateRoot, ".pi", "mailbox", config.batchId, workerAgentId, "outbox");
		const bridgeExtensionPath = join(LANE_RUNNER_DIR, "agent-bridge-extension.ts");

		// TP-180: Forward user-installed extensions to worker agent
		const allPackages = loadPiSettingsPackages(config.stateRoot);
		const workerPackages = filterExcludedExtensions(allPackages, config.workerExcludeExtensions ?? []);

		const hostOpts: AgentHostOptions = {
			agentId: workerAgentId,
			role: "worker",
			batchId: config.batchId,
			laneNumber: config.laneNumber,
			taskId,
			repoId: config.repoId,
			cwd: unit.worktreePath,
			prompt: promptLines.join("\n"),
			systemPrompt: (isSegmentScoped && config.workerSegmentPrompt
				? config.workerSystemPrompt + "\n\n---\n\n" + config.workerSegmentPrompt
				: config.workerSystemPrompt) || undefined,
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
			extensions: [bridgeExtensionPath, ...workerPackages],
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
				TASKPLANE_REPO_PATHS: JSON.stringify(config.repoPaths ?? unit.repoPaths),
				// Hard-set segment env vars based on mode. In FULL_TASK mode,
				// explicitly clear them to prevent env inheritance leaking segment cues.
				TASKPLANE_ACTIVE_SEGMENT_ID: isSegmentScoped ? (segmentId ?? "") : "",
				TASKPLANE_SEGMENT_ID: isSegmentScoped ? (segmentId ?? "") : "",
				TASKPLANE_SUPERVISOR_AUTONOMY: config.supervisorAutonomy || "autonomous",
				ORCH_BATCH_ID: config.batchId,
				...(config.reviewerModel ? { TASKPLANE_REVIEWER_MODEL: config.reviewerModel } : {}),
				...(config.reviewerThinking ? { TASKPLANE_REVIEWER_THINKING: config.reviewerThinking } : {}),
				...(config.reviewerTools ? { TASKPLANE_REVIEWER_TOOLS: config.reviewerTools } : {}),
				// TP-180: Pass state root and reviewer exclusions for extension forwarding
				TASKPLANE_STATE_ROOT: config.stateRoot,
				...(config.reviewerExcludeExtensions && config.reviewerExcludeExtensions.length > 0
					? { TASKPLANE_REVIEWER_EXCLUDE_EXTENSIONS: JSON.stringify(config.reviewerExcludeExtensions) }
					: {}),
			},
			// TP-172: Exit interception callback — escalate to supervisor when worker
			// exits without making visible progress (no checkboxes, no blocker logged).
			onPrematureExit: config.onSupervisorAlert
				? async (assistantMessage: string): Promise<string | null> => {
					// Check if the worker made visible progress during this turn:
					// 1. Checkbox progress (more items checked)
					// 2. Blocker logged (non-empty Blockers section)
					try {
						const statusContent = readFileSync(statusPath, "utf-8");
						// TP-174: Use same scope as prevTotalChecked (segment or global)
						let midTotalChecked: number;
						if (repoStepNumbers && currentRepoId) {
							const segCbs = getSegmentCheckboxes(statusContent, firstStep.number, currentRepoId);
							midTotalChecked = segCbs ? segCbs.checked : 0;
						} else {
							midTotalChecked = getStatusProgressTotals(statusContent).checked;
						}
						if (midTotalChecked > prevTotalChecked) {
							// Worker checked off checkboxes — let it exit normally
							return null;
						}
						const softProgress = detectSoftProgress(unit.worktreePath, prevHeadCommit);
						if (softProgress.hasProgress) {
							return null;
						}
						// Check for blocker entries: extract Blockers section and see if non-empty
						const blockerMatch = statusContent.match(/## Blockers\s*\n([\s\S]*?)(?:\n---|-$)/i);
						if (blockerMatch) {
							const blockerContent = blockerMatch[1].trim();
							// If blockers section has real content (not just "*None*" or empty)
							if (blockerContent && blockerContent !== "*None*") {
								// Worker logged a blocker — let it exit normally
								return null;
							}
						}
				// Check if task is fully complete — all checkboxes checked across all steps.
				// This handles tasks already completed by prior batch runs where no new
				// checkboxes need to be marked, but the worker legitimately finished.
				let totalChecked: number;
				if (repoStepNumbers && currentRepoId) {
					const segCbs = getSegmentCheckboxes(statusContent, firstStep.number, currentRepoId);
					totalChecked = segCbs ? segCbs.checked : 0;
				} else {
					totalChecked = getStatusProgressTotals(statusContent).checked;
				}
				let totalSteps: number;
				if (repoStepNumbers && currentRepoId) {
					const segCbs = getSegmentCheckboxes(statusContent, firstStep.number, currentRepoId);
					totalSteps = segCbs ? segCbs.total : 0;
				} else {
					totalSteps = getStatusProgressTotals(statusContent).total;
				}
				if (totalSteps > 0 && totalChecked >= totalSteps) {
					// All task items are checked — worker completed an already-done or just-completed task.
					return null;
				}
					} catch { /* If we can't read STATUS.md, proceed with escalation */ }

					// No visible progress — compose escalation message
					const truncatedMsg = assistantMessage.slice(0, 500);
					const uncheckedItems: string[] = [];
					try {
						const statusContent = readFileSync(statusPath, "utf-8");
						// TP-174: When segment-scoped, report only this segment's unchecked items
						if (repoStepNumbers && currentRepoId) {
							const segCbs = getSegmentCheckboxes(statusContent, firstStep.number, currentRepoId);
							if (segCbs) {
								for (const text of segCbs.uncheckedTexts.slice(0, 5)) {
									uncheckedItems.push(text);
								}
							}
						} else {
							const uncheckedMatches = statusContent.match(/^- \[ \] .+$/gm);
							if (uncheckedMatches) {
								for (const item of uncheckedMatches.slice(0, 5)) {
									uncheckedItems.push(item.replace(/^- \[ \] /, "").trim());
								}
							}
						}
					} catch { /* best effort */ }

					const currentStepInfo = remainingSteps.length > 0
						? `Step ${remainingSteps[0].number}: ${remainingSteps[0].name}`
						: "Unknown";

					// Fire supervisor alert
					try {
						config.onSupervisorAlert!({
							category: "worker-exit-intercept",
							summary:
								`🔄 Worker on lane ${config.laneNumber} wants to exit with no progress.\n` +
								`  Task: ${taskId}\n` +
								`  Current step: ${currentStepInfo}\n` +
								`  Iteration: ${totalIterations}, No-progress count: ${noProgressCount + 1}\n` +
								`  Unchecked items: ${uncheckedItems.length > 0 ? uncheckedItems.join("; ") : "(none found)"}\n` +
								`  Worker said: "${truncatedMsg}"\n` +
								`\nSend a steering message to ${workerAgentId} with targeted instructions,` +
								` or reply "skip" / "let it fail" to close the session.`,
							context: {
								taskId,
								laneId: `lane-${config.laneNumber}`,
								laneNumber: config.laneNumber,
								agentId: workerAgentId,
								exitReason: `worker_exit_no_progress: ${truncatedMsg.slice(0, 200)}`,
							},
						});
					} catch { /* best effort — don't block on alert failure */ }

					// Poll worker mailbox inbox for supervisor reply (60s timeout)
					const SUPERVISOR_REPLY_TIMEOUT_MS = 60_000;
					const POLL_INTERVAL_MS = 2_000;
					const escalationTimestamp = Date.now();
					const inboxDir = sessionInboxDir(config.stateRoot, config.batchId, workerAgentId);

					const supervisorReply = await new Promise<string | null>((resolve) => {
						const deadline = Date.now() + SUPERVISOR_REPLY_TIMEOUT_MS;
						const poll = () => {
							if (Date.now() >= deadline) {
								resolve(null); // Timeout — fall back to corrective re-spawn
								return;
							}
							try {
								const messages = readInbox(inboxDir, config.batchId);
								// Only accept messages newer than escalation timestamp
								for (const { filename, message } of messages) {
									if (message.timestamp >= escalationTimestamp && message.from === "supervisor") {
										// Consume the message
										const ackDir = join(dirname(inboxDir), "ack");
										try { ackMessage(inboxDir, filename); } catch { /* best effort */ }
										resolve(message.content);
										return;
									}
								}
							} catch { /* inbox not ready yet */ }
							setTimeout(poll, POLL_INTERVAL_MS);
						};
						poll();
					});

					if (!supervisorReply) {
						// Timeout — let the session close, corrective re-spawn will handle it
						logExecution(statusPath, "Exit intercept timeout",
							`Supervisor did not respond within ${SUPERVISOR_REPLY_TIMEOUT_MS / 1000}s — closing session`);
						return null;
					}

					// Interpret supervisor reply: close directives vs instructional content
					const normalizedReply = supervisorReply.trim().toLowerCase();
					const CLOSE_DIRECTIVES = ["skip", "let it fail", "close", "abort", "stop"];
					// Only short messages (< 30 chars) can be close directives.
					// Longer messages are always instructions even if they start with "stop".
					const isShortEnoughForDirective = normalizedReply.length < 30;
					if (isShortEnoughForDirective && CLOSE_DIRECTIVES.some(d =>
						normalizedReply === d ||
						normalizedReply.startsWith(d + ":") ||
						normalizedReply.startsWith(d + " ") ||
						normalizedReply.startsWith(d + ".") ||
						normalizedReply.startsWith(d + " -")
					)) {
						logExecution(statusPath, "Exit intercept close",
							`Supervisor directed session close: "${supervisorReply.slice(0, 100)}"`);
						return null;
					}

					// Instructional reply — return as new prompt for the worker
					logExecution(statusPath, "Exit intercept reprompt",
						`Supervisor provided instructions (${supervisorReply.length} chars) — reprompting worker`);
					return supervisorReply;
				}
				: undefined,
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
				emitSnapshot(config, taskId, segmentId, "running", telemetry, statusPath, reviewerStatePath, snapshotSegmentCtx, submoduleDiagnostics);
			} catch { /* non-fatal: telemetry callback must never crash the engine */ }
		});

		// Reviewer telemetry is written by the worker bridge during review_step.
		// Poll snapshot refresh independently from worker message_end cadence so
		// the dashboard sees reviewer activity while tool calls are in-flight.
		let reviewerSnapshotFailures = 0;
		const reviewerRefreshFailureThreshold = 5;
		const reviewerRefresh = setInterval(() => {
			const ok = emitSnapshot(config, taskId, segmentId, "running", iterationTelemetry, statusPath, reviewerStatePath, snapshotSegmentCtx, submoduleDiagnostics);
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
		const afterStatusContent = readFileSync(statusPath, "utf-8");
		const afterStatus = parseStatusMd(afterStatusContent);
		// TP-174: Segment-scoped progress delta
		let afterTotalChecked: number;
		if (repoStepNumbers && currentRepoId) {
			const segCbs = getSegmentCheckboxes(afterStatusContent, firstStep.number, currentRepoId);
			afterTotalChecked = segCbs ? segCbs.checked : 0;
		} else {
			afterTotalChecked = afterStatus.steps.reduce((sum, s) => sum + s.totalChecked, 0);
		}
		const progressDelta = afterTotalChecked - prevTotalChecked;

		if (progressDelta <= 0) {
			const softProgress = detectSoftProgress(unit.worktreePath, prevHeadCommit);

			if (softProgress.hasProgress) {
				// Worker has uncommitted code changes — don't count toward stall.
				// Reset the counter since the worker is actively editing.
				logExecution(statusPath, "Soft progress",
					`Iteration ${totalIterations}: 0 new checkboxes but ${softProgress.reason ?? "durable progress detected"} — not counting as stall`);
				noProgressCount = 0;
			} else {
				noProgressCount++;
				logExecution(statusPath, "No progress",
					`Iteration ${totalIterations}: 0 new checkboxes (${noProgressCount}/${config.noProgressLimit} stall limit)`);
				if (noProgressCount >= config.noProgressLimit) {
					logExecution(statusPath, "Task blocked", `No progress after ${noProgressCount} iterations`);
					submoduleDiagnostics.postTask = captureTaskSubmoduleSnapshot(taskId, "post-task", config.worktreePath);
					return makeResult(taskId, segmentId, workerAgentId, "failed", startTime,
						`No progress after ${noProgressCount} iterations`, false, totalIterations, cumulativeCostUsd, cumulativeTokens, config, statusPath, reviewerStatePath, lastTelemetry, submoduleDiagnostics, snapshotSegmentCtx);
				}
			}
		} else {
			noProgressCount = 0;
		}

		// Mark completed steps
		// TP-174: When segment-scoped, mark step complete when the segment's
		// checkboxes are all checked (not the full step which may have other segments).
		if (repoStepNumbers && currentRepoId) {
			for (const stepNum of repoStepNumbers) {
				if (isSegmentComplete(afterStatusContent, stepNum, currentRepoId)) {
					// Only mark step complete in STATUS.md if ALL segments in that step
					// are complete (not just ours). But for loop exit, we only care about ours.
					const ss = afterStatus.steps.find(s => s.number === stepNum);
					if (isStepComplete(ss)) {
						updateStepStatus(statusPath, stepNum, "complete");
					}
				}
			}
		} else {
			for (const step of parsed.steps) {
				const ss = afterStatus.steps.find(s => s.number === step.number);
				if (isStepComplete(ss)) {
					updateStepStatus(statusPath, step.number, "complete");
				}
			}
		}

		// Check if all steps are now complete
		// TP-174: When segment-scoped, exit when all steps for this repoId
		// have their segment checkboxes complete.
		let allComplete: boolean;
		if (repoStepNumbers && currentRepoId) {
			allComplete = [...repoStepNumbers].every(stepNum =>
				isSegmentComplete(afterStatusContent, stepNum, currentRepoId),
			);
		} else {
			allComplete = parsed.steps.every(step => {
				const ss = afterStatus.steps.find(s => s.number === step.number);
				return isStepComplete(ss);
			});
		}
		if (allComplete) break;
	}

	// ── 3. Post-loop completion check ───────────────────────────────
	const finalStatusContent = readFileSync(statusPath, "utf-8");
	const finalStatus = parseStatusMd(finalStatusContent);
	const parsed = parsePromptMd(readFileSync(promptPath, "utf-8"), promptPath);

	// TP-174: Segment-scoped post-loop check. Re-derive repo scoping since
	// the iteration loop variables are out of scope here.
	const postLoopRepoId = segmentId ? config.repoId : null;
	const postLoopStepSegMap = unit.task.stepSegmentMap;
	const postLoopRepoSteps = (postLoopStepSegMap && postLoopRepoId)
		? getStepsForRepoId(postLoopStepSegMap, postLoopRepoId)
		: null;
	const effectivePostLoopRepoSteps = (postLoopRepoSteps && postLoopRepoSteps.size > 0)
		? postLoopRepoSteps
		: null;

	let allStepsComplete: boolean;
	if (effectivePostLoopRepoSteps && postLoopRepoId) {
		allStepsComplete = [...effectivePostLoopRepoSteps].every(stepNum =>
			isSegmentComplete(finalStatusContent, stepNum, postLoopRepoId),
		);
	} else {
		allStepsComplete = parsed.steps.every(step => {
			const ss = finalStatus.steps.find(s => s.number === step.number);
			return isStepComplete(ss);
		});
	}

	if (!allStepsComplete) {
		let incomplete: string;
		if (effectivePostLoopRepoSteps && postLoopRepoId) {
			incomplete = [...effectivePostLoopRepoSteps]
				.filter(stepNum => !isSegmentComplete(finalStatusContent, stepNum, postLoopRepoId))
				.map(n => `Step ${n}`)
				.join(", ");
		} else {
			incomplete = parsed.steps
				.filter(step => {
					const ss = finalStatus.steps.find(s => s.number === step.number);
					return !isStepComplete(ss);
				})
				.map(s => `Step ${s.number}`)
				.join(", ");
		}
		logExecution(statusPath, "Task incomplete", `Max iterations reached. Incomplete: ${incomplete}`);
		submoduleDiagnostics.postTask = captureTaskSubmoduleSnapshot(taskId, "post-task", config.worktreePath);
		return makeResult(taskId, segmentId, workerAgentId, "failed", startTime,
			`Max iterations (${config.maxIterations}) reached with incomplete steps: ${incomplete}`,
			false, totalIterations, cumulativeCostUsd, cumulativeTokens, config, statusPath, reviewerStatePath, lastTelemetry, submoduleDiagnostics, snapshotSegmentCtx);
	}

	// TP-145: Determine if this is a non-final segment of a multi-segment task.
	// If more segments remain after this one, suppress .DONE creation so that
	// the engine can advance the segment frontier and execute subsequent segments.
	// .DONE must only exist when ALL segments of a multi-segment task are complete.
	const isNonFinalSegment = segmentId != null
		&& Array.isArray(unit.task.segmentIds)
		&& unit.task.segmentIds.length > 1
		&& unit.task.segmentIds[unit.task.segmentIds.length - 1] !== segmentId;

	// TP-165: Check for pending expansion requests in the worker's outbox.
	// If the worker filed expansion requests, more segments may be added by the
	// engine at the segment boundary — .DONE must not be created even if this
	// appears to be the final segment based on the static segmentIds list.
	const hasPendingExpansionRequests = segmentId != null && hasPendingExpansionRequestFiles(
		config.stateRoot, config.batchId, workerAgentId,
	);

	if (isNonFinalSegment || hasPendingExpansionRequests) {
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
		const suppressionReason = isNonFinalSegment
			? "non-final"
			: "pending expansion requests";
		submoduleDiagnostics.postTask = captureTaskSubmoduleSnapshot(taskId, "post-task", config.worktreePath);
		return makeResult(taskId, segmentId, workerAgentId, "succeeded", startTime,
			`Segment completed (${suppressionReason} — .DONE suppressed)`, false, totalIterations, cumulativeCostUsd, cumulativeTokens, config, statusPath, reviewerStatePath, lastTelemetry, submoduleDiagnostics, snapshotSegmentCtx);
	}

	// Create .DONE if not already present (final segment or single-segment/whole-task execution)
	if (!existsSync(donePath)) {
		writeFileSync(donePath, `Completed: ${new Date().toISOString()}\nTask: ${taskId}\n`);
	}
	updateStatusField(statusPath, "Status", "✅ Complete");
	logExecution(statusPath, "Task complete", ".DONE created");
	submoduleDiagnostics.postTask = captureTaskSubmoduleSnapshot(taskId, "post-task", config.worktreePath);

	return makeResult(taskId, segmentId, workerAgentId, "succeeded", startTime,
		".DONE file created by lane-runner", true, totalIterations, cumulativeCostUsd, cumulativeTokens, config, statusPath, reviewerStatePath, lastTelemetry, submoduleDiagnostics, snapshotSegmentCtx);
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * TP-165: Check if the worker's outbox contains pending segment expansion requests.
 *
 * Pending expansion request files match `segment-expansion-*.json` (not renamed
 * to `.processed`, `.rejected`, etc.). If any exist, the engine will process them
 * at the segment boundary — and may add more segments to the task.
 *
 * @returns true if at least one pending expansion request file exists
 */
export function hasPendingExpansionRequestFiles(
	stateRoot: string,
	batchId: string,
	agentId: string,
): boolean {
	const outboxDir = join(stateRoot, ".pi", "mailbox", batchId, agentId, "outbox");
	if (!existsSync(outboxDir)) return false;
	try {
		const entries = readdirSync(outboxDir);
		return entries.some((entry) => /^segment-expansion-.+\.json$/.test(entry));
	} catch {
		return false;
	}
}

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
	submoduleDiagnostics?: RuntimeLaneSubmoduleDiagnostics,
	/** TP-174: Segment context for segment-scoped snapshot progress */
	segmentCtx?: { stepSegmentMap: StepSegmentMapping[]; repoId: string } | null,
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
			exitDiagnostic: buildLaneExitDiagnostic(
				status,
				exitReason,
				doneFileFound,
				finalTelemetry,
				statusPath,
				config?.repoId ?? "default",
			),
		},
		iterations,
		costUsd,
		totalTokens,
	};

	// TP-115: Emit terminal snapshot with real telemetry from agent-host result
	if (config && statusPath && reviewerStatePath) {
		const terminalStatus = mapLaneTaskStatusToTerminalSnapshotStatus(status);
		emitSnapshot(config, taskId, segmentId, terminalStatus, finalTelemetry ?? {}, statusPath, reviewerStatePath, segmentCtx, submoduleDiagnostics);
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
	/** TP-174: Optional segment context for segment-scoped progress reporting */
	segmentContext?: { stepSegmentMap: StepSegmentMapping[]; repoId: string } | null,
	submoduleDiagnostics?: RuntimeLaneSubmoduleDiagnostics,
): boolean {
	try {
		// Parse progress from STATUS.md
		let progress: RuntimeTaskProgress | null = null;
		try {
			const content = readFileSync(statusPath, "utf-8");
			const parsed = parseStatusMd(content);
			const currentStepMatch = content.match(/\*\*Current Step:\*\*\s*(.+)/);

			// TP-174: Segment-scoped progress when segment markers are present.
			// Only count checkboxes from steps that belong to this segment's repoId.
			let checked: number;
			let total: number;
			if (segmentContext) {
				const { stepSegmentMap, repoId } = segmentContext;
				const repoSteps = getStepsForRepoId(stepSegmentMap, repoId);
				let segChecked = 0;
				let segTotal = 0;
				for (const stepNum of repoSteps) {
					const segCbs = getSegmentCheckboxes(content, stepNum, repoId);
					if (segCbs) {
						segChecked += segCbs.checked;
						segTotal += segCbs.total;
					}
				}
				checked = segChecked;
				total = segTotal;
			} else {
				checked = parsed.steps.reduce((sum, s) => sum + s.totalChecked, 0);
				total = parsed.steps.reduce((sum, s) => sum + s.totalItems, 0);
			}

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
			submoduleDiagnostics,
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

function captureTaskSubmoduleSnapshot(
	taskId: string,
	phase: "pre-task" | "post-task",
	worktreePath: string,
): RuntimeSubmoduleSnapshot {
	const snapshot = captureSubmoduleStatusSnapshot(worktreePath);
	return {
		taskId,
		phase,
		capturedAt: snapshot.capturedAt,
		worktreePath: snapshot.worktreePath,
		totalSubmodules: snapshot.totalSubmodules,
		dirtySubmodules: snapshot.dirtySubmodules,
		entries: snapshot.entries,
	};
}

