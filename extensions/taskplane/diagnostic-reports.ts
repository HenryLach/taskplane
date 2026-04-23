/**
 * Diagnostic report generation for batch completion/failure.
 *
 * Emits two artifacts at batch-terminal time:
 * 1. JSONL event log: `.pi/diagnostics/{opId}-{batchId}-events.jsonl`
 * 2. Human-readable summary: `.pi/diagnostics/{opId}-{batchId}-report.md`
 *
 * Write failures are non-fatal — errors are logged but never crash
 * the batch finalization flow.
 *
 * @module orch/diagnostic-reports
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

import { execLog } from "./execution.ts";
import { resolveOperatorId } from "./naming.ts";
import type { AllocatedLane, LaneTaskOutcome, OrchBatchRuntimeState, OrchestratorConfig, PersistedTaskRecord, BatchDiagnostics, PersistedTaskExitSummary } from "./types.ts";
import { defaultBatchDiagnostics } from "./types.ts";

// ── Types ────────────────────────────────────────────────────────────

/**
 * A single JSONL event representing one task's diagnostic record.
 * Deterministically ordered by taskId for reproducible output.
 */
export interface DiagnosticEvent {
	/** Batch identifier */
	batchId: string;
	/** Final batch phase at emission time */
	phase: string;
	/** Execution mode: "repo" or "workspace" */
	mode: string;
	/** Task identifier */
	taskId: string;
	/** Task execution status */
	status: string;
	/** Exit classification (from diagnostics.taskExits or exitDiagnostic, fallback: "unknown") */
	classification: string;
	/** Estimated cost in USD (0 if unavailable) */
	cost: number;
	/** Wall-clock duration in seconds (0 if unavailable) */
	durationSec: number;
	/** Number of retry attempts (0 if never retried) */
	retries: number;
	/** Repo ID for workspace mode (null in repo mode or if unresolved) */
	repoId: string | null;
	/** Human-readable exit reason */
	exitReason: string;
	/** Epoch ms when task started (null if never started) */
	startedAt: number | null;
	/** Epoch ms when task ended (null if still running or never started) */
	endedAt: number | null;
}

/**
 * Input data for diagnostic report generation.
 *
 * Assembled by the caller (engine.ts / resume.ts) from available
 * runtime state at the batch-terminal checkpoint.
 */
export interface DiagnosticReportInput {
	/** Orchestrator config (for opId resolution) */
	orchConfig: OrchestratorConfig;
	/** Batch ID */
	batchId: string;
	/** Final batch phase */
	phase: string;
	/** Execution mode */
	mode: string;
	/** Epoch ms when batch started */
	startedAt: number;
	/** Epoch ms when batch ended (null if still running) */
	endedAt: number | null;
	/** Per-task records from serialized state */
	tasks: PersistedTaskRecord[];
	/** Batch-level diagnostics (may have empty taskExits) */
	diagnostics: BatchDiagnostics;
	/** Summary counters */
	succeededTasks: number;
	failedTasks: number;
	skippedTasks: number;
	blockedTasks: number;
	totalTasks: number;
	/** State root path where `.pi/` lives */
	stateRoot: string;
}

// ── Diagnostics Directory ────────────────────────────────────────────

/** Resolve the diagnostics directory path. */
export function diagnosticsDir(stateRoot: string): string {
	return join(stateRoot, ".pi", "diagnostics");
}

/** Ensure `.pi/diagnostics/` exists, creating it if needed. */
function ensureDiagnosticsDir(stateRoot: string): string {
	const dir = diagnosticsDir(stateRoot);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

// ── Event Generation ─────────────────────────────────────────────────

/**
 * Build diagnostic events from task records and diagnostics data.
 *
 * Data source precedence for each task:
 * 1. `diagnostics.taskExits[taskId]` — canonical v3 exit summary (classification, cost, duration, retries)
 * 2. `task.exitDiagnostic.classification` — per-task exit diagnostic on the task record
 * 3. Fallback defaults: classification="unknown", cost=0, durationSec computed from startedAt/endedAt, retries=0
 *
 * Tasks are sorted by taskId for deterministic output.
 */
export function buildDiagnosticEvents(input: DiagnosticReportInput): DiagnosticEvent[] {
	const { batchId, phase, mode, tasks, diagnostics } = input;
	const taskExits = diagnostics.taskExits ?? {};

	// Sort tasks by taskId for deterministic ordering
	const sortedTasks = [...tasks].sort((a, b) => a.taskId.localeCompare(b.taskId));

	return sortedTasks.map((task): DiagnosticEvent => {
		const exitSummary: PersistedTaskExitSummary | undefined = taskExits[task.taskId];

		// Classification: prefer taskExits, then exitDiagnostic, then "unknown"
		let classification = "unknown";
		if (exitSummary) {
			classification = exitSummary.classification;
		} else if (task.exitDiagnostic?.classification) {
			classification = task.exitDiagnostic.classification;
		}

		// Cost: from taskExits, else 0
		const cost = exitSummary?.cost ?? 0;

		// Duration: from taskExits, else compute from timestamps, else 0
		let durationSec = 0;
		if (exitSummary) {
			durationSec = exitSummary.durationSec;
		} else if (task.startedAt !== null && task.endedAt !== null) {
			durationSec = Math.round((task.endedAt - task.startedAt) / 1000);
		}

		// Retries: from taskExits, else 0
		const retries = exitSummary?.retries ?? 0;

		// Repo ID: prefer resolvedRepoId, then repoId (workspace mode), else null
		const repoId = task.resolvedRepoId ?? task.repoId ?? null;

		return {
			batchId,
			phase,
			mode,
			taskId: task.taskId,
			status: task.status,
			classification,
			cost,
			durationSec,
			retries,
			repoId,
			exitReason: task.exitReason,
			startedAt: task.startedAt,
			endedAt: task.endedAt,
		};
	});
}

// ── JSONL Generation ─────────────────────────────────────────────────

/**
 * Serialize diagnostic events to JSONL format (one JSON object per line).
 */
export function eventsToJsonl(events: DiagnosticEvent[]): string {
	return events.map(e => JSON.stringify(e)).join("\n") + "\n";
}

// ── Human-Readable Summary ───────────────────────────────────────────

/**
 * Format a duration in seconds to a human-readable string.
 * e.g., 3661 → "1h 1m 1s", 42 → "42s"
 */
function formatDuration(seconds: number): string {
	if (seconds <= 0) return "0s";
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	const parts: string[] = [];
	if (h > 0) parts.push(`${h}h`);
	if (m > 0) parts.push(`${m}m`);
	if (s > 0 || parts.length === 0) parts.push(`${s}s`);
	return parts.join(" ");
}

/**
 * Format a cost value to a display string.
 * Shows "$0.00" for zero, otherwise up to 4 decimal places.
 */
function formatCost(cost: number): string {
	if (cost === 0) return "$0.00";
	return `$${cost.toFixed(4)}`;
}

function formatReason(reason: string): string {
	const normalized = reason.replace(/\r?\n/g, " / ").replace(/\|/g, "\\|").trim();
	if (!normalized) return "-";
	return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized;
}

/**
 * Generate a human-readable markdown summary report.
 */
export function buildMarkdownReport(input: DiagnosticReportInput, events: DiagnosticEvent[]): string {
	const { batchId, phase, mode, startedAt, endedAt, diagnostics } = input;
	const { succeededTasks, failedTasks, skippedTasks, blockedTasks, totalTasks } = input;

	const batchDurationSec = endedAt ? Math.round((endedAt - startedAt) / 1000) : 0;
	const batchCost = diagnostics.batchCost ?? 0;

	const lines: string[] = [];

	// ── Header ──
	lines.push(`# Batch Diagnostic Report`);
	lines.push(``);

	// ── Batch Overview ──
	lines.push(`## Batch Overview`);
	lines.push(``);
	lines.push(`| Field | Value |`);
	lines.push(`|-------|-------|`);
	lines.push(`| Batch ID | \`${batchId}\` |`);
	lines.push(`| Final Phase | ${phase} |`);
	lines.push(`| Mode | ${mode} |`);
	lines.push(`| Duration | ${formatDuration(batchDurationSec)} |`);
	lines.push(`| Total Cost | ${formatCost(batchCost)} |`);
	lines.push(`| Total Tasks | ${totalTasks} |`);
	lines.push(`| Succeeded | ${succeededTasks} |`);
	lines.push(`| Failed | ${failedTasks} |`);
	lines.push(`| Skipped | ${skippedTasks} |`);
	lines.push(`| Blocked | ${blockedTasks} |`);
	lines.push(``);

	// ── Per-Task Table ──
	lines.push(`## Per-Task Results`);
	lines.push(``);

	if (events.length === 0) {
		lines.push(`_No task records available._`);
		lines.push(``);
	} else {
		lines.push(`| Task | Status | Classification | Reason | Cost | Duration | Retries |`);
		lines.push(`|------|--------|---------------|--------|------|----------|---------|`);
		for (const evt of events) {
			lines.push(
				`| ${evt.taskId} | ${evt.status} | ${evt.classification} | ${formatReason(evt.exitReason)} | ${formatCost(evt.cost)} | ${formatDuration(evt.durationSec)} | ${evt.retries} |`
			);
		}
		lines.push(``);
	}

	// ── Per-Repo Breakdown (workspace mode only) ──
	if (mode === "workspace") {
		lines.push(`## Per-Repo Breakdown`);
		lines.push(``);

		// Group events by repoId
		const byRepo = new Map<string, DiagnosticEvent[]>();
		for (const evt of events) {
			const key = evt.repoId ?? "(unresolved)";
			if (!byRepo.has(key)) byRepo.set(key, []);
			byRepo.get(key)!.push(evt);
		}

		// Sort repo keys for deterministic output
		const repoKeys = [...byRepo.keys()].sort();

		if (repoKeys.length === 0) {
			lines.push(`_No per-repo data available._`);
			lines.push(``);
		} else {
			for (const repoKey of repoKeys) {
				const repoEvents = byRepo.get(repoKey)!;
				const repoSucceeded = repoEvents.filter(e => e.status === "succeeded").length;
				const repoFailed = repoEvents.filter(e => e.status === "failed").length;
				const repoCost = repoEvents.reduce((sum, e) => sum + e.cost, 0);

				lines.push(`### ${repoKey}`);
				lines.push(``);
				lines.push(`- Tasks: ${repoEvents.length} (${repoSucceeded} succeeded, ${repoFailed} failed)`);
				lines.push(`- Cost: ${formatCost(repoCost)}`);
				lines.push(``);

				lines.push(`| Task | Status | Classification | Reason | Cost | Duration |`);
				lines.push(`|------|--------|---------------|--------|------|----------|`);
				for (const evt of repoEvents) {
					lines.push(
						`| ${evt.taskId} | ${evt.status} | ${evt.classification} | ${formatReason(evt.exitReason)} | ${formatCost(evt.cost)} | ${formatDuration(evt.durationSec)} |`
					);
				}
				lines.push(``);
			}
		}
	}

	// ── Footer ──
	lines.push(`---`);
	lines.push(`_Generated at ${new Date().toISOString()}_`);
	lines.push(``);

	return lines.join("\n");
}

// ── Report Emission ──────────────────────────────────────────────────

/**
 * Emit diagnostic reports (JSONL event log + markdown summary) at batch terminal.
 *
 * This function is called exactly once per batch run, immediately after
 * the `persistRuntimeState("batch-terminal", ...)` call in both engine.ts
 * and resume.ts.
 *
 * **Non-fatal:** All errors during report generation or writing are caught
 * and logged via `execLog()`. They never propagate to the caller or crash
 * the batch finalization flow.
 *
 * @param input - Diagnostic report input assembled from runtime state
 */
export function emitDiagnosticReports(input: DiagnosticReportInput): void {
	try {
		const opId = resolveOperatorId(input.orchConfig);
		const dir = ensureDiagnosticsDir(input.stateRoot);

		const events = buildDiagnosticEvents(input);

		// ── JSONL event log ──
		const jsonlPath = join(dir, `${opId}-${input.batchId}-events.jsonl`);
		const jsonlContent = eventsToJsonl(events);
		writeFileSync(jsonlPath, jsonlContent, "utf-8");

		// ── Markdown summary ──
		const reportPath = join(dir, `${opId}-${input.batchId}-report.md`);
		const reportContent = buildMarkdownReport(input, events);
		writeFileSync(reportPath, reportContent, "utf-8");

		execLog("diagnostics", input.batchId, `emitted diagnostic reports`, {
			jsonl: jsonlPath,
			report: reportPath,
			taskCount: events.length,
		});
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		execLog("diagnostics", input.batchId, `failed to emit diagnostic reports: ${msg}`);
		// Non-fatal: do not rethrow. The batch finalization continues.
	}
}

/**
 * Assemble diagnostic report input from batch runtime state.
 *
 * Convenience helper for engine.ts and resume.ts to call at the
 * batch-terminal checkpoint. Builds the full task registry from the
 * wave plan + allocated lanes + task outcomes — matching the canonical
 * model used by `serializeBatchState()`. This ensures diagnostics cover
 * all tasks (including pending/blocked tasks that were never allocated)
 * and preserve repo attribution fields for workspace per-repo breakdown.
 *
 * @param orchConfig - Orchestrator configuration
 * @param batchState - Current runtime batch state (at batch-terminal)
 * @param wavePlan - Wave plan (array of waves, each an array of taskIds)
 * @param lanes - Allocated lanes with task/repo metadata
 * @param allTaskOutcomes - All task outcomes accumulated during execution
 * @param stateRoot - State root path where `.pi/` lives
 */
export function assembleDiagnosticInput(
	orchConfig: OrchestratorConfig,
	batchState: OrchBatchRuntimeState,
	wavePlan: string[][],
	lanes: AllocatedLane[],
	allTaskOutcomes: LaneTaskOutcome[],
	stateRoot: string,
): DiagnosticReportInput {
	// Build lookup maps for fast per-task enrichment (mirrors serializeBatchState logic).
	const laneByTaskId = new Map<string, AllocatedLane>();
	const allocatedTaskByTaskId = new Map<string, { allocatedTask: import("./types.ts").AllocatedTask; lane: AllocatedLane }>();
	for (const lane of lanes) {
		for (const allocTask of lane.tasks) {
			laneByTaskId.set(allocTask.taskId, lane);
			allocatedTaskByTaskId.set(allocTask.taskId, { allocatedTask: allocTask, lane });
		}
	}

	// Latest outcome wins (allTaskOutcomes is append/replace ordered by time).
	const outcomeByTaskId = new Map<string, LaneTaskOutcome>();
	for (const outcome of allTaskOutcomes) {
		outcomeByTaskId.set(outcome.taskId, outcome);
	}

	// Build full task ID set from wave plan + outcomes (covers pending/blocked tasks).
	const taskIdSet = new Set<string>();
	for (const wave of wavePlan) {
		for (const taskId of wave) taskIdSet.add(taskId);
	}
	for (const outcome of allTaskOutcomes) {
		taskIdSet.add(outcome.taskId);
	}

	// Build task records sorted by taskId for deterministic output.
	const tasks: PersistedTaskRecord[] = [...taskIdSet]
		.sort()
		.map((taskId): PersistedTaskRecord => {
			const lane = laneByTaskId.get(taskId);
			const outcome = outcomeByTaskId.get(taskId);
			const allocated = allocatedTaskByTaskId.get(taskId);

			const record: PersistedTaskRecord = {
				taskId,
				laneNumber: lane?.laneNumber ?? 0,
				sessionName: outcome?.sessionName || lane?.laneSessionId || "",
				status: outcome?.status ?? "pending",
				taskFolder: "",
				startedAt: outcome?.startTime ?? null,
				endedAt: outcome?.endTime ?? null,
				doneFileFound: outcome?.doneFileFound ?? false,
				exitReason: outcome?.exitReason ?? "",
			};

			// Repo attribution from allocated task metadata (workspace mode).
			if (allocated?.allocatedTask.task?.promptRepoId !== undefined) {
				record.repoId = allocated.allocatedTask.task.promptRepoId;
			}
			if (allocated?.allocatedTask.task?.resolvedRepoId !== undefined) {
				record.resolvedRepoId = allocated.allocatedTask.task.resolvedRepoId;
			}

			// Partial progress fields from outcome.
			if (outcome?.partialProgressCommits !== undefined) {
				record.partialProgressCommits = outcome.partialProgressCommits;
			}
			if (outcome?.partialProgressBranch !== undefined) {
				record.partialProgressBranch = outcome.partialProgressBranch;
			}

			// v3: Exit diagnostic from outcome.
			if (outcome?.exitDiagnostic !== undefined) {
				record.exitDiagnostic = outcome.exitDiagnostic;
			}

			return record;
		});

	return {
		orchConfig,
		batchId: batchState.batchId,
		phase: batchState.phase,
		mode: batchState.mode ?? "repo",
		startedAt: batchState.startedAt,
		endedAt: batchState.endedAt,
		tasks,
		diagnostics: batchState.diagnostics ?? defaultBatchDiagnostics(),
		succeededTasks: batchState.succeededTasks,
		failedTasks: batchState.failedTasks,
		skippedTasks: batchState.skippedTasks,
		blockedTasks: batchState.blockedTasks,
		totalTasks: batchState.totalTasks,
		stateRoot,
	};
}
