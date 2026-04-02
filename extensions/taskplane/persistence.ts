/**
 * State persistence, serialization, orphan detection
 * @module orch/persistence
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, renameSync, mkdirSync, appendFileSync } from "fs";
import { join, dirname, basename } from "path";

import { execLog } from "./execution.ts";
import { BATCH_STATE_SCHEMA_VERSION, StateFileError, batchStatePath, BATCH_HISTORY_MAX_ENTRIES, defaultResilienceState, defaultBatchDiagnostics } from "./types.ts";
import type { BatchHistorySummary } from "./types.ts";
import type { AllocatedLane, DiscoveryResult, EngineEvent, EscalationContext, LaneTaskOutcome, LaneTaskStatus, MonitorState, OrchBatchPhase, OrchBatchRuntimeState, PersistedBatchState, PersistedLaneRecord, PersistedMergeResult, PersistedSegmentRecord, PersistedTaskRecord, TaskMonitorSnapshot, Tier0RecoveryPattern, WorkspaceMode } from "./types.ts";
import { sleepSync } from "./worktree.ts";
import type { PreserveFailedLaneProgressResult } from "./worktree.ts";

// ── State Persistence Helper (TS-009 Step 2) ────────────────────────

/**
 * Candidate .DONE file locations for a task folder.
 *
 * Task-runner archives completed tasks by moving:
 *   tasks/<task-folder>/ → tasks/archive/<task-folder>/
 *
 * During resume/orphan detection we must check both locations.
 */
export function getTaskDoneFileCandidates(taskFolder: string): string[] {
	const candidates = [join(taskFolder, ".DONE")];
	const parent = dirname(taskFolder);
	const taskFolderName = basename(taskFolder);

	// If already in archive, avoid duplicate candidate.
	if (basename(parent).toLowerCase() !== "archive") {
		candidates.push(join(parent, "archive", taskFolderName, ".DONE"));
	}

	return candidates;
}

/**
 * Check whether a task has a .DONE marker in active or archived location.
 */
export function hasTaskDoneMarker(taskFolder: string): boolean {
	for (const donePath of getTaskDoneFileCandidates(taskFolder)) {
		try {
			if (existsSync(donePath)) return true;
		} catch {
			// Ignore filesystem errors here; caller handles partial visibility.
		}
	}
	return false;
}

/**
 * Compare optional embedded outcome telemetry.
 */
function sameOutcomeTelemetry(a: LaneTaskOutcome["telemetry"], b: LaneTaskOutcome["telemetry"]): boolean {
	if (!a && !b) return true;
	if (!a || !b) return false;
	return a.inputTokens === b.inputTokens
		&& a.outputTokens === b.outputTokens
		&& a.cacheReadTokens === b.cacheReadTokens
		&& a.cacheWriteTokens === b.cacheWriteTokens
		&& a.costUsd === b.costUsd
		&& a.toolCalls === b.toolCalls
		&& a.durationMs === b.durationMs;
}

/**
 * Upsert a task outcome in-place. Returns true if changed.
 */
export function upsertTaskOutcome(outcomes: LaneTaskOutcome[], next: LaneTaskOutcome): boolean {
	const idx = outcomes.findIndex(o => o.taskId === next.taskId);
	if (idx < 0) {
		outcomes.push(next);
		return true;
	}

	const prev = outcomes[idx];
	const mergedNext: LaneTaskOutcome = {
		...next,
		laneNumber: next.laneNumber ?? prev.laneNumber,
		telemetry: next.telemetry ?? prev.telemetry,
	};

	const changed =
		prev.status !== mergedNext.status ||
		prev.startTime !== mergedNext.startTime ||
		prev.endTime !== mergedNext.endTime ||
		prev.exitReason !== mergedNext.exitReason ||
		prev.sessionName !== mergedNext.sessionName ||
		prev.doneFileFound !== mergedNext.doneFileFound ||
		prev.laneNumber !== mergedNext.laneNumber ||
		!sameOutcomeTelemetry(prev.telemetry, mergedNext.telemetry) ||
		prev.partialProgressCommits !== mergedNext.partialProgressCommits ||
		prev.partialProgressBranch !== mergedNext.partialProgressBranch ||
		prev.exitDiagnostic !== mergedNext.exitDiagnostic;

	if (changed) {
		outcomes[idx] = mergedNext;
	}
	return changed;
}

/**
 * Apply partial progress preservation results to task outcomes (TP-028).
 *
 * After `preserveFailedLaneProgress()` runs, call this to stamp each
 * successfully-preserved task outcome with the saved branch name and
 * commit count. This ensures the data flows into persistence and
 * diagnostics via the normal outcome → serialization path.
 *
 * @param ppResult  - Result from `preserveFailedLaneProgress()`
 * @param outcomes  - Mutable array of task outcomes to update in-place
 * @returns Number of outcomes that were updated
 */
export function applyPartialProgressToOutcomes(
	ppResult: PreserveFailedLaneProgressResult,
	outcomes: LaneTaskOutcome[],
): number {
	let updated = 0;
	for (const r of ppResult.results) {
		if (!r.saved || !r.savedBranch) continue;
		const outcome = outcomes.find(o => o.taskId === r.taskId);
		if (outcome) {
			outcome.partialProgressCommits = r.commitCount;
			outcome.partialProgressBranch = r.savedBranch;
			updated++;
		}
	}
	return updated;
}

/**
 * Seed pending outcomes for all tasks in newly allocated lanes.
 *
 * Ensures the persisted state has a full task registry as soon as a wave starts,
 * including lane/session assignment, even before tasks finish.
 */
export function seedPendingOutcomesForAllocatedLanes(
	lanes: AllocatedLane[],
	outcomes: LaneTaskOutcome[],
): boolean {
	let changed = false;
	for (const lane of lanes) {
		for (const laneTask of lane.tasks) {
			const existing = outcomes.find(o => o.taskId === laneTask.taskId);
			if (existing) continue;
			changed = upsertTaskOutcome(outcomes, {
				taskId: laneTask.taskId,
				status: "pending",
				startTime: null,
				endTime: null,
				exitReason: "Pending execution",
				sessionName: lane.laneSessionId,
				doneFileFound: false,
				laneNumber: lane.laneNumber,
			}) || changed;
		}
	}
	return changed;
}

/**
 * Sync accumulated task outcomes from monitor snapshots.
 *
 * This captures in-wave task transitions (pending → running → terminal)
 * so state persistence does not lag until wave completion.
 */
export function syncTaskOutcomesFromMonitor(
	monitorState: MonitorState,
	outcomes: LaneTaskOutcome[],
): boolean {
	let changed = false;

	for (const lane of monitorState.lanes) {
		// Remaining tasks => pending
		for (const taskId of lane.remainingTasks) {
			const existing = outcomes.find(o => o.taskId === taskId);
			if (existing && (existing.status === "succeeded" || existing.status === "failed" || existing.status === "stalled")) {
				continue;
			}
			changed = upsertTaskOutcome(outcomes, {
				taskId,
				status: "pending",
				startTime: existing?.startTime ?? null,
				endTime: null,
				exitReason: existing?.exitReason || "Pending execution",
				sessionName: existing?.sessionName || lane.sessionName,
				doneFileFound: false,
				laneNumber: existing?.laneNumber ?? lane.laneNumber,
				telemetry: existing?.telemetry,
				partialProgressCommits: existing?.partialProgressCommits,
				partialProgressBranch: existing?.partialProgressBranch,
				exitDiagnostic: existing?.exitDiagnostic,
			}) || changed;
		}

		// Completed tasks => succeeded
		// Use existing endTime if already set — prevents changed=true on every
		// poll tick (lastPollTime differs each tick, causing persist log spam).
		for (const taskId of lane.completedTasks) {
			const existing = outcomes.find(o => o.taskId === taskId);
			changed = upsertTaskOutcome(outcomes, {
				taskId,
				status: "succeeded",
				startTime: existing?.startTime ?? null,
				endTime: existing?.endTime ?? monitorState.lastPollTime,
				exitReason: existing?.exitReason || ".DONE file created by task-runner",
				sessionName: existing?.sessionName || lane.sessionName,
				doneFileFound: true,
				laneNumber: existing?.laneNumber ?? lane.laneNumber,
				telemetry: existing?.telemetry,
				partialProgressCommits: existing?.partialProgressCommits,
				partialProgressBranch: existing?.partialProgressBranch,
				exitDiagnostic: existing?.exitDiagnostic,
			}) || changed;
		}

		// Failed tasks => failed
		for (const taskId of lane.failedTasks) {
			const existing = outcomes.find(o => o.taskId === taskId);
			changed = upsertTaskOutcome(outcomes, {
				taskId,
				status: "failed",
				startTime: existing?.startTime ?? null,
				endTime: existing?.endTime ?? monitorState.lastPollTime,
				exitReason: existing?.exitReason || "Task failed or stalled",
				sessionName: existing?.sessionName || lane.sessionName,
				doneFileFound: false,
				laneNumber: existing?.laneNumber ?? lane.laneNumber,
				telemetry: existing?.telemetry,
				partialProgressCommits: existing?.partialProgressCommits,
				partialProgressBranch: existing?.partialProgressBranch,
				exitDiagnostic: existing?.exitDiagnostic,
			}) || changed;
		}

		// Current task snapshot => running/stalled/succeeded/failed/skipped
		if (lane.currentTaskId && lane.currentTaskSnapshot) {
			const snap = lane.currentTaskSnapshot;
			const existing = outcomes.find(o => o.taskId === lane.currentTaskId);
			const monitorToLane: Record<TaskMonitorSnapshot["status"], LaneTaskStatus> = {
				pending: "pending",
				running: "running",
				succeeded: "succeeded",
				failed: "failed",
				stalled: "stalled",
				skipped: "skipped",
				unknown: existing?.status || "running",
			};
			const mappedStatus = monitorToLane[snap.status];
			const terminal = mappedStatus === "succeeded" || mappedStatus === "failed" || mappedStatus === "stalled" || mappedStatus === "skipped";

			// TP-051: Use snap.observedAt (Date.now() from monitor poll) instead of
			// snap.lastHeartbeat (STATUS.md mtime) for task start time. The mtime
			// reflects when STATUS.md was last edited, which may be long before
			// actual execution started (e.g., during task staging).
			changed = upsertTaskOutcome(outcomes, {
				taskId: lane.currentTaskId,
				status: mappedStatus,
				startTime: existing?.startTime ?? snap.observedAt,
				endTime: terminal ? (existing?.endTime ?? snap.observedAt) : null,
				exitReason: existing?.exitReason || (mappedStatus === "running" ? "Task in progress" : (snap.stallReason || "Task reached terminal state")),
				sessionName: existing?.sessionName || lane.sessionName,
				doneFileFound: snap.doneFileFound,
				laneNumber: existing?.laneNumber ?? lane.laneNumber,
				telemetry: existing?.telemetry,
				partialProgressCommits: existing?.partialProgressCommits,
				partialProgressBranch: existing?.partialProgressBranch,
				exitDiagnostic: existing?.exitDiagnostic,
			}) || changed;
		}
	}

	return changed;
}

/**
 * Persist current runtime state to `.pi/batch-state.json`.
 *
 * Centralized helper that serializes runtime state, enriches task records
 * with folder paths from discovery, and writes atomically. Logs the reason,
 * batchId, phase, and waveIndex for each write.
 *
 * Write failures are non-fatal: logged as errors and added to
 * batchState.errors, but do NOT crash the batch execution.
 *
 * @param reason          - Human-readable reason for this state write (e.g., "batch-start", "wave-index-change")
 * @param batchState      - Current runtime batch state
 * @param wavePlan        - Wave plan (array of arrays of task IDs)
 * @param lanes           - Currently allocated lanes (latest wave's lanes)
 * @param allTaskOutcomes - All task outcomes accumulated across completed waves
 * @param discovery       - Discovery result (for enriching taskFolder paths)
 * @param repoRoot        - Absolute path to the repository root
 */
export function persistRuntimeState(
	reason: string,
	batchState: OrchBatchRuntimeState,
	wavePlan: string[][],
	lanes: AllocatedLane[],
	allTaskOutcomes: LaneTaskOutcome[],
	discovery: DiscoveryResult | null,
	repoRoot: string,
): void {
	try {
		const json = serializeBatchState(batchState, wavePlan, lanes, allTaskOutcomes);

		// Enrich task records with folder paths and repo fields from discovery
		if (discovery) {
			const parsed = JSON.parse(json) as PersistedBatchState;
			for (const taskRecord of parsed.tasks) {
				const parsedTask = discovery.pending.get(taskRecord.taskId);
				if (parsedTask) {
					taskRecord.taskFolder = parsedTask.taskFolder;
					// v2: Enrich repo fields for tasks not yet allocated (pending in future waves)
					if (taskRecord.repoId === undefined && parsedTask.promptRepoId !== undefined) {
						taskRecord.repoId = parsedTask.promptRepoId;
					}
					if (taskRecord.resolvedRepoId === undefined && parsedTask.resolvedRepoId !== undefined) {
						taskRecord.resolvedRepoId = parsedTask.resolvedRepoId;
					}
				}
			}
			const enrichedJson = JSON.stringify(parsed, null, 2);
			saveBatchState(enrichedJson, repoRoot);
		} else {
			saveBatchState(json, repoRoot);
		}

		execLog("state", batchState.batchId, `persisted: ${reason}`, {
			phase: batchState.phase,
			waveIndex: batchState.currentWaveIndex,
		});
	} catch (err: unknown) {
		const msg = err instanceof StateFileError
			? `[${err.code}] ${err.message}`
			: (err instanceof Error ? err.message : String(err));
		execLog("state", batchState.batchId, `write failed: ${msg}`, {
			reason,
			phase: batchState.phase,
		});
		batchState.errors.push(`State persistence failed (${reason}): ${msg}`);
	}
}


// ── State Validation ─────────────────────────────────────────────────

/** All valid OrchBatchPhase values for validation. */
export const VALID_BATCH_PHASES: ReadonlySet<string> = new Set([
	"idle", "launching", "planning", "executing", "merging", "paused", "stopped", "completed", "failed",
]);

/** All valid LaneTaskStatus values for validation. */
export const VALID_TASK_STATUSES: ReadonlySet<string> = new Set([
	"pending", "running", "succeeded", "failed", "stalled", "skipped",
]);

/** All valid merge result statuses for persisted state. */
export const VALID_PERSISTED_MERGE_STATUSES: ReadonlySet<string> = new Set([
	"succeeded", "failed", "partial",
]);

/**
 * Upconvert a v1 state object to v2 in-memory.
 *
 * Applied automatically by `validatePersistedState()` when a v1 file is loaded.
 * The on-disk file is NOT rewritten — upconversion is purely in-memory.
 *
 * v1→v2 field defaults:
 * - `schemaVersion`: bumped from 1 → 2
 * - `baseBranch`: defaults to "" (was already handled in v1 validation)
 * - `mode`: defaults to "repo" (v1 was always single-repo)
 * - `tasks[].repoId`: remains undefined (repo mode has no repo routing)
 * - `tasks[].resolvedRepoId`: remains undefined (same reason)
 * - `lanes[].repoId`: preserved if present (was already serialized in v1
 *   when workspace mode was partially implemented)
 *
 * This function is idempotent: calling it on an already-v2 object is a no-op.
 *
 * @param obj - Parsed state object (mutated in-place)
 */
export function upconvertV1toV2(obj: Record<string, unknown>): void {
	if ((obj.schemaVersion as number) >= 2) return;
	obj.schemaVersion = 2;
	if (!obj.baseBranch) obj.baseBranch = "";
	if (!obj.mode) obj.mode = "repo";
	// Task and lane records: v2 optional fields default to undefined (omitted)
	// which is already their state in v1 objects. No mutation needed.
}

/**
 * Upconvert a v2 state object to v3 by adding resilience and diagnostics
 * sections with conservative defaults.
 *
 * Added fields:
 * - `resilience`: default empty resilience state (no retries, no repairs)
 * - `diagnostics`: default empty diagnostics (no task exits, zero batch cost)
 *
 * This function is idempotent: calling it on an already-v3 object is a no-op.
 *
 * @param obj - Parsed state object (mutated in-place)
 */
export function upconvertV2toV3(obj: Record<string, unknown>): void {
	if ((obj.schemaVersion as number) >= 3) return;
	obj.schemaVersion = 3;
	// Backfill v3 sections with conservative defaults only during genuine
	// v1/v2→v3 migration. A native v3 file missing these sections is
	// malformed and must be rejected by validation — not silently patched.
	if (!obj.resilience) obj.resilience = defaultResilienceState();
	if (!obj.diagnostics) obj.diagnostics = defaultBatchDiagnostics();
}

/**
 * Upconvert a v3 state object to v4 by adding the `segments` array.
 *
 * Added fields:
 * - `segments`: empty array (no segment records exist in pre-v4 state)
 *
 * Task-level segment fields (`packetRepoId`, `packetTaskPath`,
 * `segmentIds`, `activeSegmentId`) are optional and default to
 * `undefined` (omitted from JSON). They are NOT backfilled here
 * because their values depend on runtime discovery, not on
 * migration defaults.
 *
 * This function is idempotent: calling it on an already-v4 object is a no-op.
 *
 * @param obj - Parsed state object (mutated in-place)
 */
export function upconvertV3toV4(obj: Record<string, unknown>): void {
	if ((obj.schemaVersion as number) >= 4) return;
	obj.schemaVersion = 4;
	// Backfill v4 segments with empty array only during genuine v3→v4 migration.
	if (!obj.segments) obj.segments = [];
}

/**
 * Validate a parsed JSON object as a PersistedBatchState.
 *
 * Checks:
 * 1. Schema version is 1 (auto-upconverted to v2→v3), 2 (upconverted to v3), or 3 (current)
 * 2. All required fields are present with correct types
 * 3. Enum fields contain valid values (phase, task statuses, merge statuses)
 * 4. Arrays contain valid sub-records
 * 5. v2 optional fields (repoId, resolvedRepoId, mode) are valid when present
 *
 * @param data - Parsed JSON (unknown type)
 * @returns Validated PersistedBatchState (always v3, even if input was v1/v2)
 * @throws StateFileError with STATE_SCHEMA_INVALID on any validation failure
 */
export function validatePersistedState(data: unknown): PersistedBatchState {
	if (!data || typeof data !== "object") {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			"Batch state must be a non-null object",
		);
	}

	const obj = data as Record<string, unknown>;

	// ── Schema version ───────────────────────────────────────────
	if (typeof obj.schemaVersion !== "number") {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`Missing or invalid "schemaVersion" field (expected number, got ${typeof obj.schemaVersion})`,
		);
	}
	// Accept v1 (auto-upconvert to v2→v3→v4), v2 (upconvert to v3→v4), v3 (upconvert to v4), and v4 (current).
	// Reject anything else — including future versions from newer runtimes.
	const ACCEPTED_VERSIONS = [1, 2, 3, BATCH_STATE_SCHEMA_VERSION];
	if (!ACCEPTED_VERSIONS.includes(obj.schemaVersion as number)) {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`Unsupported schema version ${obj.schemaVersion} (expected ${BATCH_STATE_SCHEMA_VERSION}). ` +
			`Upgrade taskplane to a version that supports schema v${obj.schemaVersion}, ` +
			`or delete .pi/batch-state.json and re-run the batch.`,
		);
	}
	const isV1 = obj.schemaVersion === 1;

	// ── Required string fields ───────────────────────────────────
	for (const field of ["phase", "batchId"] as const) {
		if (typeof obj[field] !== "string") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`Missing or invalid "${field}" field (expected string, got ${typeof obj[field]})`,
			);
		}
	}

	// ── Optional string fields (backward-compatible) ─────────────
	// baseBranch was added after schema v1; default to empty string if missing
	if (obj.baseBranch !== undefined && typeof obj.baseBranch !== "string") {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`Invalid "baseBranch" field (expected string, got ${typeof obj.baseBranch})`,
		);
	}

	// ── Optional string fields: orchBranch ───────────────────────
	// orchBranch was added after schema v2 shipped; default to "" if missing.
	if (obj.orchBranch !== undefined && typeof obj.orchBranch !== "string") {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`Invalid "orchBranch" field (expected string, got ${typeof obj.orchBranch})`,
		);
	}
	if (obj.orchBranch === undefined) {
		obj.orchBranch = "";
	}

	// ── v2: mode field ───────────────────────────────────────────
	// mode is required in v2, absent in v1 (defaults to "repo" via upconvert).
	if (!isV1 && obj.mode === undefined) {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`Missing required "mode" field in schema v2 (expected "repo" or "workspace")`,
		);
	}
	if (obj.mode !== undefined && typeof obj.mode !== "string") {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`Invalid "mode" field (expected string, got ${typeof obj.mode})`,
		);
	}
	if (obj.mode !== undefined && obj.mode !== "repo" && obj.mode !== "workspace") {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`Invalid "mode" value "${obj.mode}" (expected "repo" or "workspace")`,
		);
	}

	// ── Phase enum validation ────────────────────────────────────
	if (!VALID_BATCH_PHASES.has(obj.phase as string)) {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`Invalid "phase" value "${obj.phase}" (expected one of: ${[...VALID_BATCH_PHASES].join(", ")})`,
		);
	}

	// ── Required number fields ───────────────────────────────────
	for (const field of [
		"startedAt", "updatedAt", "currentWaveIndex", "totalWaves",
		"totalTasks", "succeededTasks", "failedTasks", "skippedTasks", "blockedTasks",
	] as const) {
		if (typeof obj[field] !== "number") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`Missing or invalid "${field}" field (expected number, got ${typeof obj[field]})`,
			);
		}
	}

	// ── Nullable number: endedAt ─────────────────────────────────
	if (obj.endedAt !== null && typeof obj.endedAt !== "number") {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`Invalid "endedAt" field (expected number or null, got ${typeof obj.endedAt})`,
		);
	}

	// ── Required arrays ──────────────────────────────────────────
	for (const field of ["wavePlan", "lanes", "tasks", "mergeResults", "blockedTaskIds", "errors"] as const) {
		if (!Array.isArray(obj[field])) {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`Missing or invalid "${field}" field (expected array, got ${typeof obj[field]})`,
			);
		}
	}

	// ── Validate wavePlan: array of arrays of strings ────────────
	const wavePlan = obj.wavePlan as unknown[];
	for (let i = 0; i < wavePlan.length; i++) {
		if (!Array.isArray(wavePlan[i])) {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`wavePlan[${i}] is not an array`,
			);
		}
		for (const taskId of wavePlan[i] as unknown[]) {
			if (typeof taskId !== "string") {
				throw new StateFileError(
					"STATE_SCHEMA_INVALID",
					`wavePlan[${i}] contains non-string value: ${typeof taskId}`,
				);
			}
		}
	}

	// ── Validate task records ────────────────────────────────────
	const tasks = obj.tasks as unknown[];
	for (let i = 0; i < tasks.length; i++) {
		const t = tasks[i] as Record<string, unknown>;
		if (!t || typeof t !== "object") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`tasks[${i}] is not an object`,
			);
		}
		for (const field of ["taskId", "sessionName", "taskFolder", "exitReason"] as const) {
			if (typeof t[field] !== "string") {
				throw new StateFileError(
					"STATE_SCHEMA_INVALID",
					`tasks[${i}].${field} is missing or not a string`,
				);
			}
		}
		if (typeof t.laneNumber !== "number") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`tasks[${i}].laneNumber is missing or not a number`,
			);
		}
		if (typeof t.status !== "string" || !VALID_TASK_STATUSES.has(t.status)) {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`tasks[${i}].status is invalid: "${t.status}" (expected one of: ${[...VALID_TASK_STATUSES].join(", ")})`,
			);
		}
		if (t.startedAt !== null && typeof t.startedAt !== "number") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`tasks[${i}].startedAt is not a number or null`,
			);
		}
		if (t.endedAt !== null && typeof t.endedAt !== "number") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`tasks[${i}].endedAt is not a number or null`,
			);
		}
		if (typeof t.doneFileFound !== "boolean") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`tasks[${i}].doneFileFound is missing or not a boolean`,
			);
		}
		// v2 optional fields: repoId, resolvedRepoId (string | undefined)
		if (t.repoId !== undefined && typeof t.repoId !== "string") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`tasks[${i}].repoId is not a string (got ${typeof t.repoId})`,
			);
		}
		if (t.resolvedRepoId !== undefined && typeof t.resolvedRepoId !== "string") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`tasks[${i}].resolvedRepoId is not a string (got ${typeof t.resolvedRepoId})`,
			);
		}
		// TP-028 optional fields: partialProgressCommits (number | undefined), partialProgressBranch (string | undefined)
		if (t.partialProgressCommits !== undefined && typeof t.partialProgressCommits !== "number") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`tasks[${i}].partialProgressCommits is not a number (got ${typeof t.partialProgressCommits})`,
			);
		}
		if (t.partialProgressBranch !== undefined && typeof t.partialProgressBranch !== "string") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`tasks[${i}].partialProgressBranch is not a string (got ${typeof t.partialProgressBranch})`,
			);
		}
		// TP-026 optional field: exitDiagnostic (object with classification string | undefined)
		if (t.exitDiagnostic !== undefined) {
			if (typeof t.exitDiagnostic !== "object" || t.exitDiagnostic === null || Array.isArray(t.exitDiagnostic)) {
				throw new StateFileError(
					"STATE_SCHEMA_INVALID",
					`tasks[${i}].exitDiagnostic is not a plain object (got ${Array.isArray(t.exitDiagnostic) ? "array" : typeof t.exitDiagnostic})`,
				);
			}
			if (typeof (t.exitDiagnostic as any).classification !== "string") {
				throw new StateFileError(
					"STATE_SCHEMA_INVALID",
					`tasks[${i}].exitDiagnostic.classification is not a string (got ${typeof (t.exitDiagnostic as any).classification})`,
				);
			}
		}
	}

	// ── Validate lane records ────────────────────────────────────
	const lanes = obj.lanes as unknown[];
	for (let i = 0; i < lanes.length; i++) {
		const l = lanes[i] as Record<string, unknown>;
		if (!l || typeof l !== "object") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`lanes[${i}] is not an object`,
			);
		}
		for (const field of ["laneId", "worktreePath", "branch"] as const) {
			if (typeof l[field] !== "string") {
				throw new StateFileError(
					"STATE_SCHEMA_INVALID",
					`lanes[${i}].${field} is missing or not a string`,
				);
			}
		}

		const laneSessionId = l.laneSessionId;
		if (laneSessionId !== undefined && typeof laneSessionId !== "string") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`lanes[${i}].laneSessionId is not a string (got ${typeof laneSessionId})`,
			);
		}

		const tmuxSessionName = l.tmuxSessionName;
		if (tmuxSessionName !== undefined && typeof tmuxSessionName !== "string") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`lanes[${i}].tmuxSessionName is not a string (got ${typeof tmuxSessionName})`,
			);
		}

		if (typeof laneSessionId !== "string" && typeof tmuxSessionName !== "string") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`lanes[${i}] must include either laneSessionId or tmuxSessionName as a string`,
			);
		}

		if (typeof laneSessionId !== "string") {
			l.laneSessionId = tmuxSessionName;
		}
		if ("tmuxSessionName" in l) {
			delete (l as { tmuxSessionName?: unknown }).tmuxSessionName;
		}

		if (typeof l.laneNumber !== "number") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`lanes[${i}].laneNumber is missing or not a number`,
			);
		}
		if (!Array.isArray(l.taskIds)) {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`lanes[${i}].taskIds is missing or not an array`,
			);
		}
		// v2 optional field: repoId (string | undefined)
		if (l.repoId !== undefined && typeof l.repoId !== "string") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`lanes[${i}].repoId is not a string (got ${typeof l.repoId})`,
			);
		}
	}

	// ── Validate merge results ───────────────────────────────────
	const mergeResults = obj.mergeResults as unknown[];
	for (let i = 0; i < mergeResults.length; i++) {
		const m = mergeResults[i] as Record<string, unknown>;
		if (!m || typeof m !== "object") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`mergeResults[${i}] is not an object`,
			);
		}
		if (typeof m.waveIndex !== "number") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`mergeResults[${i}].waveIndex is missing or not a number`,
			);
		}
		if (typeof m.status !== "string" || !VALID_PERSISTED_MERGE_STATUSES.has(m.status)) {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`mergeResults[${i}].status is invalid: "${m.status}" (expected one of: ${[...VALID_PERSISTED_MERGE_STATUSES].join(", ")})`,
			);
		}
		// v2 optional field: repoResults (array | undefined)
		if (m.repoResults !== undefined) {
			if (!Array.isArray(m.repoResults)) {
				throw new StateFileError(
					"STATE_SCHEMA_INVALID",
					`mergeResults[${i}].repoResults is not an array (got ${typeof m.repoResults})`,
				);
			}
			for (let j = 0; j < (m.repoResults as unknown[]).length; j++) {
				const rr = (m.repoResults as unknown[])[j] as Record<string, unknown>;
				if (!rr || typeof rr !== "object") {
					throw new StateFileError(
						"STATE_SCHEMA_INVALID",
						`mergeResults[${i}].repoResults[${j}] is not an object`,
					);
				}
				if (typeof rr.status !== "string" || !VALID_PERSISTED_MERGE_STATUSES.has(rr.status)) {
					throw new StateFileError(
						"STATE_SCHEMA_INVALID",
						`mergeResults[${i}].repoResults[${j}].status is invalid: "${rr.status}"`,
					);
				}
				if (!Array.isArray(rr.laneNumbers)) {
					throw new StateFileError(
						"STATE_SCHEMA_INVALID",
						`mergeResults[${i}].repoResults[${j}].laneNumbers is not an array`,
					);
				}
			}
		}
	}

	// ── Validate lastError ───────────────────────────────────────
	if (obj.lastError !== null) {
		if (typeof obj.lastError !== "object") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`lastError is not an object or null`,
			);
		}
		const le = obj.lastError as Record<string, unknown>;
		if (typeof le.code !== "string" || typeof le.message !== "string") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`lastError must have "code" (string) and "message" (string) fields`,
			);
		}
	}

	// ── Validate blockedTaskIds: array of strings ────────────────
	for (const id of obj.blockedTaskIds as unknown[]) {
		if (typeof id !== "string") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`blockedTaskIds contains non-string value: ${typeof id}`,
			);
		}
	}

	// ── Validate errors: array of strings ────────────────────────
	for (const err of obj.errors as unknown[]) {
		if (typeof err !== "string") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`errors array contains non-string value: ${typeof err}`,
			);
		}
	}

	// ── v1→v2→v3→v4 upconversion ─────────────────────────────────
	// Apply defaults for fields that may be absent in older state files.
	// The on-disk file is NOT rewritten; upconversion is in-memory only.
	// Chain: v1→v2 then v2→v3 then v3→v4 (each is idempotent / no-op if already at target).
	upconvertV1toV2(obj);
	upconvertV2toV3(obj);
	upconvertV3toV4(obj);

	// ── Validate v3 resilience section ───────────────────────────
	// After upconversion, resilience must be a valid object with correct types.
	if (!obj.resilience || typeof obj.resilience !== "object") {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`Missing or invalid "resilience" section (expected object, got ${typeof obj.resilience})`,
		);
	}
	const res = obj.resilience as Record<string, unknown>;
	if (typeof res.resumeForced !== "boolean") {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`resilience.resumeForced must be a boolean (got ${typeof res.resumeForced})`,
		);
	}
	if (!res.retryCountByScope || typeof res.retryCountByScope !== "object" || Array.isArray(res.retryCountByScope)) {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`resilience.retryCountByScope must be an object (got ${typeof res.retryCountByScope})`,
		);
	}
	// Deep-validate retryCountByScope: all values must be numbers
	for (const [scope, count] of Object.entries(res.retryCountByScope as Record<string, unknown>)) {
		if (typeof count !== "number") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`resilience.retryCountByScope["${scope}"] must be a number (got ${typeof count})`,
			);
		}
	}
	if (res.lastFailureClass !== null && typeof res.lastFailureClass !== "string") {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`resilience.lastFailureClass must be a string or null (got ${typeof res.lastFailureClass})`,
		);
	}
	if (!Array.isArray(res.repairHistory)) {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`resilience.repairHistory must be an array (got ${typeof res.repairHistory})`,
		);
	}
	// Deep-validate repairHistory entries
	for (let i = 0; i < (res.repairHistory as unknown[]).length; i++) {
		const rec = (res.repairHistory as unknown[])[i];
		if (!rec || typeof rec !== "object") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`resilience.repairHistory[${i}] must be an object (got ${typeof rec})`,
			);
		}
		const r = rec as Record<string, unknown>;
		if (typeof r.id !== "string") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`resilience.repairHistory[${i}].id must be a string (got ${typeof r.id})`,
			);
		}
		if (typeof r.strategy !== "string") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`resilience.repairHistory[${i}].strategy must be a string (got ${typeof r.strategy})`,
			);
		}
		const VALID_REPAIR_STATUSES = new Set(["succeeded", "failed", "skipped"]);
		if (typeof r.status !== "string" || !VALID_REPAIR_STATUSES.has(r.status)) {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`resilience.repairHistory[${i}].status must be "succeeded"|"failed"|"skipped" (got ${JSON.stringify(r.status)})`,
			);
		}
		if (typeof r.startedAt !== "number") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`resilience.repairHistory[${i}].startedAt must be a number (got ${typeof r.startedAt})`,
			);
		}
		if (typeof r.endedAt !== "number") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`resilience.repairHistory[${i}].endedAt must be a number (got ${typeof r.endedAt})`,
			);
		}
		// repoId is optional — validate type only if present
		if (r.repoId !== undefined && typeof r.repoId !== "string") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`resilience.repairHistory[${i}].repoId must be a string when present (got ${typeof r.repoId})`,
			);
		}
	}

	// ── Validate v3 diagnostics section ──────────────────────────
	// After upconversion, diagnostics must be a valid object with correct types.
	if (!obj.diagnostics || typeof obj.diagnostics !== "object") {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`Missing or invalid "diagnostics" section (expected object, got ${typeof obj.diagnostics})`,
		);
	}
	const diag = obj.diagnostics as Record<string, unknown>;
	if (!diag.taskExits || typeof diag.taskExits !== "object" || Array.isArray(diag.taskExits)) {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`diagnostics.taskExits must be an object (got ${typeof diag.taskExits})`,
		);
	}
	// Deep-validate taskExits entries
	for (const [taskId, entry] of Object.entries(diag.taskExits as Record<string, unknown>)) {
		if (!entry || typeof entry !== "object") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`diagnostics.taskExits["${taskId}"] must be an object (got ${typeof entry})`,
			);
		}
		const te = entry as Record<string, unknown>;
		if (typeof te.classification !== "string") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`diagnostics.taskExits["${taskId}"].classification must be a string (got ${typeof te.classification})`,
			);
		}
		if (typeof te.cost !== "number") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`diagnostics.taskExits["${taskId}"].cost must be a number (got ${typeof te.cost})`,
			);
		}
		if (typeof te.durationSec !== "number") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`diagnostics.taskExits["${taskId}"].durationSec must be a number (got ${typeof te.durationSec})`,
			);
		}
		// retries is optional — validate type only if present
		if (te.retries !== undefined && typeof te.retries !== "number") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`diagnostics.taskExits["${taskId}"].retries must be a number when present (got ${typeof te.retries})`,
			);
		}
	}
	if (typeof diag.batchCost !== "number") {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`diagnostics.batchCost must be a number (got ${typeof diag.batchCost})`,
		);
	}

	// ── Validate exitDiagnostic on task records (optional) ───────
	for (let i = 0; i < tasks.length; i++) {
		const t = tasks[i] as Record<string, unknown>;
		if (t.exitDiagnostic !== undefined) {
			if (!t.exitDiagnostic || typeof t.exitDiagnostic !== "object") {
				throw new StateFileError(
					"STATE_SCHEMA_INVALID",
					`tasks[${i}].exitDiagnostic must be an object when present (got ${typeof t.exitDiagnostic})`,
				);
			}
			const ed = t.exitDiagnostic as Record<string, unknown>;
			if (typeof ed.classification !== "string") {
				throw new StateFileError(
					"STATE_SCHEMA_INVALID",
					`tasks[${i}].exitDiagnostic.classification must be a string (got ${typeof ed.classification})`,
				);
			}
		}
		// v4 optional fields: packetRepoId, packetTaskPath (string | undefined)
		if (t.packetRepoId !== undefined && typeof t.packetRepoId !== "string") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`tasks[${i}].packetRepoId is not a string (got ${typeof t.packetRepoId})`,
			);
		}
		if (t.packetTaskPath !== undefined && typeof t.packetTaskPath !== "string") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`tasks[${i}].packetTaskPath is not a string (got ${typeof t.packetTaskPath})`,
			);
		}
		// v4 optional field: segmentIds (string[] | undefined)
		if (t.segmentIds !== undefined) {
			if (!Array.isArray(t.segmentIds)) {
				throw new StateFileError(
					"STATE_SCHEMA_INVALID",
					`tasks[${i}].segmentIds is not an array (got ${typeof t.segmentIds})`,
				);
			}
			for (let j = 0; j < (t.segmentIds as unknown[]).length; j++) {
				if (typeof (t.segmentIds as unknown[])[j] !== "string") {
					throw new StateFileError(
						"STATE_SCHEMA_INVALID",
						`tasks[${i}].segmentIds[${j}] is not a string`,
					);
				}
			}
		}
		// v4 optional field: activeSegmentId (string | null | undefined)
		if (t.activeSegmentId !== undefined && t.activeSegmentId !== null && typeof t.activeSegmentId !== "string") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`tasks[${i}].activeSegmentId is not a string or null (got ${typeof t.activeSegmentId})`,
			);
		}
	}

	// ── Validate v4 segments array ───────────────────────────────
	if (!Array.isArray(obj.segments)) {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`Missing or invalid "segments" field (expected array, got ${typeof obj.segments})`,
		);
	}
	const segments = obj.segments as unknown[];
	for (let i = 0; i < segments.length; i++) {
		const s = segments[i] as Record<string, unknown>;
		if (!s || typeof s !== "object") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`segments[${i}] is not an object`,
			);
		}
		// Required string fields
		for (const field of ["segmentId", "taskId", "repoId", "laneId", "sessionName", "worktreePath", "branch", "exitReason"] as const) {
			if (typeof s[field] !== "string") {
				throw new StateFileError(
					"STATE_SCHEMA_INVALID",
					`segments[${i}].${field} is missing or not a string (got ${typeof s[field]})`,
				);
			}
		}
		// Required status field (same valid values as task status)
		if (typeof s.status !== "string" || !VALID_TASK_STATUSES.has(s.status)) {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`segments[${i}].status is invalid: "${s.status}" (expected one of: ${[...VALID_TASK_STATUSES].join(", ")})`,
			);
		}
		// Nullable number fields: startedAt, endedAt
		if (s.startedAt !== null && typeof s.startedAt !== "number") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`segments[${i}].startedAt is not a number or null (got ${typeof s.startedAt})`,
			);
		}
		if (s.endedAt !== null && typeof s.endedAt !== "number") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`segments[${i}].endedAt is not a number or null (got ${typeof s.endedAt})`,
			);
		}
		// Required number: retries
		if (typeof s.retries !== "number") {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`segments[${i}].retries is not a number (got ${typeof s.retries})`,
			);
		}
		// Required array: dependsOnSegmentIds
		if (!Array.isArray(s.dependsOnSegmentIds)) {
			throw new StateFileError(
				"STATE_SCHEMA_INVALID",
				`segments[${i}].dependsOnSegmentIds is not an array (got ${typeof s.dependsOnSegmentIds})`,
			);
		}
		for (let j = 0; j < (s.dependsOnSegmentIds as unknown[]).length; j++) {
			if (typeof (s.dependsOnSegmentIds as unknown[])[j] !== "string") {
				throw new StateFileError(
					"STATE_SCHEMA_INVALID",
					`segments[${i}].dependsOnSegmentIds[${j}] is not a string`,
				);
			}
		}
		// Optional exitDiagnostic
		if (s.exitDiagnostic !== undefined) {
			if (!s.exitDiagnostic || typeof s.exitDiagnostic !== "object" || Array.isArray(s.exitDiagnostic)) {
				throw new StateFileError(
					"STATE_SCHEMA_INVALID",
					`segments[${i}].exitDiagnostic is not a plain object (got ${Array.isArray(s.exitDiagnostic) ? "array" : typeof s.exitDiagnostic})`,
				);
			}
			if (typeof (s.exitDiagnostic as Record<string, unknown>).classification !== "string") {
				throw new StateFileError(
					"STATE_SCHEMA_INVALID",
					`segments[${i}].exitDiagnostic.classification is not a string`,
				);
			}
		}
	}

	// ── Capture unknown top-level fields for roundtrip preservation ──
	// Any fields not in the known schema are preserved so they survive
	// serialization. This protects against data loss from future schema
	// extensions or external tools writing additional fields.
	const KNOWN_TOP_LEVEL_FIELDS = new Set([
		"schemaVersion", "phase", "batchId", "baseBranch", "orchBranch", "mode",
		"startedAt", "updatedAt", "endedAt", "currentWaveIndex", "totalWaves",
		"wavePlan", "lanes", "tasks", "mergeResults",
		"totalTasks", "succeededTasks", "failedTasks", "skippedTasks", "blockedTasks",
		"blockedTaskIds", "lastError", "errors",
		"resilience", "diagnostics",
		"segments",
		"_extraFields",
	]);
	const extraFields: Record<string, unknown> = {};
	for (const key of Object.keys(obj)) {
		if (!KNOWN_TOP_LEVEL_FIELDS.has(key)) {
			extraFields[key] = obj[key];
		}
	}
	if (Object.keys(extraFields).length > 0) {
		obj._extraFields = extraFields;
	}

	return obj as unknown as PersistedBatchState;
}

// ── Serialization ────────────────────────────────────────────────────

/**
 * Serialize runtime batch state to a PersistedBatchState JSON string.
 *
 * Pure function: extracts the serializable subset from OrchBatchRuntimeState
 * and its associated wave results, enriches with schema version and timestamps.
 *
 * @param state       - Current runtime batch state
 * @param wavePlan    - Wave plan (array of arrays of task IDs)
 * @param lanes       - Currently allocated lanes (latest wave's lanes)
 * @param allTaskOutcomes - All task outcomes across completed waves + current
 * @returns JSON string (pretty-printed for debuggability)
 */
export function serializeBatchState(
	state: OrchBatchRuntimeState,
	wavePlan: string[][],
	lanes: AllocatedLane[],
	allTaskOutcomes: LaneTaskOutcome[],
): string {
	const now = Date.now();

	// Build lookup maps for fast per-task enrichment.
	const laneByTaskId = new Map<string, AllocatedLane>();
	for (const lane of lanes) {
		for (const task of lane.tasks) {
			laneByTaskId.set(task.taskId, lane);
		}
	}

	// Latest outcome wins (allTaskOutcomes is append/replace ordered by time).
	const outcomeByTaskId = new Map<string, LaneTaskOutcome>();
	for (const outcome of allTaskOutcomes) {
		outcomeByTaskId.set(outcome.taskId, outcome);
	}

	// Build full task registry from wave plan + any outcomes seen so far.
	const taskIdSet = new Set<string>();
	for (const wave of wavePlan) {
		for (const taskId of wave) taskIdSet.add(taskId);
	}
	for (const outcome of allTaskOutcomes) {
		taskIdSet.add(outcome.taskId);
	}

	// Build a lookup from taskId → AllocatedTask (which holds the ParsedTask with repo fields).
	const allocatedTaskByTaskId = new Map<string, { allocatedTask: import("./types.ts").AllocatedTask; lane: AllocatedLane }>();
	for (const lane of lanes) {
		for (const allocTask of lane.tasks) {
			allocatedTaskByTaskId.set(allocTask.taskId, { allocatedTask: allocTask, lane });
		}
	}

	const taskRecords: PersistedTaskRecord[] = [...taskIdSet]
		.sort()
		.map((taskId) => {
			const lane = laneByTaskId.get(taskId);
			const outcome = outcomeByTaskId.get(taskId);
			const allocated = allocatedTaskByTaskId.get(taskId);

			const record: PersistedTaskRecord = {
				taskId,
				laneNumber: lane?.laneNumber ?? outcome?.laneNumber ?? 0,
				sessionName: outcome?.sessionName || lane?.laneSessionId || "",
				status: outcome?.status ?? "pending",
				taskFolder: "", // Enriched by caller from discovery
				startedAt: outcome?.startTime ?? null,
				endedAt: outcome?.endTime ?? null,
				doneFileFound: outcome?.doneFileFound ?? false,
				exitReason: outcome?.exitReason ?? "",
			};

			// v2: Serialize repo-aware fields from the ParsedTask
			if (allocated?.allocatedTask.task?.promptRepoId !== undefined) {
				record.repoId = allocated.allocatedTask.task.promptRepoId;
			}
			if (allocated?.allocatedTask.task?.resolvedRepoId !== undefined) {
				record.resolvedRepoId = allocated.allocatedTask.task.resolvedRepoId;
			}

			// TP-028: Serialize partial progress fields from task outcome
			if (outcome?.partialProgressCommits !== undefined) {
				record.partialProgressCommits = outcome.partialProgressCommits;
			}
			if (outcome?.partialProgressBranch !== undefined) {
				record.partialProgressBranch = outcome.partialProgressBranch;
			}

			// TP-030 v3: Serialize exit diagnostic from task outcome
			if (outcome?.exitDiagnostic !== undefined) {
				record.exitDiagnostic = outcome.exitDiagnostic;
			}

			// TP-081 v4: Serialize segment-level fields from ParsedTask or existing state
			if (allocated?.allocatedTask.task?.packetRepoId !== undefined) {
				(record as any).packetRepoId = allocated.allocatedTask.task.packetRepoId;
			}
			if (allocated?.allocatedTask.task?.packetTaskPath !== undefined) {
				(record as any).packetTaskPath = allocated.allocatedTask.task.packetTaskPath;
			}
			if (allocated?.allocatedTask.task?.segmentIds !== undefined) {
				(record as any).segmentIds = allocated.allocatedTask.task.segmentIds;
			}
			if (allocated?.allocatedTask.task?.activeSegmentId !== undefined) {
				(record as any).activeSegmentId = allocated.allocatedTask.task.activeSegmentId;
			}

			return record;
		});

	// Build lane records
	const laneRecords: PersistedLaneRecord[] = lanes.map((lane) => {
		const record: PersistedLaneRecord = {
			laneNumber: lane.laneNumber,
			laneId: lane.laneId,
			laneSessionId: lane.laneSessionId,
			worktreePath: lane.worktreePath,
			branch: lane.branch,
			taskIds: lane.tasks.map((t) => t.taskId),
		};
		if (lane.repoId !== undefined) {
			record.repoId = lane.repoId;
		}
		return record;
	});

	// Build merge results from actual merge outcomes (accumulated on batchState).
	// MergeWaveResult.waveIndex is 1-based (from merge module); normalize to
	// 0-based for PersistedMergeResult (dashboard renders as "Wave N+1").
	// Clamp to 0 minimum: resume re-exec merges use sentinel waveIndex -1,
	// which would produce -2 without clamping.
	const mergeResults: PersistedMergeResult[] = (state.mergeResults || [])
		.map((mr) => {
			const record: PersistedMergeResult = {
				waveIndex: Math.max(0, mr.waveIndex - 1),
				status: mr.status,
				failedLane: mr.failedLane,
				failureReason: mr.failureReason,
			};
			// v2 (TP-009): Serialize per-repo merge outcomes when available (workspace mode).
			if (mr.repoResults && mr.repoResults.length > 0) {
				record.repoResults = mr.repoResults.map((rr) => ({
					repoId: rr.repoId,
					status: rr.status,
					laneNumbers: rr.laneResults.map((lr) => lr.laneNumber),
					failedLane: rr.failedLane,
					failureReason: rr.failureReason,
				}));
			}
			return record;
		});

	const persisted: PersistedBatchState = {
		schemaVersion: BATCH_STATE_SCHEMA_VERSION,
		phase: state.phase,
		batchId: state.batchId,
		baseBranch: state.baseBranch,
		orchBranch: state.orchBranch ?? "",
		mode: state.mode ?? "repo",
		startedAt: state.startedAt,
		updatedAt: now,
		endedAt: state.endedAt,
		currentWaveIndex: state.currentWaveIndex,
		totalWaves: state.totalWaves,
		wavePlan,
		lanes: laneRecords,
		tasks: taskRecords,
		mergeResults,
		totalTasks: state.totalTasks,
		succeededTasks: state.succeededTasks,
		failedTasks: state.failedTasks,
		skippedTasks: state.skippedTasks,
		blockedTasks: state.blockedTasks,
		blockedTaskIds: [...state.blockedTaskIds],
		lastError: state.errors.length > 0
			? { code: "BATCH_ERROR", message: state.errors[state.errors.length - 1] }
			: null,
		errors: [...state.errors],
		resilience: state.resilience ?? defaultResilienceState(),
		diagnostics: state.diagnostics ?? defaultBatchDiagnostics(),
		segments: state.segments ?? [],
	};

	// Merge unknown fields from loaded state to preserve roundtrip fidelity.
	// Extra fields are placed at the end of the object (after known schema fields)
	// and will not overwrite any known field.
	if (state._extraFields) {
		const output = persisted as Record<string, unknown>;
		for (const [key, value] of Object.entries(state._extraFields)) {
			if (!(key in output)) {
				output[key] = value;
			}
		}
	}

	return JSON.stringify(persisted, null, 2);
}

// ── File Operations ──────────────────────────────────────────────────

/** Maximum retries for atomic write (Windows file locking). */
export const STATE_WRITE_MAX_RETRIES = 3;

/** Delay between write retries (ms). */
export const STATE_WRITE_RETRY_DELAY_MS = 500;

/**
 * Save batch state to `.pi/batch-state.json` with atomic write.
 *
 * Strategy: write to a temp file (`.pi/batch-state.json.tmp`), then
 * rename to the final path. This prevents partial writes from corrupting
 * the state file.
 *
 * On Windows, rename can fail if another process holds a handle on the
 * target file. We retry up to STATE_WRITE_MAX_RETRIES times with a
 * short delay.
 *
 * @param json     - JSON string to write (from serializeBatchState)
 * @param repoRoot - Absolute path to the repository root
 * @throws StateFileError with STATE_FILE_IO_ERROR on failure
 */
export function saveBatchState(json: string, repoRoot: string): void {
	const finalPath = batchStatePath(repoRoot);
	const tmpPath = `${finalPath}.tmp`;
	const dir = dirname(finalPath);

	// Ensure .pi directory exists
	if (!existsSync(dir)) {
		try {
			mkdirSync(dir, { recursive: true });
		} catch (err: unknown) {
			throw new StateFileError(
				"STATE_FILE_IO_ERROR",
				`Failed to create directory "${dir}": ${(err as Error).message}`,
			);
		}
	}

	// Write to temp file
	try {
		writeFileSync(tmpPath, json, "utf-8");
	} catch (err: unknown) {
		throw new StateFileError(
			"STATE_FILE_IO_ERROR",
			`Failed to write temp state file "${tmpPath}": ${(err as Error).message}`,
		);
	}

	// Atomic rename with retry for Windows file locking
	let lastError: Error | null = null;
	for (let attempt = 1; attempt <= STATE_WRITE_MAX_RETRIES; attempt++) {
		try {
			renameSync(tmpPath, finalPath);
			return; // Success
		} catch (err: unknown) {
			lastError = err as Error;
			if (attempt < STATE_WRITE_MAX_RETRIES) {
				sleepSync(STATE_WRITE_RETRY_DELAY_MS);
			}
		}
	}

	// All retries exhausted — clean up temp file if possible
	try { unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }

	throw new StateFileError(
		"STATE_FILE_IO_ERROR",
		`Failed to atomically save state file "${finalPath}" after ` +
		`${STATE_WRITE_MAX_RETRIES} attempts: ${lastError?.message ?? "unknown error"}`,
	);
}

/**
 * Load and validate batch state from `.pi/batch-state.json`.
 *
 * @param repoRoot - Absolute path to the repository root
 * @returns Validated PersistedBatchState, or null if file doesn't exist
 * @throws StateFileError with STATE_FILE_PARSE_ERROR if file contains invalid JSON
 * @throws StateFileError with STATE_SCHEMA_INVALID if JSON fails validation
 */
export function loadBatchState(repoRoot: string): PersistedBatchState | null {
	const filePath = batchStatePath(repoRoot);

	if (!existsSync(filePath)) {
		return null;
	}

	let raw: string;
	try {
		raw = readFileSync(filePath, "utf-8");
	} catch (err: unknown) {
		throw new StateFileError(
			"STATE_FILE_IO_ERROR",
			`Failed to read state file "${filePath}": ${(err as Error).message}`,
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err: unknown) {
		throw new StateFileError(
			"STATE_FILE_PARSE_ERROR",
			`State file "${filePath}" contains invalid JSON: ${(err as Error).message}`,
		);
	}

	return validatePersistedState(parsed);
}

/**
 * Delete the batch state file. Idempotent: no error if file doesn't exist.
 *
 * @param repoRoot - Absolute path to the repository root
 * @throws StateFileError with STATE_FILE_IO_ERROR on unexpected deletion failure
 */
export function deleteBatchState(repoRoot: string): void {
	const filePath = batchStatePath(repoRoot);

	if (!existsSync(filePath)) {
		return; // Already gone — idempotent
	}

	try {
		unlinkSync(filePath);
	} catch (err: unknown) {
		// If file was deleted between our check and unlink, that's fine
		if (!existsSync(filePath)) return;
		throw new StateFileError(
			"STATE_FILE_IO_ERROR",
			`Failed to delete state file "${filePath}": ${(err as Error).message}`,
		);
	}
}


// ── Orphan Detection (TS-009 Step 3) ─────────────────────────────────

/**
 * Status of the persisted batch state file.
 *
 * - "valid"    — File exists, parsed, and validated successfully
 * - "missing"  — File does not exist (normal for fresh start)
 * - "invalid"  — File exists but has parse or schema errors
 * - "io-error" — File could not be read due to I/O error
 */
export type OrphanStateStatus = "valid" | "missing" | "invalid" | "io-error";

/**
 * Recommended action based on orphan detection analysis.
 *
 * - "resume"         — Orphan sessions + valid state, or no orphans + valid state with incomplete tasks: suggest /orch-resume
 * - "abort-orphans"  — Orphan sessions without usable state: suggest /orch-abort
 * - "cleanup-stale"  — No orphans + stale/valid/completed state: auto-delete and start fresh
 * - "paused-corrupt" — No orphans + corrupt/unreadable state file: do NOT auto-delete; notify user to inspect or manually remove
 * - "start-fresh"    — No orphans, no state file: proceed normally
 */
export type OrphanRecommendedAction = "resume" | "abort-orphans" | "cleanup-stale" | "paused-corrupt" | "start-fresh";

/**
 * Result of orphan detection analysis.
 *
 * Machine-usable fields enable both automated handling and user notification.
 * The `userMessage` provides a human-readable summary for display.
 */
export interface OrphanDetectionResult {
	/** TMUX sessions matching the orchestrator prefix that were found alive */
	orphanSessions: string[];
	/** Status of the persisted batch state file */
	stateStatus: OrphanStateStatus;
	/** Loaded and validated batch state (null if missing, invalid, or io-error) */
	loadedState: PersistedBatchState | null;
	/** Error message if state loading failed (null otherwise) */
	stateError: string | null;
	/** Deterministic recommended action */
	recommendedAction: OrphanRecommendedAction;
	/** Human-readable message for user notification */
	userMessage: string;
}

/**
 * Parse TMUX `list-sessions -F "#{session_name}"` output.
 *
 * Filters session names by the given prefix (e.g., "orch" matches "orch-lane-1").
 * Handles empty output, blank lines, and whitespace-padded names gracefully.
 *
 * Pure function — no process or filesystem access.
 *
 * @param stdout  - Raw stdout from `tmux list-sessions -F "#{session_name}"`
 * @param prefix  - Session name prefix to filter by (e.g., "orch")
 * @returns Sorted array of matching session names
 */
export function parseOrchSessionNames(stdout: string, prefix: string): string[] {
	if (!stdout || !stdout.trim()) return [];

	const filterPrefix = `${prefix}-`;

	return stdout
		.split("\n")
		.map(line => line.trim())
		.filter(name => name.length > 0 && name.startsWith(filterPrefix))
		.sort();
}

/**
 * Analyze orchestrator startup state — pure deterministic decision logic.
 *
 * Given the current state of TMUX sessions, batch state file, and task
 * completion markers, returns a deterministic recommendation for what
 * the `/orch` command should do.
 *
 * Decision matrix:
 * | Orphans? | State Status | Done? | Action          |
 * |----------|-------------|-------|-----------------|
 * | Yes      | valid       | —     | resume          |
 * | Yes      | missing     | —     | abort-orphans   |
 * | Yes      | invalid     | —     | abort-orphans   |
 * | Yes      | io-error    | —     | abort-orphans   |
 * | No       | valid       | all   | cleanup-stale   |
 * | No       | valid       | !all  | resume          |
 * | No       | missing     | —     | start-fresh     |
 * | No       | invalid     | —     | paused-corrupt  |
 * | No       | io-error    | —     | paused-corrupt  |
 *
 * Pure function — no process or filesystem access.
 *
 * @param orphanSessions - TMUX sessions matching the orch prefix
 * @param stateStatus    - Status of the batch state file
 * @param loadedState    - Validated batch state (null if unavailable)
 * @param stateError     - Error message from state loading (null if no error)
 * @param doneTaskIds    - Set of task IDs whose .DONE files were found
 * @returns OrphanDetectionResult with recommended action
 */
export function analyzeOrchestratorStartupState(
	orphanSessions: string[],
	stateStatus: OrphanStateStatus,
	loadedState: PersistedBatchState | null,
	stateError: string | null,
	doneTaskIds: ReadonlySet<string>,
): OrphanDetectionResult {
	const hasOrphans = orphanSessions.length > 0;
	const sessionList = orphanSessions.join(", ");

	// ── Orphan sessions exist ────────────────────────────────────
	if (hasOrphans) {
		if (stateStatus === "valid" && loadedState) {
			return {
				orphanSessions,
				stateStatus,
				loadedState,
				stateError,
				recommendedAction: "resume",
				userMessage:
					`🔄 Found ${orphanSessions.length} running orchestrator session(s): ${sessionList}\n` +
					`   Batch ${loadedState.batchId} (${loadedState.phase}) has persisted state.\n` +
					`   Use /orch-resume to continue, or /orch-abort to clean up.`,
			};
		}

		// Orphans without usable state (missing, invalid, or io-error)
		const errorCtx = stateError ? `\n   State error: ${stateError}` : "";
		return {
			orphanSessions,
			stateStatus,
			loadedState: null,
			stateError,
			recommendedAction: "abort-orphans",
			userMessage:
				`⚠️ Found ${orphanSessions.length} orphan orchestrator session(s): ${sessionList}\n` +
				`   No usable batch state file (status: ${stateStatus}).${errorCtx}\n` +
				`   Use /orch-abort to clean up before starting a new batch.`,
		};
	}

	// ── No orphan sessions ───────────────────────────────────────

	if (stateStatus === "missing") {
		return {
			orphanSessions: [],
			stateStatus,
			loadedState: null,
			stateError,
			recommendedAction: "start-fresh",
			userMessage: "", // No message needed for clean start
		};
	}

	if (stateStatus === "valid" && loadedState) {
		// Check if all tasks completed (all have .DONE files)
		const allTaskIds = loadedState.tasks.map(t => t.taskId);
		const allDone = allTaskIds.length > 0 && allTaskIds.every(id => doneTaskIds.has(id));

		if (allDone) {
			return {
				orphanSessions: [],
				stateStatus,
				loadedState,
				stateError,
				recommendedAction: "cleanup-stale",
				userMessage:
					`🧹 Found stale batch state file from batch ${loadedState.batchId}.\n` +
					`   All ${allTaskIds.length} task(s) have .DONE files. Cleaning up state file.`,
			};
		}

		// Not all tasks done — batch was interrupted (crashed orchestrator)
		const completedCount = allTaskIds.filter(id => doneTaskIds.has(id)).length;

		// Only phases that resumeOrchBatch can actually handle should get "resume".
		// "failed" / "stopped" / "idle" / "planning" are non-resumable — if nothing
		// ran yet (completedCount === 0) the state file is pure noise; auto-clean it
		// so /orch can start fresh without forcing the user through /orch-abort first.
		const resumablePhases: OrchBatchPhase[] = ["paused", "executing", "merging"];
		const isResumable = resumablePhases.includes(loadedState.phase as OrchBatchPhase);

		if (!isResumable && completedCount === 0) {
			return {
				orphanSessions: [],
				stateStatus,
				loadedState,
				stateError,
				recommendedAction: "cleanup-stale",
				userMessage:
					`🧹 Found non-resumable batch state (${loadedState.batchId}, phase=${loadedState.phase}, 0 tasks ran).\n` +
					`   Cleaning up stale state file so a fresh batch can start.`,
			};
		}

		return {
			orphanSessions: [],
			stateStatus,
			loadedState,
			stateError,
			recommendedAction: isResumable ? "resume" : "cleanup-stale",
			userMessage: isResumable
				? `🔄 Found interrupted batch ${loadedState.batchId} (${loadedState.phase}).\n` +
				  `   ${completedCount}/${allTaskIds.length} task(s) completed.\n` +
				  `   Use /orch-resume to continue, or /orch-abort to clean up.`
				: `🧹 Found non-resumable batch state (${loadedState.batchId}, phase=${loadedState.phase}).\n` +
				  `   ${completedCount}/${allTaskIds.length} task(s) completed. Cleaning up state file.`,
		};
	}

	// Invalid or io-error state with no orphans — corrupt state.
	// Never auto-delete: enter paused-corrupt so the user can inspect the file
	// and decide whether to manually recover or remove it.
	return {
		orphanSessions: [],
		stateStatus,
		loadedState: null,
		stateError,
		recommendedAction: "paused-corrupt",
		userMessage:
			`⚠️ Batch state file is corrupt or unreadable (${stateStatus}).\n` +
			(stateError ? `   Error: ${stateError}\n` : "") +
			`   The file has NOT been deleted. Inspect .pi/batch-state.json manually,\n` +
			`   then either fix it or delete it and run /orch again.`,
	};
}

/**
 * Detect orphan orchestrator state and analyze startup recovery action.
 *
 * Runtime V2 no longer relies on TMUX session discovery. Startup decisions
 * are based on persisted batch state plus task .DONE markers.
 *
 * @param prefix   - Legacy orchestrator session prefix (unused in Runtime V2)
 * @param repoRoot - Absolute path to the repository root
 * @returns OrphanDetectionResult with recommended action
 */
export function detectOrphanSessions(prefix: string, repoRoot: string): OrphanDetectionResult {
	void prefix;

	// Runtime V2 uses persisted state as the source of truth for orphan analysis.
	const orphanSessions: string[] = [];

	// ── 1. Load batch state file ─────────────────────────────────
	let stateStatus: OrphanStateStatus = "missing";
	let loadedState: PersistedBatchState | null = null;
	let stateError: string | null = null;

	try {
		loadedState = loadBatchState(repoRoot);
		stateStatus = loadedState ? "valid" : "missing";
	} catch (err: unknown) {
		if (err instanceof StateFileError) {
			switch (err.code) {
				case "STATE_FILE_PARSE_ERROR":
				case "STATE_SCHEMA_INVALID":
					stateStatus = "invalid";
					stateError = `[${err.code}] ${err.message}`;
					break;
				case "STATE_FILE_IO_ERROR":
					stateStatus = "io-error";
					stateError = `[${err.code}] ${err.message}`;
					break;
			}
		} else {
			stateStatus = "io-error";
			stateError = err instanceof Error ? err.message : String(err);
		}
	}

	// ── 2. Check .DONE files for stale state detection ───────────
	const doneTaskIds = new Set<string>();
	if (loadedState && orphanSessions.length === 0) {
		// Only check .DONE files when we have state but no orphans
		// (stale state scenario — sessions finished while orchestrator was disconnected)
		for (const task of loadedState.tasks) {
			if (task.taskFolder && hasTaskDoneMarker(task.taskFolder)) {
				doneTaskIds.add(task.taskId);
			}
		}
	}

	// ── 3. Analyze and return ────────────────────────────────────
	return analyzeOrchestratorStartupState(
		orphanSessions,
		stateStatus,
		loadedState,
		stateError,
		doneTaskIds,
	);
}


// ── Batch History ────────────────────────────────────────────────────

/** Path to the batch history file. */
function batchHistoryPath(repoRoot: string): string {
	return join(repoRoot, ".pi", "batch-history.json");
}

/**
 * Load existing batch history entries from disk.
 * Returns empty array if file doesn't exist or is invalid.
 */
export function loadBatchHistory(repoRoot: string): BatchHistorySummary[] {
	const filePath = batchHistoryPath(repoRoot);
	try {
		if (!existsSync(filePath)) return [];
		const raw = readFileSync(filePath, "utf-8");
		const data = JSON.parse(raw);
		if (!Array.isArray(data)) return [];
		return data;
	} catch {
		return [];
	}
}

/**
 * Append a batch summary to history and trim to max entries.
 * Writes atomically via tmp+rename pattern.
 */
export function saveBatchHistory(repoRoot: string, summary: BatchHistorySummary): void {
	const filePath = batchHistoryPath(repoRoot);
	try {
		const history = loadBatchHistory(repoRoot);
		// Prepend newest first
		history.unshift(summary);
		// Trim to max
		if (history.length > BATCH_HISTORY_MAX_ENTRIES) {
			history.length = BATCH_HISTORY_MAX_ENTRIES;
		}
		const dir = dirname(filePath);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		const tmpPath = filePath + ".tmp";
		writeFileSync(tmpPath, JSON.stringify(history, null, 2));
		renameSync(tmpPath, filePath);
		execLog("batch", "history", `saved batch summary (${history.length} entries)`);
	} catch (err) {
		execLog("batch", "history", `failed to save batch history: ${err}`);
	}
}


// ── Tier 0 Supervisor Event Logging (TP-039 Step 2) ─────────────────

/**
 * Event types emitted by Tier 0 recovery actions.
 *
 * - `tier0_recovery_attempt` — A recovery action is being tried
 * - `tier0_recovery_success` — Recovery succeeded
 * - `tier0_recovery_exhausted` — Retry budget exhausted, escalation needed
 * - `tier0_escalation` — Escalation to supervisor (emitted alongside exhausted)
 *
 * @since TP-039
 */
export type Tier0EventType =
	| "tier0_recovery_attempt"
	| "tier0_recovery_success"
	| "tier0_recovery_exhausted"
	| "tier0_escalation";

/**
 * Structured event written to `.pi/supervisor/events.jsonl`.
 *
 * Each event contains enough context for the supervisor agent (Tier 1)
 * to understand what happened and decide next actions.
 *
 * @since TP-039
 */
export interface Tier0Event {
	/** ISO 8601 timestamp */
	timestamp: string;
	/** Event type */
	type: Tier0EventType;
	/** Batch identifier */
	batchId: string;
	/** Wave index (0-based) */
	waveIndex: number;
	/** Recovery pattern being applied */
	pattern: Tier0RecoveryPattern | "merge_timeout";
	/** Current attempt number (1-based) */
	attempt: number;
	/** Maximum attempts allowed */
	maxAttempts: number;
	/** Affected task ID (for task-scoped patterns like worker_crash) */
	taskId?: string;
	/** Lane number (for lane-scoped patterns) */
	laneNumber?: number;
	/** Repo ID (for workspace-mode attribution; null/undefined for repo-mode) */
	repoId?: string | null;
	/** Exit classification or error type */
	classification?: string;
	/** Error message (for exhausted events) */
	error?: string;
	/** Resolution description (for success events) */
	resolution?: string;
	/** Cooldown/timeout in milliseconds before retry (for attempt events) */
	cooldownMs?: number;
	/** Scope key used for retry counter tracking */
	scopeKey?: string;
	/** Affected task IDs (for escalation context in exhausted events) */
	affectedTaskIds?: string[];
	/** Suggested remediation (for exhausted events) */
	suggestion?: string;
	/** Typed escalation payload (present only on `tier0_escalation` events) */
	escalation?: EscalationContext;
}

/**
 * Build the required base fields for a Tier 0 event.
 *
 * Ensures consistent field population across all emit sites so
 * supervisor consumers get a deterministic event shape.
 *
 * @since TP-039 R004
 */
export function buildTier0EventBase(
	type: Tier0EventType,
	batchId: string,
	waveIndex: number,
	pattern: Tier0RecoveryPattern | "merge_timeout",
	attempt: number,
	maxAttempts: number,
): Pick<Tier0Event, "timestamp" | "type" | "batchId" | "waveIndex" | "pattern" | "attempt" | "maxAttempts"> {
	return {
		timestamp: new Date().toISOString(),
		type,
		batchId,
		waveIndex,
		pattern,
		attempt,
		maxAttempts,
	};
}

/**
 * Emit a Tier 0 event to `.pi/supervisor/events.jsonl`.
 *
 * Best-effort: creates the directory if needed, appends the event as a
 * single JSONL line. Failures are logged but never crash the batch.
 *
 * @param stateRoot - Root directory for state files (workspace root or repo root)
 * @param event     - The event to emit
 *
 * @since TP-039
 */
export function emitTier0Event(stateRoot: string, event: Tier0Event): void {
	try {
		const supervisorDir = join(stateRoot, ".pi", "supervisor");
		if (!existsSync(supervisorDir)) {
			mkdirSync(supervisorDir, { recursive: true });
		}
		const eventsPath = join(supervisorDir, "events.jsonl");
		const line = JSON.stringify(event) + "\n";
		appendFileSync(eventsPath, line);
	} catch (err: unknown) {
		// Best-effort: log but don't crash the batch
		const msg = err instanceof Error ? err.message : String(err);
		execLog("batch", event.batchId, `tier0 event write failed: ${msg}`, {
			eventType: event.type,
			pattern: event.pattern,
		});
	}
}


// ── Engine Event Logging (TP-040) ───────────────────────────────────

/**
 * Emit an engine lifecycle event to `.pi/supervisor/events.jsonl`.
 *
 * Shares the same JSONL file as Tier 0 events for unified consumption
 * by the supervisor agent. Engine events cover batch lifecycle transitions
 * (wave start/end, task completion, merge phases, batch terminal states).
 *
 * Best-effort: creates the directory if needed, appends the event as a
 * single JSONL line. Failures are logged but never crash the batch.
 *
 * Also invokes the optional event callback for in-process consumers
 * (command handler, dashboard).
 *
 * @param stateRoot - Root directory for state files (workspace root or repo root)
 * @param event     - The engine event to emit
 * @param callback  - Optional in-process event callback
 *
 * @since TP-040
 */
export function emitEngineEvent(
	stateRoot: string,
	event: EngineEvent,
	callback?: ((event: EngineEvent) => void) | null,
): void {
	// Write to JSONL file (same path as Tier 0 events)
	try {
		const supervisorDir = join(stateRoot, ".pi", "supervisor");
		if (!existsSync(supervisorDir)) {
			mkdirSync(supervisorDir, { recursive: true });
		}
		const eventsPath = join(supervisorDir, "events.jsonl");
		const line = JSON.stringify(event) + "\n";
		appendFileSync(eventsPath, line);
	} catch (err: unknown) {
		// Best-effort: log but don't crash the batch
		const msg = err instanceof Error ? err.message : String(err);
		execLog("batch", event.batchId, `engine event write failed: ${msg}`, {
			eventType: event.type,
		});
	}

	// Invoke in-process callback
	if (callback) {
		try {
			callback(event);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			execLog("batch", event.batchId, `engine event callback failed: ${msg}`, {
				eventType: event.type,
			});
		}
	}
}

