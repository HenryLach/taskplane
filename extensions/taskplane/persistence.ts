/**
 * State persistence, serialization, orphan detection
 * @module orch/persistence
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync, renameSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { join, dirname, basename } from "path";

import { execLog } from "./execution.ts";
import { BATCH_STATE_SCHEMA_VERSION, StateFileError, batchStatePath, BATCH_HISTORY_MAX_ENTRIES } from "./types.ts";
import type { BatchHistorySummary } from "./types.ts";
import type { AllocatedLane, DiscoveryResult, LaneTaskOutcome, LaneTaskStatus, MonitorState, OrchBatchPhase, OrchBatchRuntimeState, PersistedBatchState, PersistedLaneRecord, PersistedMergeResult, PersistedTaskRecord, TaskMonitorSnapshot } from "./types.ts";
import { sleepSync } from "./worktree.ts";

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
 * Upsert a task outcome in-place. Returns true if changed.
 */
export function upsertTaskOutcome(outcomes: LaneTaskOutcome[], next: LaneTaskOutcome): boolean {
	const idx = outcomes.findIndex(o => o.taskId === next.taskId);
	if (idx < 0) {
		outcomes.push(next);
		return true;
	}

	const prev = outcomes[idx];
	const changed =
		prev.status !== next.status ||
		prev.startTime !== next.startTime ||
		prev.endTime !== next.endTime ||
		prev.exitReason !== next.exitReason ||
		prev.sessionName !== next.sessionName ||
		prev.doneFileFound !== next.doneFileFound;

	if (changed) {
		outcomes[idx] = next;
	}
	return changed;
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
				sessionName: lane.tmuxSessionName,
				doneFileFound: false,
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
			}) || changed;
		}

		// Completed tasks => succeeded
		for (const taskId of lane.completedTasks) {
			const existing = outcomes.find(o => o.taskId === taskId);
			changed = upsertTaskOutcome(outcomes, {
				taskId,
				status: "succeeded",
				startTime: existing?.startTime ?? null,
				endTime: monitorState.lastPollTime,
				exitReason: existing?.exitReason || ".DONE file created by task-runner",
				sessionName: existing?.sessionName || lane.sessionName,
				doneFileFound: true,
			}) || changed;
		}

		// Failed tasks => failed
		for (const taskId of lane.failedTasks) {
			const existing = outcomes.find(o => o.taskId === taskId);
			changed = upsertTaskOutcome(outcomes, {
				taskId,
				status: "failed",
				startTime: existing?.startTime ?? null,
				endTime: monitorState.lastPollTime,
				exitReason: existing?.exitReason || "Task failed or stalled",
				sessionName: existing?.sessionName || lane.sessionName,
				doneFileFound: false,
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

			changed = upsertTaskOutcome(outcomes, {
				taskId: lane.currentTaskId,
				status: mappedStatus,
				startTime: existing?.startTime ?? snap.lastHeartbeat ?? snap.observedAt,
				endTime: terminal ? (existing?.endTime ?? snap.observedAt) : null,
				exitReason: existing?.exitReason || (mappedStatus === "running" ? "Task in progress" : (snap.stallReason || "Task reached terminal state")),
				sessionName: existing?.sessionName || lane.sessionName,
				doneFileFound: snap.doneFileFound,
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

		// Enrich task records with folder paths from discovery
		if (discovery) {
			const parsed = JSON.parse(json) as PersistedBatchState;
			for (const taskRecord of parsed.tasks) {
				const parsedTask = discovery.pending.get(taskRecord.taskId);
				if (parsedTask) {
					taskRecord.taskFolder = parsedTask.taskFolder;
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
	"idle", "planning", "executing", "merging", "paused", "stopped", "completed", "failed",
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
 * Validate a parsed JSON object as a PersistedBatchState.
 *
 * Checks:
 * 1. Schema version matches BATCH_STATE_SCHEMA_VERSION
 * 2. All required fields are present with correct types
 * 3. Enum fields contain valid values (phase, task statuses, merge statuses)
 * 4. Arrays contain valid sub-records
 *
 * @param data - Parsed JSON (unknown type)
 * @returns Validated PersistedBatchState
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
	if (obj.schemaVersion !== BATCH_STATE_SCHEMA_VERSION) {
		throw new StateFileError(
			"STATE_SCHEMA_INVALID",
			`Unsupported schema version ${obj.schemaVersion} (expected ${BATCH_STATE_SCHEMA_VERSION}). ` +
			`Delete .pi/batch-state.json and re-run the batch.`,
		);
	}

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
		for (const field of ["laneId", "tmuxSessionName", "worktreePath", "branch"] as const) {
			if (typeof l[field] !== "string") {
				throw new StateFileError(
					"STATE_SCHEMA_INVALID",
					`lanes[${i}].${field} is missing or not a string`,
				);
			}
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

	// Default baseBranch for backward compatibility with older state files
	if (!obj.baseBranch) {
		(obj as any).baseBranch = "";
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

	const taskRecords: PersistedTaskRecord[] = [...taskIdSet]
		.sort()
		.map((taskId) => {
			const lane = laneByTaskId.get(taskId);
			const outcome = outcomeByTaskId.get(taskId);

			return {
				taskId,
				laneNumber: lane?.laneNumber ?? 0,
				sessionName: outcome?.sessionName || lane?.tmuxSessionName || "",
				status: outcome?.status ?? "pending",
				taskFolder: "", // Enriched by caller from discovery
				startedAt: outcome?.startTime ?? null,
				endedAt: outcome?.endTime ?? null,
				doneFileFound: outcome?.doneFileFound ?? false,
				exitReason: outcome?.exitReason ?? "",
			};
		});

	// Build lane records
	const laneRecords: PersistedLaneRecord[] = lanes.map((lane) => ({
		laneNumber: lane.laneNumber,
		laneId: lane.laneId,
		tmuxSessionName: lane.tmuxSessionName,
		worktreePath: lane.worktreePath,
		branch: lane.branch,
		taskIds: lane.tasks.map((t) => t.taskId),
	}));

	// Build merge results from actual merge outcomes (accumulated on batchState).
	// MergeWaveResult.waveIndex is 1-based (from merge module); normalize to
	// 0-based for PersistedMergeResult (dashboard renders as "Wave N+1").
	const mergeResults: PersistedMergeResult[] = (state.mergeResults || [])
		.map((mr) => ({
			waveIndex: mr.waveIndex - 1,
			status: mr.status,
			failedLane: mr.failedLane,
			failureReason: mr.failureReason,
		}));

	const persisted: PersistedBatchState = {
		schemaVersion: BATCH_STATE_SCHEMA_VERSION,
		phase: state.phase,
		batchId: state.batchId,
		baseBranch: state.baseBranch,
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
	};

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
 * - "cleanup-stale"  — No orphans + stale/invalid state file: auto-delete and start fresh
 * - "start-fresh"    — No orphans, no state file: proceed normally
 */
export type OrphanRecommendedAction = "resume" | "abort-orphans" | "cleanup-stale" | "start-fresh";

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
 * | No       | invalid     | —     | cleanup-stale   |
 * | No       | io-error    | —     | cleanup-stale   |
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

	// Invalid or io-error state with no orphans — safe to clean up
	return {
		orphanSessions: [],
		stateStatus,
		loadedState: null,
		stateError,
		recommendedAction: "cleanup-stale",
		userMessage:
			`🧹 Found unusable batch state file (${stateStatus}).\n` +
			(stateError ? `   Error: ${stateError}\n` : "") +
			`   Cleaning up state file before starting fresh.`,
	};
}

/**
 * Detect orphan TMUX sessions and analyze startup state.
 *
 * Combines session discovery (via tmux), state file loading (with typed
 * error handling), and .DONE file checking into a single result.
 *
 * Non-blocking: detection failures (e.g., tmux not running) are handled
 * gracefully and do NOT crash `/orch` startup.
 *
 * @param prefix   - TMUX session prefix to search for (e.g., "orch")
 * @param repoRoot - Absolute path to the repository root
 * @returns OrphanDetectionResult with recommended action
 */
export function detectOrphanSessions(prefix: string, repoRoot: string): OrphanDetectionResult {
	// ── 1. Discover TMUX sessions ────────────────────────────────
	let orphanSessions: string[] = [];
	try {
		const stdout = execSync('tmux list-sessions -F "#{session_name}"', {
			encoding: "utf-8",
			timeout: 5000,
		});
		orphanSessions = parseOrchSessionNames(stdout, prefix);
	} catch {
		// tmux not available or no sessions — proceed with empty orphan list
	}

	// ── 2. Load batch state file ─────────────────────────────────
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

	// ── 3. Check .DONE files for stale state detection ───────────
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

	// ── 4. Analyze and return ────────────────────────────────────
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

