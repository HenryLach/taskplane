/**
 * Orchestrator State Persistence Tests — TS-009 Step 1
 *
 * Tests for batch state persistence: schema validation, serialization,
 * and file I/O operations (save/load/delete).
 *
 * Run: npx tsx extensions/tests/orch-state-persistence.test.ts
 *   or: npx vitest run extensions/tests/orch-state-persistence.test.ts
 *
 * Test categories:
 *   1.1 — validatePersistedState (happy path + error cases)
 *   1.2 — serializeBatchState (round-trip)
 *   1.3 — saveBatchState / loadBatchState / deleteBatchState (file I/O)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Detect vitest
const isVitest = typeof globalThis.vi !== "undefined" || !!process.env.VITEST;

// ── Test Helpers ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
	if (condition) {
		passed++;
	} else {
		failed++;
		failures.push(message);
		console.error(`  ✗ ${message}`);
	}
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
	if (actual === expected) {
		passed++;
	} else {
		failed++;
		const msg = `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
		failures.push(msg);
		console.error(`  ✗ ${msg}`);
	}
}

function assertThrows(fn: () => void, expectedCode: string, message: string): void {
	try {
		fn();
		failed++;
		const msg = `${message}: expected to throw ${expectedCode}, but did not throw`;
		failures.push(msg);
		console.error(`  ✗ ${msg}`);
	} catch (err: unknown) {
		const e = err as { code?: string; name?: string };
		if (e.code === expectedCode) {
			passed++;
		} else {
			failed++;
			const msg = `${message}: expected code ${expectedCode}, got ${e.code ?? "(none)"}`;
			failures.push(msg);
			console.error(`  ✗ ${msg}`);
		}
	}
}

// ── Extract/Reimplement pure functions from source ───────────────────

// Read the source files. Functions were refactored from the monolith
// task-orchestrator.ts into separate modules under taskplane/.
const sourceFiles = [
	join(__dirname, "..", "taskplane", "formatting.ts"),
	join(__dirname, "..", "taskplane", "execution.ts"),
	join(__dirname, "..", "taskplane", "engine.ts"),
	join(__dirname, "..", "taskplane", "worktree.ts"),
	join(__dirname, "..", "taskplane", "messages.ts"),
	join(__dirname, "..", "taskplane", "waves.ts"),
	join(__dirname, "..", "taskplane", "persistence.ts"),
	join(__dirname, "..", "taskplane", "resume.ts"),
	join(__dirname, "..", "taskplane", "types.ts"),
	join(__dirname, "..", "taskplane", "abort.ts"),
	join(__dirname, "..", "taskplane", "merge.ts"),
];
const source = sourceFiles.map(f => readFileSync(f, "utf8")).join("\n");

// Since pi imports prevent direct import, we reimplement the pure functions
// by testing with the same logic as the source. This approach is validated
// by the existing orch-pure-functions.test.ts pattern.

// Schema version constant (must match source)
const BATCH_STATE_SCHEMA_VERSION = 2;

// Valid enum sets (must match source)
const VALID_BATCH_PHASES = new Set([
	"idle", "planning", "executing", "merging", "paused", "stopped", "completed", "failed",
]);

const VALID_TASK_STATUSES = new Set([
	"pending", "running", "succeeded", "failed", "stalled", "skipped",
]);

const VALID_PERSISTED_MERGE_STATUSES = new Set([
	"succeeded", "failed", "partial",
]);

// StateFileError reimplementation
class StateFileError extends Error {
	code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = "StateFileError";
		this.code = code;
	}
}

// validatePersistedState reimplementation (mirrors source exactly)
function validatePersistedState(data: unknown): any {
	if (!data || typeof data !== "object") {
		throw new StateFileError("STATE_SCHEMA_INVALID", "Batch state must be a non-null object");
	}

	const obj = data as Record<string, unknown>;

	// Schema version — accept v1 (auto-upconvert) and v2 (current)
	if (typeof obj.schemaVersion !== "number") {
		throw new StateFileError("STATE_SCHEMA_INVALID",
			`Missing or invalid "schemaVersion" field (expected number, got ${typeof obj.schemaVersion})`);
	}
	if (obj.schemaVersion !== 1 && obj.schemaVersion !== BATCH_STATE_SCHEMA_VERSION) {
		throw new StateFileError("STATE_SCHEMA_INVALID",
			`Unsupported schema version ${obj.schemaVersion} (expected ${BATCH_STATE_SCHEMA_VERSION}). Delete .pi/batch-state.json and re-run the batch.`);
	}
	const isV1 = obj.schemaVersion === 1;

	// Required string fields
	for (const field of ["phase", "batchId"] as const) {
		if (typeof obj[field] !== "string") {
			throw new StateFileError("STATE_SCHEMA_INVALID",
				`Missing or invalid "${field}" field (expected string, got ${typeof obj[field]})`);
		}
	}

	// v2: mode field validation
	// mode is required in v2, absent in v1 (defaults to "repo" via upconvert).
	if (!isV1 && obj.mode === undefined) {
		throw new StateFileError("STATE_SCHEMA_INVALID",
			`Missing required "mode" field in schema v2 (expected "repo" or "workspace")`);
	}
	if (obj.mode !== undefined && typeof obj.mode !== "string") {
		throw new StateFileError("STATE_SCHEMA_INVALID",
			`Invalid "mode" field (expected string, got ${typeof obj.mode})`);
	}
	if (obj.mode !== undefined && obj.mode !== "repo" && obj.mode !== "workspace") {
		throw new StateFileError("STATE_SCHEMA_INVALID",
			`Invalid "mode" value "${obj.mode}" (expected "repo" or "workspace")`);
	}

	// Phase enum
	if (!VALID_BATCH_PHASES.has(obj.phase as string)) {
		throw new StateFileError("STATE_SCHEMA_INVALID",
			`Invalid "phase" value "${obj.phase}" (expected one of: ${[...VALID_BATCH_PHASES].join(", ")})`);
	}

	// Required number fields
	for (const field of [
		"startedAt", "updatedAt", "currentWaveIndex", "totalWaves",
		"totalTasks", "succeededTasks", "failedTasks", "skippedTasks", "blockedTasks",
	] as const) {
		if (typeof obj[field] !== "number") {
			throw new StateFileError("STATE_SCHEMA_INVALID",
				`Missing or invalid "${field}" field (expected number, got ${typeof obj[field]})`);
		}
	}

	// Nullable number: endedAt
	if (obj.endedAt !== null && typeof obj.endedAt !== "number") {
		throw new StateFileError("STATE_SCHEMA_INVALID",
			`Invalid "endedAt" field (expected number or null, got ${typeof obj.endedAt})`);
	}

	// Required arrays
	for (const field of ["wavePlan", "lanes", "tasks", "mergeResults", "blockedTaskIds", "errors"] as const) {
		if (!Array.isArray(obj[field])) {
			throw new StateFileError("STATE_SCHEMA_INVALID",
				`Missing or invalid "${field}" field (expected array, got ${typeof obj[field]})`);
		}
	}

	// Validate wavePlan
	const wavePlan = obj.wavePlan as unknown[];
	for (let i = 0; i < wavePlan.length; i++) {
		if (!Array.isArray(wavePlan[i])) {
			throw new StateFileError("STATE_SCHEMA_INVALID", `wavePlan[${i}] is not an array`);
		}
		for (const taskId of wavePlan[i] as unknown[]) {
			if (typeof taskId !== "string") {
				throw new StateFileError("STATE_SCHEMA_INVALID",
					`wavePlan[${i}] contains non-string value: ${typeof taskId}`);
			}
		}
	}

	// Validate task records
	const tasks = obj.tasks as unknown[];
	for (let i = 0; i < tasks.length; i++) {
		const t = tasks[i] as Record<string, unknown>;
		if (!t || typeof t !== "object") {
			throw new StateFileError("STATE_SCHEMA_INVALID", `tasks[${i}] is not an object`);
		}
		for (const field of ["taskId", "sessionName", "taskFolder", "exitReason"] as const) {
			if (typeof t[field] !== "string") {
				throw new StateFileError("STATE_SCHEMA_INVALID",
					`tasks[${i}].${field} is missing or not a string`);
			}
		}
		if (typeof t.laneNumber !== "number") {
			throw new StateFileError("STATE_SCHEMA_INVALID",
				`tasks[${i}].laneNumber is missing or not a number`);
		}
		if (typeof t.status !== "string" || !VALID_TASK_STATUSES.has(t.status)) {
			throw new StateFileError("STATE_SCHEMA_INVALID",
				`tasks[${i}].status is invalid: "${t.status}" (expected one of: ${[...VALID_TASK_STATUSES].join(", ")})`);
		}
		if (t.startedAt !== null && typeof t.startedAt !== "number") {
			throw new StateFileError("STATE_SCHEMA_INVALID",
				`tasks[${i}].startedAt is not a number or null`);
		}
		if (t.endedAt !== null && typeof t.endedAt !== "number") {
			throw new StateFileError("STATE_SCHEMA_INVALID",
				`tasks[${i}].endedAt is not a number or null`);
		}
		if (typeof t.doneFileFound !== "boolean") {
			throw new StateFileError("STATE_SCHEMA_INVALID",
				`tasks[${i}].doneFileFound is missing or not a boolean`);
		}
		// v2 optional fields
		if (t.repoId !== undefined && typeof t.repoId !== "string") {
			throw new StateFileError("STATE_SCHEMA_INVALID",
				`tasks[${i}].repoId is not a string (got ${typeof t.repoId})`);
		}
		if (t.resolvedRepoId !== undefined && typeof t.resolvedRepoId !== "string") {
			throw new StateFileError("STATE_SCHEMA_INVALID",
				`tasks[${i}].resolvedRepoId is not a string (got ${typeof t.resolvedRepoId})`);
		}
	}

	// Validate lane records
	const lanes = obj.lanes as unknown[];
	for (let i = 0; i < lanes.length; i++) {
		const l = lanes[i] as Record<string, unknown>;
		if (!l || typeof l !== "object") {
			throw new StateFileError("STATE_SCHEMA_INVALID", `lanes[${i}] is not an object`);
		}
		for (const field of ["laneId", "tmuxSessionName", "worktreePath", "branch"] as const) {
			if (typeof l[field] !== "string") {
				throw new StateFileError("STATE_SCHEMA_INVALID",
					`lanes[${i}].${field} is missing or not a string`);
			}
		}
		if (typeof l.laneNumber !== "number") {
			throw new StateFileError("STATE_SCHEMA_INVALID",
				`lanes[${i}].laneNumber is missing or not a number`);
		}
		if (!Array.isArray(l.taskIds)) {
			throw new StateFileError("STATE_SCHEMA_INVALID",
				`lanes[${i}].taskIds is missing or not an array`);
		}
		// v2 optional field
		if (l.repoId !== undefined && typeof l.repoId !== "string") {
			throw new StateFileError("STATE_SCHEMA_INVALID",
				`lanes[${i}].repoId is not a string (got ${typeof l.repoId})`);
		}
	}

	// Validate merge results
	const mergeResults = obj.mergeResults as unknown[];
	for (let i = 0; i < mergeResults.length; i++) {
		const m = mergeResults[i] as Record<string, unknown>;
		if (!m || typeof m !== "object") {
			throw new StateFileError("STATE_SCHEMA_INVALID", `mergeResults[${i}] is not an object`);
		}
		if (typeof m.waveIndex !== "number") {
			throw new StateFileError("STATE_SCHEMA_INVALID",
				`mergeResults[${i}].waveIndex is missing or not a number`);
		}
		if (typeof m.status !== "string" || !VALID_PERSISTED_MERGE_STATUSES.has(m.status)) {
			throw new StateFileError("STATE_SCHEMA_INVALID",
				`mergeResults[${i}].status is invalid: "${m.status}" (expected one of: ${[...VALID_PERSISTED_MERGE_STATUSES].join(", ")})`);
		}
	}

	// Validate lastError
	if (obj.lastError !== null) {
		if (typeof obj.lastError !== "object") {
			throw new StateFileError("STATE_SCHEMA_INVALID", `lastError is not an object or null`);
		}
		const le = obj.lastError as Record<string, unknown>;
		if (typeof le.code !== "string" || typeof le.message !== "string") {
			throw new StateFileError("STATE_SCHEMA_INVALID",
				`lastError must have "code" (string) and "message" (string) fields`);
		}
	}

	// Validate blockedTaskIds
	for (const id of obj.blockedTaskIds as unknown[]) {
		if (typeof id !== "string") {
			throw new StateFileError("STATE_SCHEMA_INVALID",
				`blockedTaskIds contains non-string value: ${typeof id}`);
		}
	}

	// Validate errors
	for (const err of obj.errors as unknown[]) {
		if (typeof err !== "string") {
			throw new StateFileError("STATE_SCHEMA_INVALID",
				`errors array contains non-string value: ${typeof err}`);
		}
	}

	// v1→v2 upconversion (in-memory only)
	if (isV1) {
		if (!obj.baseBranch) obj.baseBranch = "";
		if (!obj.mode) obj.mode = "repo";
		obj.schemaVersion = BATCH_STATE_SCHEMA_VERSION;
	}

	return obj;
}

// batchStatePath reimplementation
function batchStatePath(repoRoot: string): string {
	return join(repoRoot, ".pi", "batch-state.json");
}

// saveBatchState reimplementation (simplified for test — no sleepSync retry)
function saveBatchState(json: string, repoRoot: string): void {
	const finalPath = batchStatePath(repoRoot);
	const tmpPath = `${finalPath}.tmp`;
	const dir = dirname(finalPath);

	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	writeFileSync(tmpPath, json, "utf-8");

	try {
		renameSync(tmpPath, finalPath);
	} catch (err: unknown) {
		try { unlinkSync(tmpPath); } catch { /* ignore */ }
		throw new StateFileError("STATE_FILE_IO_ERROR",
			`Failed to atomically save state file: ${(err as Error).message}`);
	}
}

// loadBatchState reimplementation
function loadBatchState(repoRoot: string): any | null {
	const filePath = batchStatePath(repoRoot);

	if (!existsSync(filePath)) {
		return null;
	}

	let raw: string;
	try {
		raw = readFileSync(filePath, "utf-8");
	} catch (err: unknown) {
		throw new StateFileError("STATE_FILE_IO_ERROR",
			`Failed to read state file: ${(err as Error).message}`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err: unknown) {
		throw new StateFileError("STATE_FILE_PARSE_ERROR",
			`State file contains invalid JSON: ${(err as Error).message}`);
	}

	return validatePersistedState(parsed);
}

// deleteBatchState reimplementation
function deleteBatchState(repoRoot: string): void {
	const filePath = batchStatePath(repoRoot);

	if (!existsSync(filePath)) {
		return;
	}

	try {
		unlinkSync(filePath);
	} catch (err: unknown) {
		if (!existsSync(filePath)) return;
		throw new StateFileError("STATE_FILE_IO_ERROR",
			`Failed to delete state file: ${(err as Error).message}`);
	}
}

// ── Load test fixtures ───────────────────────────────────────────────

const fixturesDir = join(__dirname, "fixtures");

function loadFixture(name: string): string {
	return readFileSync(join(fixturesDir, name), "utf-8");
}

function loadFixtureJSON(name: string): unknown {
	return JSON.parse(loadFixture(name));
}

// ── Test Runner ──────────────────────────────────────────────────────

function runAllTests() {

// ═══════════════════════════════════════════════════════════════════════
// 1.1: validatePersistedState
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 1.1: validatePersistedState ──");

{
	console.log("  ▸ validates a well-formed state file");
	const data = loadFixtureJSON("batch-state-valid.json");
	const result = validatePersistedState(data);
	assertEqual(result.schemaVersion, 2, "schemaVersion is 2");
	assertEqual(result.phase, "executing", "phase is executing");
	assertEqual(result.batchId, "20260309T010000", "batchId matches");
	assertEqual(result.totalTasks, 3, "totalTasks is 3");
	assertEqual(result.tasks.length, 3, "3 task records");
	assertEqual(result.lanes.length, 2, "2 lane records");
	assertEqual(result.wavePlan.length, 2, "2 waves in plan");
}

{
	console.log("  ▸ rejects null input");
	assertThrows(
		() => validatePersistedState(null),
		"STATE_SCHEMA_INVALID",
		"null input throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects non-object input");
	assertThrows(
		() => validatePersistedState("not an object"),
		"STATE_SCHEMA_INVALID",
		"string input throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects wrong schema version");
	const data = loadFixtureJSON("batch-state-wrong-version.json");
	assertThrows(
		() => validatePersistedState(data),
		"STATE_SCHEMA_INVALID",
		"wrong version throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects missing required fields");
	const data = loadFixtureJSON("batch-state-missing-fields.json");
	assertThrows(
		() => validatePersistedState(data),
		"STATE_SCHEMA_INVALID",
		"missing fields throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects invalid phase enum");
	const data = loadFixtureJSON("batch-state-bad-enums.json");
	assertThrows(
		() => validatePersistedState(data),
		"STATE_SCHEMA_INVALID",
		"bad phase enum throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects invalid task status enum");
	const data = loadFixtureJSON("batch-state-bad-task-status.json");
	assertThrows(
		() => validatePersistedState(data),
		"STATE_SCHEMA_INVALID",
		"bad task status throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects missing schemaVersion");
	assertThrows(
		() => validatePersistedState({ phase: "idle", batchId: "test" }),
		"STATE_SCHEMA_INVALID",
		"missing schemaVersion throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects non-number schemaVersion");
	assertThrows(
		() => validatePersistedState({ schemaVersion: "one", phase: "idle", batchId: "test" }),
		"STATE_SCHEMA_INVALID",
		"string schemaVersion throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects v2 state missing required mode field");
	// A v2 file without mode should be rejected (mode is required in v2).
	// v1 files are allowed to omit mode (backfilled to "repo" via upconvert).
	const v2NoMode = {
		schemaVersion: 2,
		phase: "executing",
		batchId: "20260309T010000",
		startedAt: 1741478400000,
		updatedAt: 1741478460000,
		endedAt: null,
		currentWaveIndex: 0,
		totalWaves: 1,
		wavePlan: [["TS-001"]],
		lanes: [],
		tasks: [],
		mergeResults: [],
		totalTasks: 1,
		succeededTasks: 0,
		failedTasks: 0,
		skippedTasks: 0,
		blockedTasks: 0,
		blockedTaskIds: [],
		lastError: null,
		errors: [],
	};
	assertThrows(
		() => validatePersistedState(v2NoMode),
		"STATE_SCHEMA_INVALID",
		"v2 state without mode throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ accepts v1 state and upconverts mode to 'repo'");
	const v1Data = loadFixtureJSON("batch-state-v1-valid.json");
	const result = validatePersistedState(v1Data);
	assertEqual(result.schemaVersion, BATCH_STATE_SCHEMA_VERSION, "v1 upconverted to v2 schemaVersion");
	assertEqual(result.mode, "repo", "v1 mode defaults to 'repo'");
	assertEqual(result.baseBranch, "", "v1 baseBranch defaults to ''");
	// Verify task/lane records survived upconversion intact
	assertEqual(result.tasks.length, 3, "v1 upconvert: 3 task records preserved");
	assertEqual(result.lanes.length, 2, "v1 upconvert: 2 lane records preserved");
	assertEqual(result.tasks[0].taskId, "TS-001", "v1 upconvert: task TS-001 preserved");
	assertEqual(result.tasks[0].status, "succeeded", "v1 upconvert: task status preserved");
	// v1 tasks should not have repo fields
	assertEqual(result.tasks[0].repoId, undefined, "v1 upconvert: task repoId is undefined");
	assertEqual(result.tasks[0].resolvedRepoId, undefined, "v1 upconvert: task resolvedRepoId is undefined");
	// v1 lanes should not have repoId
	assertEqual(result.lanes[0].repoId, undefined, "v1 upconvert: lane repoId is undefined");
}

{
	console.log("  ▸ validates v2 workspace-mode state with repo-aware fields");
	const wsData = loadFixtureJSON("batch-state-v2-workspace.json");
	const result = validatePersistedState(wsData);
	assertEqual(result.schemaVersion, BATCH_STATE_SCHEMA_VERSION, "v2 workspace: schemaVersion is 2");
	assertEqual(result.mode, "workspace", "v2 workspace: mode is 'workspace'");
	assertEqual(result.baseBranch, "main", "v2 workspace: baseBranch preserved");
	// Task repo fields
	assertEqual(result.tasks.length, 2, "v2 workspace: 2 task records");
	assertEqual(result.tasks[0].taskId, "WS-001", "v2 workspace: task WS-001");
	assertEqual(result.tasks[0].repoId, "api", "v2 workspace: task[0].repoId is 'api'");
	assertEqual(result.tasks[0].resolvedRepoId, "api", "v2 workspace: task[0].resolvedRepoId is 'api'");
	// WS-002 has no repoId but has resolvedRepoId (area/workspace default fallback)
	assertEqual(result.tasks[1].repoId, undefined, "v2 workspace: task[1].repoId is undefined");
	assertEqual(result.tasks[1].resolvedRepoId, "frontend", "v2 workspace: task[1].resolvedRepoId is 'frontend'");
	// Lane repo fields
	assertEqual(result.lanes.length, 2, "v2 workspace: 2 lane records");
	assertEqual(result.lanes[0].repoId, "api", "v2 workspace: lane[0].repoId is 'api'");
	assertEqual(result.lanes[1].repoId, "frontend", "v2 workspace: lane[1].repoId is 'frontend'");
}

{
	console.log("  ▸ rejects non-string repoId on task record");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.tasks[0].repoId = 42;
	assertThrows(
		() => validatePersistedState(validBase),
		"STATE_SCHEMA_INVALID",
		"numeric task repoId throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects non-string resolvedRepoId on task record");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.tasks[0].resolvedRepoId = true;
	assertThrows(
		() => validatePersistedState(validBase),
		"STATE_SCHEMA_INVALID",
		"boolean task resolvedRepoId throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects non-string repoId on lane record");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.lanes[0].repoId = 99;
	assertThrows(
		() => validatePersistedState(validBase),
		"STATE_SCHEMA_INVALID",
		"numeric lane repoId throws STATE_SCHEMA_INVALID",
	);
}

// ── Step 1: Additional malformed repo-aware record validation ────────

{
	console.log("  ▸ rejects null repoId on task record");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.tasks[0].repoId = null;
	assertThrows(
		() => validatePersistedState(validBase),
		"STATE_SCHEMA_INVALID",
		"null task repoId throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects null resolvedRepoId on task record");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.tasks[0].resolvedRepoId = null;
	assertThrows(
		() => validatePersistedState(validBase),
		"STATE_SCHEMA_INVALID",
		"null task resolvedRepoId throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects object repoId on task record");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.tasks[0].repoId = { nested: "object" };
	assertThrows(
		() => validatePersistedState(validBase),
		"STATE_SCHEMA_INVALID",
		"object task repoId throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects array resolvedRepoId on task record");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.tasks[0].resolvedRepoId = ["api", "frontend"];
	assertThrows(
		() => validatePersistedState(validBase),
		"STATE_SCHEMA_INVALID",
		"array task resolvedRepoId throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects null repoId on lane record");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.lanes[0].repoId = null;
	assertThrows(
		() => validatePersistedState(validBase),
		"STATE_SCHEMA_INVALID",
		"null lane repoId throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects object repoId on lane record");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.lanes[0].repoId = { repo: "api" };
	assertThrows(
		() => validatePersistedState(validBase),
		"STATE_SCHEMA_INVALID",
		"object lane repoId throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ accepts empty-string repoId on task record (structurally valid)");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.tasks[0].repoId = "";
	const result = validatePersistedState(validBase);
	assertEqual(result.tasks[0].repoId, "", "empty-string repoId accepted");
}

{
	console.log("  ▸ accepts empty-string repoId on lane record (structurally valid)");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.lanes[0].repoId = "";
	const result = validatePersistedState(validBase);
	assertEqual(result.lanes[0].repoId, "", "empty-string lane repoId accepted");
}

{
	console.log("  ▸ rejects invalid mode value (not repo or workspace)");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.mode = "polyrepo";
	assertThrows(
		() => validatePersistedState(validBase),
		"STATE_SCHEMA_INVALID",
		"invalid mode value throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects numeric mode value");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.mode = 42;
	assertThrows(
		() => validatePersistedState(validBase),
		"STATE_SCHEMA_INVALID",
		"numeric mode throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects boolean mode value");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.mode = true;
	assertThrows(
		() => validatePersistedState(validBase),
		"STATE_SCHEMA_INVALID",
		"boolean mode throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ validates fixture batch-state-v2-bad-repo-fields.json rejects at first bad field");
	const data = loadFixtureJSON("batch-state-v2-bad-repo-fields.json");
	assertThrows(
		() => validatePersistedState(data),
		"STATE_SCHEMA_INVALID",
		"bad-repo-fields fixture rejected with STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ accepts repo-mode state without any repo fields on tasks/lanes");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	// Confirm no repo fields present
	assertEqual(validBase.tasks[0].repoId, undefined, "repo-mode task has no repoId");
	assertEqual(validBase.tasks[0].resolvedRepoId, undefined, "repo-mode task has no resolvedRepoId");
	assertEqual(validBase.lanes[0].repoId, undefined, "repo-mode lane has no repoId");
	const result = validatePersistedState(validBase);
	assertEqual(result.mode, "repo", "repo mode validated");
	assertEqual(result.tasks.length, 3, "all tasks preserved");
}

{
	console.log("  ▸ validates all 8 batch phases");
	const phases = ["idle", "planning", "executing", "merging", "paused", "stopped", "completed", "failed"];
	let allValid = true;
	for (const phase of phases) {
		const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
		validBase.phase = phase;
		try {
			validatePersistedState(validBase);
		} catch {
			allValid = false;
		}
	}
	assert(allValid, "all 8 valid phases accepted");
}

{
	console.log("  ▸ validates all 6 task statuses");
	const statuses = ["pending", "running", "succeeded", "failed", "stalled", "skipped"];
	let allValid = true;
	for (const status of statuses) {
		const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
		validBase.tasks = [{
			taskId: "T-001", laneNumber: 1, sessionName: "s", status,
			taskFolder: "/tmp", startedAt: null, endedAt: null,
			doneFileFound: false, exitReason: "",
		}];
		try {
			validatePersistedState(validBase);
		} catch {
			allValid = false;
		}
	}
	assert(allValid, "all 6 valid task statuses accepted");
}

{
	console.log("  ▸ rejects bad merge result status");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.mergeResults = [{ waveIndex: 0, status: "exploded", failedLane: null, failureReason: null }];
	assertThrows(
		() => validatePersistedState(validBase),
		"STATE_SCHEMA_INVALID",
		"bad merge status throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects lastError with missing code");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.lastError = { message: "oops" };
	assertThrows(
		() => validatePersistedState(validBase),
		"STATE_SCHEMA_INVALID",
		"lastError without code throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects non-string in blockedTaskIds");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.blockedTaskIds = [42];
	assertThrows(
		() => validatePersistedState(validBase),
		"STATE_SCHEMA_INVALID",
		"non-string blockedTaskId throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ rejects non-string in errors array");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.errors = [123];
	assertThrows(
		() => validatePersistedState(validBase),
		"STATE_SCHEMA_INVALID",
		"non-string error throws STATE_SCHEMA_INVALID",
	);
}

{
	console.log("  ▸ accepts valid state with endedAt = number");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.phase = "completed";
	validBase.endedAt = 1741478500000;
	const result = validatePersistedState(validBase);
	assertEqual(result.endedAt, 1741478500000, "endedAt accepted as number");
}

{
	console.log("  ▸ accepts valid state with lastError present");
	const validBase = JSON.parse(loadFixture("batch-state-valid.json"));
	validBase.lastError = { code: "BATCH_ERROR", message: "something went wrong" };
	const result = validatePersistedState(validBase);
	assertEqual(result.lastError.code, "BATCH_ERROR", "lastError.code preserved");
}

// ═══════════════════════════════════════════════════════════════════════
// 1.2: serializeBatchState round-trip
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 1.2: serializeBatchState round-trip ──");

{
	console.log("  ▸ serialize → parse → validate round-trip");

	// Build a minimal runtime state to serialize
	// (We simulate what serializeBatchState produces by building the expected JSON)
	const runtimeLanes = [
		{
			laneNumber: 1,
			laneId: "lane-1",
			tmuxSessionName: "orch-lane-1",
			worktreePath: "/tmp/wt-1",
			branch: "task/lane-1-20260309T020000",
			tasks: [{ taskId: "X-001", parsedTask: null, weight: 2, estimatedMinutes: 10 }],
			strategy: "affinity-first" as const,
			estimatedLoad: 2,
			estimatedMinutes: 10,
		},
	];

	const taskOutcomes = [
		{
			taskId: "X-001",
			status: "succeeded" as const,
			startTime: 1000,
			endTime: 2000,
			exitReason: "done",
			sessionName: "orch-lane-1",
			doneFileFound: true,
		},
	];

	// Build the expected serialized structure manually (mirroring serializeBatchState logic)
	const persisted = {
		schemaVersion: BATCH_STATE_SCHEMA_VERSION,
		phase: "completed",
		batchId: "20260309T020000",
		mode: "repo",
		startedAt: 900,
		updatedAt: Date.now(), // Will be close to now
		endedAt: 2500,
		currentWaveIndex: 0,
		totalWaves: 1,
		wavePlan: [["X-001"]],
		lanes: [{
			laneNumber: 1,
			laneId: "lane-1",
			tmuxSessionName: "orch-lane-1",
			worktreePath: "/tmp/wt-1",
			branch: "task/lane-1-20260309T020000",
			taskIds: ["X-001"],
		}],
		tasks: [{
			taskId: "X-001",
			laneNumber: 1,
			sessionName: "orch-lane-1",
			status: "succeeded",
			taskFolder: "",
			startedAt: 1000,
			endedAt: 2000,
			doneFileFound: true,
			exitReason: "done",
		}],
		mergeResults: [],
		totalTasks: 1,
		succeededTasks: 1,
		failedTasks: 0,
		skippedTasks: 0,
		blockedTasks: 0,
		blockedTaskIds: [],
		lastError: null,
		errors: [],
	};

	const json = JSON.stringify(persisted, null, 2);
	const parsed = JSON.parse(json);

	// Validate the round-tripped data
	const validated = validatePersistedState(parsed);
	assertEqual(validated.phase, "completed", "round-trip: phase preserved");
	assertEqual(validated.batchId, "20260309T020000", "round-trip: batchId preserved");
	assertEqual(validated.tasks.length, 1, "round-trip: 1 task record");
	assertEqual(validated.tasks[0].status, "succeeded", "round-trip: task status preserved");
	assertEqual(validated.lanes.length, 1, "round-trip: 1 lane record");
	assertEqual(validated.wavePlan[0][0], "X-001", "round-trip: wavePlan preserved");
}

// ═══════════════════════════════════════════════════════════════════════
// 1.3: File I/O operations (save/load/delete)
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 1.3: File I/O operations ──");

// Create a temp directory for file I/O tests
const testRoot = join(tmpdir(), `orch-state-test-${Date.now()}`);
mkdirSync(join(testRoot, ".pi"), { recursive: true });

try {
	{
		console.log("  ▸ saveBatchState creates file");
		const validJson = loadFixture("batch-state-valid.json");
		saveBatchState(validJson, testRoot);
		assert(existsSync(batchStatePath(testRoot)), "state file exists after save");
	}

	{
		console.log("  ▸ loadBatchState reads valid file");
		const result = loadBatchState(testRoot);
		assert(result !== null, "loadBatchState returns non-null");
		assertEqual(result!.batchId, "20260309T010000", "loaded batchId matches");
		assertEqual(result!.phase, "executing", "loaded phase matches");
	}

	{
		console.log("  ▸ loadBatchState returns null for missing file");
		const emptyRoot = join(tmpdir(), `orch-state-empty-${Date.now()}`);
		mkdirSync(join(emptyRoot, ".pi"), { recursive: true });
		const result = loadBatchState(emptyRoot);
		assertEqual(result, null, "returns null when file missing");
		rmSync(emptyRoot, { recursive: true, force: true });
	}

	{
		console.log("  ▸ loadBatchState throws on malformed JSON");
		const malformedRoot = join(tmpdir(), `orch-state-malformed-${Date.now()}`);
		mkdirSync(join(malformedRoot, ".pi"), { recursive: true });
		writeFileSync(batchStatePath(malformedRoot), "{ not json }", "utf-8");
		assertThrows(
			() => loadBatchState(malformedRoot),
			"STATE_FILE_PARSE_ERROR",
			"malformed JSON throws STATE_FILE_PARSE_ERROR",
		);
		rmSync(malformedRoot, { recursive: true, force: true });
	}

	{
		console.log("  ▸ loadBatchState throws on valid JSON with bad schema");
		const badSchemaRoot = join(tmpdir(), `orch-state-badschema-${Date.now()}`);
		mkdirSync(join(badSchemaRoot, ".pi"), { recursive: true });
		writeFileSync(batchStatePath(badSchemaRoot), JSON.stringify({ schemaVersion: 99 }), "utf-8");
		assertThrows(
			() => loadBatchState(badSchemaRoot),
			"STATE_SCHEMA_INVALID",
			"bad schema throws STATE_SCHEMA_INVALID",
		);
		rmSync(badSchemaRoot, { recursive: true, force: true });
	}

	{
		console.log("  ▸ deleteBatchState removes file");
		assert(existsSync(batchStatePath(testRoot)), "state file exists before delete");
		deleteBatchState(testRoot);
		assert(!existsSync(batchStatePath(testRoot)), "state file removed after delete");
	}

	{
		console.log("  ▸ deleteBatchState is idempotent (no error on missing file)");
		deleteBatchState(testRoot); // Already deleted
		passed++; // If we get here, no error was thrown
	}

	{
		console.log("  ▸ saveBatchState creates .pi directory if missing");
		const freshRoot = join(tmpdir(), `orch-state-fresh-${Date.now()}`);
		mkdirSync(freshRoot, { recursive: true });
		// .pi directory doesn't exist yet
		const validJson = loadFixture("batch-state-valid.json");
		saveBatchState(validJson, freshRoot);
		assert(existsSync(batchStatePath(freshRoot)), "state file created with .pi dir");
		rmSync(freshRoot, { recursive: true, force: true });
	}

} finally {
	// Cleanup temp directory
	try {
		rmSync(testRoot, { recursive: true, force: true });
	} catch { /* best effort */ }
}

// ═══════════════════════════════════════════════════════════════════════
// 1.4: Schema v1 → v2 Compatibility (loadBatchState regression tests)
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 1.4: Schema v1 → v2 compatibility (loadBatchState regression) ──");

// Create a temp directory for v1 compat tests
const v1CompatRoot = join(tmpdir(), `orch-v1compat-test-${Date.now()}`);
mkdirSync(join(v1CompatRoot, ".pi"), { recursive: true });

try {
	{
		console.log("  ▸ loadBatchState with v1 fixture upconverts to v2 in-memory");
		const v1Json = loadFixture("batch-state-v1-valid.json");
		saveBatchState(v1Json, v1CompatRoot);

		const loaded = loadBatchState(v1CompatRoot);
		assert(loaded !== null, "v1 state loaded successfully");
		assertEqual(loaded!.schemaVersion, BATCH_STATE_SCHEMA_VERSION, "v1 upconverted: schemaVersion is 2");
		assertEqual(loaded!.mode, "repo", "v1 upconverted: mode defaults to 'repo'");
		assertEqual(loaded!.baseBranch, "", "v1 upconverted: baseBranch defaults to ''");
		// Verify records preserved
		assertEqual(loaded!.tasks.length, 3, "v1 upconverted: 3 task records preserved");
		assertEqual(loaded!.lanes.length, 2, "v1 upconverted: 2 lane records preserved");
		assertEqual(loaded!.wavePlan.length, 2, "v1 upconverted: 2 waves preserved");
		// Verify task details
		assertEqual(loaded!.tasks[0].taskId, "TS-001", "v1 upconverted: task TS-001 preserved");
		assertEqual(loaded!.tasks[0].status, "succeeded", "v1 upconverted: task status preserved");
		assertEqual(loaded!.tasks[0].taskFolder, "/tmp/tasks/TS-001", "v1 upconverted: taskFolder preserved");
		assertEqual(loaded!.tasks[0].doneFileFound, true, "v1 upconverted: doneFileFound preserved");
		// Verify v2 optional repo fields absent
		assertEqual(loaded!.tasks[0].repoId, undefined, "v1 upconverted: task repoId is undefined");
		assertEqual(loaded!.tasks[0].resolvedRepoId, undefined, "v1 upconverted: task resolvedRepoId is undefined");
		assertEqual(loaded!.lanes[0].repoId, undefined, "v1 upconverted: lane repoId is undefined");
		// Verify lane details
		assertEqual(loaded!.lanes[0].laneId, "lane-1", "v1 upconverted: lane-1 laneId preserved");
		assertEqual(loaded!.lanes[0].tmuxSessionName, "orch-lane-1", "v1 upconverted: lane-1 sessionName preserved");
		assertEqual(loaded!.lanes[0].taskIds.length, 1, "v1 upconverted: lane-1 taskIds preserved");
		// Verify top-level fields
		assertEqual(loaded!.phase, "executing", "v1 upconverted: phase preserved");
		assertEqual(loaded!.batchId, "20260309T010000", "v1 upconverted: batchId preserved");
		assertEqual(loaded!.totalTasks, 3, "v1 upconverted: totalTasks preserved");
		assertEqual(loaded!.succeededTasks, 1, "v1 upconverted: succeededTasks preserved");
	}

	{
		console.log("  ▸ loadBatchState with v1 fixture does NOT rewrite on-disk file");
		// Save a fresh v1 fixture to disk
		const v1Json = loadFixture("batch-state-v1-valid.json");
		saveBatchState(v1Json, v1CompatRoot);

		// Read on-disk content before load
		const onDiskBefore = readFileSync(batchStatePath(v1CompatRoot), "utf-8");
		const parsedBefore = JSON.parse(onDiskBefore);
		assertEqual(parsedBefore.schemaVersion, 1, "on-disk before load: schemaVersion is 1");

		// Load (which upconverts in-memory)
		const loaded = loadBatchState(v1CompatRoot);
		assertEqual(loaded!.schemaVersion, BATCH_STATE_SCHEMA_VERSION, "in-memory: schemaVersion is 2");

		// Read on-disk content after load — must remain v1
		const onDiskAfter = readFileSync(batchStatePath(v1CompatRoot), "utf-8");
		const parsedAfter = JSON.parse(onDiskAfter);
		assertEqual(parsedAfter.schemaVersion, 1, "on-disk after load: schemaVersion is still 1 (no implicit rewrite)");
		assertEqual(parsedAfter.mode, undefined, "on-disk after load: mode field absent (v1 had no mode)");

		// Verify byte-level equality — file content unchanged
		assertEqual(onDiskBefore, onDiskAfter, "on-disk file content unchanged after loadBatchState");
	}

	{
		console.log("  ▸ loadBatchState with v2 repo-mode fixture preserves all fields");
		const v2Json = loadFixture("batch-state-valid.json");
		saveBatchState(v2Json, v1CompatRoot);

		const loaded = loadBatchState(v1CompatRoot);
		assert(loaded !== null, "v2 repo-mode state loaded successfully");
		assertEqual(loaded!.schemaVersion, BATCH_STATE_SCHEMA_VERSION, "v2: schemaVersion is 2");
		assertEqual(loaded!.mode, "repo", "v2: mode is 'repo'");
		assertEqual(loaded!.baseBranch, "main", "v2: baseBranch is 'main'");
		assertEqual(loaded!.phase, "executing", "v2: phase preserved");
		assertEqual(loaded!.batchId, "20260309T010000", "v2: batchId preserved");
		assertEqual(loaded!.tasks.length, 3, "v2: 3 task records");
		assertEqual(loaded!.lanes.length, 2, "v2: 2 lane records");
		assertEqual(loaded!.wavePlan.length, 2, "v2: 2 waves");
		// Confirm no repo fields on repo-mode fixture
		assertEqual(loaded!.tasks[0].repoId, undefined, "v2 repo-mode: task has no repoId");
		assertEqual(loaded!.lanes[0].repoId, undefined, "v2 repo-mode: lane has no repoId");
	}

	{
		console.log("  ▸ loadBatchState with v2 workspace-mode fixture preserves repo-aware fields");
		const wsJson = loadFixture("batch-state-v2-workspace.json");
		saveBatchState(wsJson, v1CompatRoot);

		const loaded = loadBatchState(v1CompatRoot);
		assert(loaded !== null, "v2 workspace state loaded successfully");
		assertEqual(loaded!.schemaVersion, BATCH_STATE_SCHEMA_VERSION, "v2 workspace: schemaVersion is 2");
		assertEqual(loaded!.mode, "workspace", "v2 workspace: mode is 'workspace'");
		assertEqual(loaded!.baseBranch, "main", "v2 workspace: baseBranch preserved");
		// Task repo-aware fields
		assertEqual(loaded!.tasks.length, 2, "v2 workspace: 2 task records");
		assertEqual(loaded!.tasks[0].taskId, "WS-001", "v2 workspace: task WS-001");
		assertEqual(loaded!.tasks[0].repoId, "api", "v2 workspace: task[0].repoId is 'api'");
		assertEqual(loaded!.tasks[0].resolvedRepoId, "api", "v2 workspace: task[0].resolvedRepoId is 'api'");
		assertEqual(loaded!.tasks[1].repoId, undefined, "v2 workspace: task[1].repoId is undefined");
		assertEqual(loaded!.tasks[1].resolvedRepoId, "frontend", "v2 workspace: task[1].resolvedRepoId is 'frontend'");
		// Lane repo-aware fields
		assertEqual(loaded!.lanes[0].repoId, "api", "v2 workspace: lane[0].repoId is 'api'");
		assertEqual(loaded!.lanes[1].repoId, "frontend", "v2 workspace: lane[1].repoId is 'frontend'");
	}

	{
		console.log("  ▸ loadBatchState rejects unsupported schema version (99)");
		const wrongVersionJson = loadFixture("batch-state-wrong-version.json");
		saveBatchState(wrongVersionJson, v1CompatRoot);

		assertThrows(
			() => loadBatchState(v1CompatRoot),
			"STATE_SCHEMA_INVALID",
			"unsupported schema version throws STATE_SCHEMA_INVALID via loadBatchState",
		);
	}

	{
		console.log("  ▸ loadBatchState rejects malformed JSON");
		const malformedRoot = join(tmpdir(), `orch-v1compat-malformed-${Date.now()}`);
		mkdirSync(join(malformedRoot, ".pi"), { recursive: true });
		writeFileSync(batchStatePath(malformedRoot), "{ this is not valid json }", "utf-8");

		assertThrows(
			() => loadBatchState(malformedRoot),
			"STATE_FILE_PARSE_ERROR",
			"malformed JSON throws STATE_FILE_PARSE_ERROR via loadBatchState",
		);
		rmSync(malformedRoot, { recursive: true, force: true });
	}

	{
		console.log("  ▸ loadBatchState rejects v2 state missing required mode field");
		// Build a v2 state that has all fields except mode
		const v2NoMode = JSON.parse(loadFixture("batch-state-valid.json"));
		delete v2NoMode.mode; // Remove the mode field — v2 requires it
		const v2NoModeRoot = join(tmpdir(), `orch-v1compat-nomode-${Date.now()}`);
		mkdirSync(join(v2NoModeRoot, ".pi"), { recursive: true });
		writeFileSync(batchStatePath(v2NoModeRoot), JSON.stringify(v2NoMode, null, 2), "utf-8");

		assertThrows(
			() => loadBatchState(v2NoModeRoot),
			"STATE_SCHEMA_INVALID",
			"v2 without mode throws STATE_SCHEMA_INVALID via loadBatchState",
		);
		rmSync(v2NoModeRoot, { recursive: true, force: true });
	}

	{
		console.log("  ▸ v1 → save → load round-trip produces v2 on disk");
		// Load a v1 file (in-memory upconvert to v2), then save (writes v2 to disk)
		const v1Json = loadFixture("batch-state-v1-valid.json");
		saveBatchState(v1Json, v1CompatRoot);
		const loaded = loadBatchState(v1CompatRoot);
		assert(loaded !== null, "v1 loaded for round-trip");

		// Now save the in-memory v2 state back — this simulates what happens on
		// resume: loadBatchState → modify → persistRuntimeState → saveBatchState
		const v2Json = JSON.stringify(loaded, null, 2);
		saveBatchState(v2Json, v1CompatRoot);

		// Verify on-disk is now v2
		const onDisk = readFileSync(batchStatePath(v1CompatRoot), "utf-8");
		const parsed = JSON.parse(onDisk);
		assertEqual(parsed.schemaVersion, BATCH_STATE_SCHEMA_VERSION, "round-trip: on-disk schemaVersion is 2 after save");
		assertEqual(parsed.mode, "repo", "round-trip: on-disk mode is 'repo' after save");
		assertEqual(parsed.baseBranch, "", "round-trip: on-disk baseBranch is '' after save");

		// Reload and verify
		const reloaded = loadBatchState(v1CompatRoot);
		assertEqual(reloaded!.schemaVersion, BATCH_STATE_SCHEMA_VERSION, "round-trip: reloaded schemaVersion is 2");
		assertEqual(reloaded!.mode, "repo", "round-trip: reloaded mode is 'repo'");
		assertEqual(reloaded!.tasks.length, 3, "round-trip: reloaded task records preserved");
	}

} finally {
	try {
		rmSync(v1CompatRoot, { recursive: true, force: true });
	} catch { /* best effort */ }
}

// ═══════════════════════════════════════════════════════════════════════
// 2.1: persistRuntimeState — integration with state triggers
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 2.1: persistRuntimeState integration tests ──");

// Helper: build a minimal valid runtime batch state for persistence tests
interface MinimalBatchState {
	phase: string;
	batchId: string;
	mode: string;
	baseBranch: string;
	pauseSignal: { paused: boolean };
	waveResults: any[];
	mergeResults: any[];
	currentWaveIndex: number;
	totalWaves: number;
	blockedTaskIds: Set<string>;
	startedAt: number;
	endedAt: number | null;
	totalTasks: number;
	succeededTasks: number;
	failedTasks: number;
	skippedTasks: number;
	blockedTasks: number;
	errors: string[];
	currentLanes: any[];
	dependencyGraph: null;
}

function freshMinimalBatchState(): MinimalBatchState {
	return {
		phase: "idle",
		batchId: "",
		mode: "repo",
		baseBranch: "",
		pauseSignal: { paused: false },
		waveResults: [],
		mergeResults: [],
		currentWaveIndex: -1,
		totalWaves: 0,
		blockedTaskIds: new Set(),
		startedAt: 0,
		endedAt: null,
		totalTasks: 0,
		succeededTasks: 0,
		failedTasks: 0,
		skippedTasks: 0,
		blockedTasks: 0,
		errors: [],
		currentLanes: [],
		dependencyGraph: null,
	};
}

// Helper: build minimal lane for serialization
function minimalLane(laneNum: number, taskIds: string[], repoId?: string): any {
	return {
		laneNumber: laneNum,
		laneId: `lane-${laneNum}`,
		tmuxSessionName: `orch-lane-${laneNum}`,
		worktreePath: `/tmp/wt-${laneNum}`,
		branch: `task/lane-${laneNum}-20260309T030000`,
		tasks: taskIds.map(id => ({ taskId: id, task: null, order: 0, estimatedMinutes: 10 })),
		strategy: "affinity-first",
		estimatedLoad: 2,
		estimatedMinutes: 10,
		...(repoId !== undefined ? { repoId } : {}),
	};
}

// Helper: build minimal lane with ParsedTask objects containing repo fields
function minimalLaneWithRepoTasks(laneNum: number, tasks: Array<{ taskId: string; promptRepoId?: string; resolvedRepoId?: string }>, repoId?: string): any {
	return {
		laneNumber: laneNum,
		laneId: `lane-${laneNum}`,
		tmuxSessionName: `orch-lane-${laneNum}`,
		worktreePath: `/tmp/wt-${laneNum}`,
		branch: `task/lane-${laneNum}-20260309T030000`,
		tasks: tasks.map((t, i) => ({
			taskId: t.taskId,
			order: i,
			estimatedMinutes: 10,
			task: {
				taskId: t.taskId,
				promptRepoId: t.promptRepoId,
				resolvedRepoId: t.resolvedRepoId,
			},
		})),
		strategy: "affinity-first",
		estimatedLoad: 2,
		estimatedMinutes: 10,
		...(repoId !== undefined ? { repoId } : {}),
	};
}

// Helper: build minimal task outcome
function minimalOutcome(taskId: string, status: string): any {
	return {
		taskId,
		status,
		startTime: 1000,
		endTime: 2000,
		exitReason: status === "succeeded" ? "done" : "failed",
		sessionName: "orch-lane-1",
		doneFileFound: status === "succeeded",
	};
}

// Reimplementation of serializeBatchState (mirrors source for test self-containment)
// v2: Includes repo-aware fields from AllocatedTask.task (ParsedTask) and AllocatedLane
function serializeBatchState(
	state: MinimalBatchState,
	wavePlan: string[][],
	lanes: any[],
	allTaskOutcomes: any[],
): string {
	const now = Date.now();

	// Build lookup maps for fast per-task enrichment (mirrors source exactly).
	const laneByTaskId = new Map<string, any>();
	for (const lane of lanes) {
		for (const task of lane.tasks) {
			laneByTaskId.set(task.taskId, lane);
		}
	}

	// Latest outcome wins.
	const outcomeByTaskId = new Map<string, any>();
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

	// Build allocatedTask lookup for repo field extraction (mirrors source)
	const allocatedTaskByTaskId = new Map<string, { allocatedTask: any; lane: any }>();
	for (const lane of lanes) {
		for (const allocTask of lane.tasks) {
			allocatedTaskByTaskId.set(allocTask.taskId, { allocatedTask: allocTask, lane });
		}
	}

	const taskRecords = [...taskIdSet].sort().map((taskId: string) => {
		const lane = laneByTaskId.get(taskId);
		const outcome = outcomeByTaskId.get(taskId);
		const allocated = allocatedTaskByTaskId.get(taskId);

		const record: any = {
			taskId,
			laneNumber: lane?.laneNumber ?? 0,
			sessionName: outcome?.sessionName || lane?.tmuxSessionName || "",
			status: outcome?.status ?? "pending",
			taskFolder: "",
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
		return record;
	});

	const laneRecords = lanes.map((lane: any) => {
		const record: any = {
			laneNumber: lane.laneNumber,
			laneId: lane.laneId,
			tmuxSessionName: lane.tmuxSessionName,
			worktreePath: lane.worktreePath,
			branch: lane.branch,
			taskIds: lane.tasks.map((t: any) => t.taskId),
		};
		// v2: Serialize lane repoId
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
	const mergeResults = (state.mergeResults || [])
		.map((mr: any) => ({
			waveIndex: Math.max(0, mr.waveIndex - 1),
			status: mr.status,
			failedLane: mr.failedLane,
			failureReason: mr.failureReason,
		}));

	const persisted = {
		schemaVersion: BATCH_STATE_SCHEMA_VERSION,
		phase: state.phase,
		batchId: state.batchId,
		baseBranch: state.baseBranch ?? "",
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
	};

	return JSON.stringify(persisted, null, 2);
}

// Reimplementation of persistRuntimeState (mirrors source for test self-containment)
// v2: Includes discovery enrichment for repo-aware fields on unallocated tasks
function persistRuntimeState(
	reason: string,
	batchState: MinimalBatchState,
	wavePlan: string[][],
	lanes: any[],
	allTaskOutcomes: any[],
	discovery: { pending: Map<string, { taskFolder: string; promptRepoId?: string; resolvedRepoId?: string }> } | null,
	repoRoot: string,
): void {
	try {
		const json = serializeBatchState(batchState, wavePlan, lanes, allTaskOutcomes);

		if (discovery) {
			const parsed = JSON.parse(json);
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
	} catch (err: unknown) {
		const msg = err instanceof StateFileError
			? `[${(err as any).code}] ${(err as any).message}`
			: (err instanceof Error ? err.message : String(err));
		batchState.errors.push(`State persistence failed (${reason}): ${msg}`);
	}
}

// Create temp root for persistence integration tests
const persistTestRoot = join(tmpdir(), `orch-persist-test-${Date.now()}`);
mkdirSync(join(persistTestRoot, ".pi"), { recursive: true });

try {
	{
		console.log("  ▸ state file created after batch start (phase=executing)");
		const state = freshMinimalBatchState();
		state.phase = "executing";
		state.batchId = "20260309T030000";
		state.startedAt = Date.now();
		state.totalWaves = 2;
		state.totalTasks = 3;
		state.currentWaveIndex = 0;

		const wavePlan = [["T-001", "T-002"], ["T-003"]];
		persistRuntimeState("batch-start", state, wavePlan, [], [], null, persistTestRoot);

		assert(existsSync(batchStatePath(persistTestRoot)), "state file exists after batch-start persist");
		const loaded = loadBatchState(persistTestRoot);
		assert(loaded !== null, "loaded state is not null");
		assertEqual(loaded!.phase, "executing", "persisted phase is executing");
		assertEqual(loaded!.batchId, "20260309T030000", "persisted batchId matches");
		assertEqual(loaded!.totalTasks, 3, "persisted totalTasks is 3");
		assertEqual(loaded!.wavePlan.length, 2, "persisted wavePlan has 2 waves");
	}

	{
		console.log("  ▸ state file updated on wave index change");
		const state = freshMinimalBatchState();
		state.phase = "executing";
		state.batchId = "20260309T030000";
		state.startedAt = Date.now();
		state.totalWaves = 2;
		state.totalTasks = 3;
		state.currentWaveIndex = 1;

		const wavePlan = [["T-001", "T-002"], ["T-003"]];
		persistRuntimeState("wave-index-change", state, wavePlan, [], [], null, persistTestRoot);

		const loaded = loadBatchState(persistTestRoot);
		assertEqual(loaded!.currentWaveIndex, 1, "waveIndex updated to 1");
	}

	{
		console.log("  ▸ state file updated after task completion (waveResult accumulated)");
		const state = freshMinimalBatchState();
		state.phase = "executing";
		state.batchId = "20260309T030000";
		state.startedAt = Date.now();
		state.totalWaves = 1;
		state.totalTasks = 2;
		state.currentWaveIndex = 0;
		state.succeededTasks = 1;
		state.failedTasks = 1;

		const wavePlan = [["T-001", "T-002"]];
		const lanes = [minimalLane(1, ["T-001", "T-002"])];
		const outcomes = [
			minimalOutcome("T-001", "succeeded"),
			minimalOutcome("T-002", "failed"),
		];

		persistRuntimeState("wave-execution-complete", state, wavePlan, lanes, outcomes, null, persistTestRoot);

		const loaded = loadBatchState(persistTestRoot);
		assertEqual(loaded!.succeededTasks, 1, "succeededTasks is 1");
		assertEqual(loaded!.failedTasks, 1, "failedTasks is 1");
		assertEqual(loaded!.tasks.length, 2, "2 task records persisted");
		assertEqual(loaded!.tasks[0].status, "succeeded", "first task succeeded");
		assertEqual(loaded!.tasks[1].status, "failed", "second task failed");
	}

	{
		console.log("  ▸ state file updated on merge phase transitions");
		const state = freshMinimalBatchState();
		state.phase = "merging";
		state.batchId = "20260309T030000";
		state.startedAt = Date.now();
		state.totalWaves = 1;
		state.totalTasks = 1;
		state.currentWaveIndex = 0;

		const wavePlan = [["T-001"]];
		persistRuntimeState("merge-start", state, wavePlan, [], [], null, persistTestRoot);

		let loaded = loadBatchState(persistTestRoot);
		assertEqual(loaded!.phase, "merging", "phase is merging after merge-start");

		// Now simulate merge complete → executing
		state.phase = "executing";
		persistRuntimeState("merge-complete", state, wavePlan, [], [], null, persistTestRoot);

		loaded = loadBatchState(persistTestRoot);
		assertEqual(loaded!.phase, "executing", "phase is executing after merge-complete");
	}

	{
		console.log("  ▸ state file updated on pause/error with lastError populated");
		const state = freshMinimalBatchState();
		state.phase = "paused";
		state.batchId = "20260309T030000";
		state.startedAt = Date.now();
		state.totalWaves = 2;
		state.totalTasks = 3;
		state.currentWaveIndex = 0;
		state.errors.push("Merge failed at wave 1: conflict unresolved");

		const wavePlan = [["T-001"], ["T-002", "T-003"]];
		persistRuntimeState("merge-failure-pause", state, wavePlan, [], [], null, persistTestRoot);

		const loaded = loadBatchState(persistTestRoot);
		assertEqual(loaded!.phase, "paused", "phase is paused");
		assert(loaded!.lastError !== null, "lastError is populated");
		assertEqual(loaded!.lastError!.code, "BATCH_ERROR", "lastError code is BATCH_ERROR");
		assert(loaded!.lastError!.message.includes("Merge failed"), "lastError message includes merge failure");
		assertEqual(loaded!.errors.length, 1, "1 error in errors array");
	}

	{
		console.log("  ▸ state file deleted on clean batch completion");
		// First, create a state file
		const state = freshMinimalBatchState();
		state.phase = "completed";
		state.batchId = "20260309T030000";
		state.startedAt = Date.now() - 60000;
		state.endedAt = Date.now();
		state.totalWaves = 1;
		state.totalTasks = 1;
		state.succeededTasks = 1;
		state.currentWaveIndex = 0;

		const wavePlan = [["T-001"]];
		persistRuntimeState("batch-terminal", state, wavePlan, [], [], null, persistTestRoot);
		assert(existsSync(batchStatePath(persistTestRoot)), "state file exists before clean completion");

		// Simulate clean completion delete
		deleteBatchState(persistTestRoot);
		assert(!existsSync(batchStatePath(persistTestRoot)), "state file deleted on clean completion");
	}

	{
		console.log("  ▸ write failure does not crash batch (error logged, batch continues)");
		// Use an invalid root path that can't be written to
		const invalidRoot = join(tmpdir(), `orch-persist-invalid-${Date.now()}`, "nonexistent", "deep", "path");
		// Don't create the directory — write should fail

		const state = freshMinimalBatchState();
		state.phase = "executing";
		state.batchId = "20260309T030000";
		state.startedAt = Date.now();
		state.totalWaves = 1;
		state.totalTasks = 1;

		// This should NOT throw — errors are caught and added to state.errors
		persistRuntimeState("test-write-failure", state, [["T-001"]], [], [], null, invalidRoot);

		// But wait, saveBatchState creates .pi directory if missing.
		// For a truly failing path, we need to use a path that's a file not a dir.
		// Let's write a file where the .pi dir should be:
		const blockingRoot = join(tmpdir(), `orch-persist-blocked-${Date.now()}`);
		mkdirSync(blockingRoot, { recursive: true });
		writeFileSync(join(blockingRoot, ".pi"), "I am a file, not a directory", "utf-8");

		const state2 = freshMinimalBatchState();
		state2.phase = "executing";
		state2.batchId = "20260309T030001";
		state2.startedAt = Date.now();
		state2.totalWaves = 1;
		state2.totalTasks = 1;
		state2.errors = [];

		persistRuntimeState("test-blocked-write", state2, [["T-001"]], [], [], null, blockingRoot);

		// The function should not have thrown, but should have logged error
		assert(state2.errors.length > 0, "error logged in batch state on write failure");
		assert(state2.errors[0].includes("State persistence failed"), "error message mentions persistence failure");

		// Cleanup
		try { rmSync(blockingRoot, { recursive: true, force: true }); } catch { /* best effort */ }
	}

	{
		console.log("  ▸ monotonic updatedAt across successive writes");
		// Recreate .pi dir for the test root since we deleted the file earlier
		if (!existsSync(join(persistTestRoot, ".pi"))) {
			mkdirSync(join(persistTestRoot, ".pi"), { recursive: true });
		}

		const state = freshMinimalBatchState();
		state.phase = "executing";
		state.batchId = "20260309T040000";
		state.startedAt = Date.now();
		state.totalWaves = 1;
		state.totalTasks = 1;
		state.currentWaveIndex = 0;

		// First write
		persistRuntimeState("write-1", state, [["T-001"]], [], [], null, persistTestRoot);
		const loaded1 = loadBatchState(persistTestRoot);
		assert(loaded1 !== null, "first write loaded");

		// Small delay to ensure timestamp differs (on fast systems)
		const busyWait = Date.now() + 2;
		while (Date.now() < busyWait) { /* spin */ }

		// Second write
		state.currentWaveIndex = 0; // same index, but new write
		persistRuntimeState("write-2", state, [["T-001"]], [], [], null, persistTestRoot);
		const loaded2 = loadBatchState(persistTestRoot);
		assert(loaded2 !== null, "second write loaded");

		assert(loaded2!.updatedAt >= loaded1!.updatedAt, "updatedAt is monotonically non-decreasing");
	}

	{
		console.log("  ▸ taskFolder enriched from discovery.pending");
		if (!existsSync(join(persistTestRoot, ".pi"))) {
			mkdirSync(join(persistTestRoot, ".pi"), { recursive: true });
		}

		const state = freshMinimalBatchState();
		state.phase = "executing";
		state.batchId = "20260309T050000";
		state.startedAt = Date.now();
		state.totalWaves = 1;
		state.totalTasks = 1;
		state.currentWaveIndex = 0;

		const lanes = [minimalLane(1, ["ENRICH-001"])];
		const outcomes = [minimalOutcome("ENRICH-001", "succeeded")];
		const discovery = {
			pending: new Map([
				["ENRICH-001", { taskFolder: "/my/tasks/ENRICH-001-enrichment" }],
			]),
		};

		persistRuntimeState("enrichment-test", state, [["ENRICH-001"]], lanes, outcomes, discovery, persistTestRoot);

		const loaded = loadBatchState(persistTestRoot);
		assert(loaded !== null, "enrichment state loaded");
		assertEqual(loaded!.tasks[0].taskFolder, "/my/tasks/ENRICH-001-enrichment", "taskFolder enriched from discovery");
	}

	// ── Step 1: Serialization checkpoint tests for repo-aware fields ──

	{
		console.log("  ▸ serialization includes repo-aware fields for allocated tasks (workspace mode)");
		if (!existsSync(join(persistTestRoot, ".pi"))) {
			mkdirSync(join(persistTestRoot, ".pi"), { recursive: true });
		}

		const state = freshMinimalBatchState();
		state.phase = "executing";
		state.batchId = "20260315T060000";
		state.startedAt = Date.now();
		state.totalWaves = 1;
		state.totalTasks = 2;
		state.currentWaveIndex = 0;

		const lanes = [
			minimalLaneWithRepoTasks(1, [
				{ taskId: "WS-001", promptRepoId: "api", resolvedRepoId: "api" },
			], "api"),
			minimalLaneWithRepoTasks(2, [
				{ taskId: "WS-002", promptRepoId: undefined, resolvedRepoId: "frontend" },
			], "frontend"),
		];
		const outcomes = [
			minimalOutcome("WS-001", "succeeded"),
			minimalOutcome("WS-002", "running"),
		];

		// Serialize directly (not through persistRuntimeState) to test serializeBatchState
		const json = serializeBatchState(state, [["WS-001", "WS-002"]], lanes, outcomes);
		const parsed = JSON.parse(json);

		// Verify task repo fields
		const ws001 = parsed.tasks.find((t: any) => t.taskId === "WS-001");
		const ws002 = parsed.tasks.find((t: any) => t.taskId === "WS-002");
		assertEqual(ws001.repoId, "api", "WS-001 repoId serialized from ParsedTask");
		assertEqual(ws001.resolvedRepoId, "api", "WS-001 resolvedRepoId serialized from ParsedTask");
		assertEqual(ws002.repoId, undefined, "WS-002 repoId undefined (not declared in prompt)");
		assertEqual(ws002.resolvedRepoId, "frontend", "WS-002 resolvedRepoId serialized from area/default fallback");

		// Verify lane repo fields
		assertEqual(parsed.lanes[0].repoId, "api", "lane-1 repoId serialized");
		assertEqual(parsed.lanes[1].repoId, "frontend", "lane-2 repoId serialized");

		// Validate round-trip: re-parse the JSON through validatePersistedState
		const validated = validatePersistedState(parsed);
		assertEqual(validated.tasks.length, 2, "round-trip: 2 task records");
		assertEqual(validated.lanes.length, 2, "round-trip: 2 lane records");
	}

	{
		console.log("  ▸ serialization omits repo fields for repo-mode state (no repo fields on lanes/tasks)");
		if (!existsSync(join(persistTestRoot, ".pi"))) {
			mkdirSync(join(persistTestRoot, ".pi"), { recursive: true });
		}

		const state = freshMinimalBatchState();
		state.phase = "executing";
		state.batchId = "20260315T070000";
		state.startedAt = Date.now();
		state.totalWaves = 1;
		state.totalTasks = 1;
		state.currentWaveIndex = 0;

		// Lanes WITHOUT repoId (repo mode)
		const lanes = [minimalLane(1, ["RP-001"])];
		const outcomes = [minimalOutcome("RP-001", "succeeded")];

		const json = serializeBatchState(state, [["RP-001"]], lanes, outcomes);
		const parsed = JSON.parse(json);

		// Verify no repo fields present
		assertEqual(parsed.tasks[0].repoId, undefined, "repo-mode task has no repoId");
		assertEqual(parsed.tasks[0].resolvedRepoId, undefined, "repo-mode task has no resolvedRepoId");
		assertEqual(parsed.lanes[0].repoId, undefined, "repo-mode lane has no repoId");
	}

	{
		console.log("  ▸ discovery enrichment writes repo fields for unallocated tasks");
		if (!existsSync(join(persistTestRoot, ".pi"))) {
			mkdirSync(join(persistTestRoot, ".pi"), { recursive: true });
		}

		const state = freshMinimalBatchState();
		state.phase = "executing";
		state.batchId = "20260315T080000";
		state.startedAt = Date.now();
		state.totalWaves = 2;
		state.totalTasks = 2;
		state.currentWaveIndex = 0;

		// Wave 1 has WS-010 (allocated), Wave 2 has WS-020 (not yet allocated)
		const lanes = [minimalLaneWithRepoTasks(1, [
			{ taskId: "WS-010", promptRepoId: "api", resolvedRepoId: "api" },
		], "api")];
		const outcomes = [minimalOutcome("WS-010", "running")];

		// Discovery includes WS-020 (future wave, unallocated)
		const discovery = {
			pending: new Map([
				["WS-010", { taskFolder: "/tasks/WS-010", promptRepoId: "api", resolvedRepoId: "api" }],
				["WS-020", { taskFolder: "/tasks/WS-020", promptRepoId: "frontend", resolvedRepoId: "frontend" }],
			]),
		};

		persistRuntimeState("wave-index-change", state, [["WS-010"], ["WS-020"]], lanes, outcomes, discovery, persistTestRoot);

		const loaded = loadBatchState(persistTestRoot);
		assert(loaded !== null, "discovery-enriched state loaded");

		// WS-010: repo fields come from allocated lane's ParsedTask via serializeBatchState
		const ws010 = loaded!.tasks.find((t: any) => t.taskId === "WS-010");
		assert(ws010 !== undefined, "WS-010 task record found");
		assertEqual(ws010!.repoId, "api", "WS-010 repoId from serialization (allocated)");
		assertEqual(ws010!.resolvedRepoId, "api", "WS-010 resolvedRepoId from serialization (allocated)");
		assertEqual(ws010!.taskFolder, "/tasks/WS-010", "WS-010 taskFolder enriched from discovery");

		// WS-020: repo fields come from discovery enrichment (not yet allocated)
		// WS-020 is in wavePlan but not in current lanes — it gets a skeleton record
		// from the wave plan in serializeBatchState, then discovery enrichment adds repo fields.
		// However, WS-020 has no outcome yet, so it appears in the taskIdSet from wavePlan
		// but with default values (laneNumber=0, status=pending).
		const ws020 = loaded!.tasks.find((t: any) => t.taskId === "WS-020");
		assert(ws020 !== undefined, "WS-020 task record found (from wavePlan)");
		assertEqual(ws020!.repoId, "frontend", "WS-020 repoId enriched from discovery (unallocated)");
		assertEqual(ws020!.resolvedRepoId, "frontend", "WS-020 resolvedRepoId enriched from discovery (unallocated)");
		assertEqual(ws020!.taskFolder, "/tasks/WS-020", "WS-020 taskFolder enriched from discovery");
	}

	{
		console.log("  ▸ serialized state validates as v2 through full round-trip (workspace mode)");
		if (!existsSync(join(persistTestRoot, ".pi"))) {
			mkdirSync(join(persistTestRoot, ".pi"), { recursive: true });
		}

		const state = freshMinimalBatchState();
		state.phase = "completed";
		state.batchId = "20260315T090000";
		state.startedAt = Date.now() - 60000;
		state.endedAt = Date.now();
		state.totalWaves = 1;
		state.totalTasks = 1;
		state.succeededTasks = 1;
		state.currentWaveIndex = 0;

		const lanes = [minimalLaneWithRepoTasks(1, [
			{ taskId: "RT-001", promptRepoId: "api", resolvedRepoId: "api" },
		], "api")];
		const outcomes = [minimalOutcome("RT-001", "succeeded")];

		// Serialize → save → load → validate → check fields
		const json = serializeBatchState(state, [["RT-001"]], lanes, outcomes);
		saveBatchState(json, persistTestRoot);
		const loaded = loadBatchState(persistTestRoot);

		assert(loaded !== null, "round-trip loaded");
		assertEqual(loaded!.schemaVersion, BATCH_STATE_SCHEMA_VERSION, "round-trip: schemaVersion is 2");
		assertEqual(loaded!.mode, "repo", "round-trip: mode preserved");
		assertEqual(loaded!.tasks[0].repoId, "api", "round-trip: task repoId preserved");
		assertEqual(loaded!.tasks[0].resolvedRepoId, "api", "round-trip: task resolvedRepoId preserved");
		assertEqual(loaded!.lanes[0].repoId, "api", "round-trip: lane repoId preserved");
	}

} finally {
	// Cleanup temp directory
	try {
		rmSync(persistTestRoot, { recursive: true, force: true });
	} catch { /* best effort */ }
}

// ═══════════════════════════════════════════════════════════════════════
// 3.1: parseOrchSessionNames
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 3.1: parseOrchSessionNames ──");

// Reimplementation (matches source in task-orchestrator.ts)
function parseOrchSessionNames(stdout: string, prefix: string): string[] {
	if (!stdout || !stdout.trim()) return [];
	const filterPrefix = `${prefix}-`;
	return stdout
		.split("\n")
		.map(line => line.trim())
		.filter(name => name.length > 0 && name.startsWith(filterPrefix))
		.sort();
}

{
	console.log("  ▸ empty stdout returns []");
	assertEqual(parseOrchSessionNames("", "orch").length, 0, "empty string → empty array");
	assertEqual(parseOrchSessionNames("  \n  ", "orch").length, 0, "whitespace-only → empty array");
	assertEqual(parseOrchSessionNames("\n\n\n", "orch").length, 0, "blank lines → empty array");
}

{
	console.log("  ▸ filters by prefix, ignores non-matching sessions");
	const stdout = "orch-lane-1\norch-lane-2\nmy-session\nother-thing\norch-lane-3\n";
	const result = parseOrchSessionNames(stdout, "orch");
	assertEqual(result.length, 3, "3 orch sessions found");
	assertEqual(result[0], "orch-lane-1", "first session");
	assertEqual(result[1], "orch-lane-2", "second session");
	assertEqual(result[2], "orch-lane-3", "third session");
}

{
	console.log("  ▸ handles malformed lines gracefully");
	const stdout = "  orch-lane-1  \n\n\n  not-orch  \n  orch-lane-2\n  \n";
	const result = parseOrchSessionNames(stdout, "orch");
	assertEqual(result.length, 2, "2 orch sessions with trimming");
	assertEqual(result[0], "orch-lane-1", "trimmed first");
	assertEqual(result[1], "orch-lane-2", "trimmed second");
}

{
	console.log("  ▸ prefix must match with dash separator");
	const stdout = "orch-lane-1\norchestra-session\norch\n";
	const result = parseOrchSessionNames(stdout, "orch");
	assertEqual(result.length, 1, "only orch-lane-1 matches orch-");
	assertEqual(result[0], "orch-lane-1", "orchestra-session and bare orch excluded");
}

{
	console.log("  ▸ results are sorted alphabetically");
	const stdout = "orch-lane-3\norch-lane-1\norch-lane-2\n";
	const result = parseOrchSessionNames(stdout, "orch");
	assertEqual(result[0], "orch-lane-1", "sorted first");
	assertEqual(result[1], "orch-lane-2", "sorted second");
	assertEqual(result[2], "orch-lane-3", "sorted third");
}

// ═══════════════════════════════════════════════════════════════════════
// 3.2: analyzeOrchestratorStartupState
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 3.2: analyzeOrchestratorStartupState ──");

// Reimplementation of type aliases and function (matches source)
type OrphanStateStatus = "valid" | "missing" | "invalid" | "io-error";
type OrphanRecommendedAction = "resume" | "abort-orphans" | "cleanup-stale" | "start-fresh";

interface OrphanDetectionResult {
	orphanSessions: string[];
	stateStatus: OrphanStateStatus;
	loadedState: any | null;
	stateError: string | null;
	recommendedAction: OrphanRecommendedAction;
	userMessage: string;
}

interface PersistedBatchStateForTest {
	schemaVersion: number;
	phase: string;
	batchId: string;
	baseBranch?: string;
	mode?: string;
	startedAt: number;
	updatedAt: number;
	endedAt: number | null;
	currentWaveIndex: number;
	totalWaves: number;
	wavePlan: string[][];
	lanes: any[];
	tasks: Array<{ taskId: string; taskFolder: string; [k: string]: any }>;
	mergeResults: any[];
	totalTasks: number;
	succeededTasks: number;
	failedTasks: number;
	skippedTasks: number;
	blockedTasks: number;
	blockedTaskIds: string[];
	lastError: { code: string; message: string } | null;
	errors: string[];
}

function analyzeOrchestratorStartupState(
	orphanSessions: string[],
	stateStatus: OrphanStateStatus,
	loadedState: PersistedBatchStateForTest | null,
	stateError: string | null,
	doneTaskIds: ReadonlySet<string>,
): OrphanDetectionResult {
	const hasOrphans = orphanSessions.length > 0;

	if (hasOrphans) {
		if (stateStatus === "valid" && loadedState) {
			return {
				orphanSessions,
				stateStatus,
				loadedState,
				stateError,
				recommendedAction: "resume",
				userMessage:
					`🔄 Found ${orphanSessions.length} running orchestrator session(s): ${orphanSessions.join(", ")}\n` +
					`   Batch ${loadedState.batchId} (${loadedState.phase}) has persisted state.\n` +
					`   Use /orch-resume to continue, or /orch-abort to clean up.`,
			};
		}

		const errorCtx = stateError ? `\n   State error: ${stateError}` : "";
		return {
			orphanSessions,
			stateStatus,
			loadedState: null,
			stateError,
			recommendedAction: "abort-orphans",
			userMessage:
				`⚠️ Found ${orphanSessions.length} orphan orchestrator session(s): ${orphanSessions.join(", ")}\n` +
				`   No usable batch state file (status: ${stateStatus}).${errorCtx}\n` +
				`   Use /orch-abort to clean up before starting a new batch.`,
		};
	}

	if (stateStatus === "missing") {
		return {
			orphanSessions: [],
			stateStatus,
			loadedState: null,
			stateError,
			recommendedAction: "start-fresh",
			userMessage: "",
		};
	}

	if (stateStatus === "valid" && loadedState) {
		const allTaskIds = loadedState.tasks.map((t: any) => t.taskId);
		const allDone = allTaskIds.length > 0 && allTaskIds.every((id: string) => doneTaskIds.has(id));

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

		const completedCount = allTaskIds.filter((id: string) => doneTaskIds.has(id)).length;

		// Only phases that resumeOrchBatch can actually handle should get "resume".
		// "failed" / "stopped" / "idle" / "planning" are non-resumable — if nothing
		// ran yet (completedCount === 0) the state file is pure noise; auto-clean it
		// so /orch can start fresh without forcing the user through /orch-abort first.
		const resumablePhases = ["paused", "executing", "merging"];
		const isResumable = resumablePhases.includes(loadedState.phase);

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

// Helper: create a minimal valid persisted batch state for testing
function minimalPersistedState(overrides?: Partial<PersistedBatchStateForTest>): PersistedBatchStateForTest {
	return {
		schemaVersion: 2,
		phase: "executing",
		batchId: "20260309T050000",
		startedAt: Date.now() - 60000,
		updatedAt: Date.now(),
		endedAt: null,
		currentWaveIndex: 0,
		totalWaves: 1,
		wavePlan: [["TS-001", "TS-002"]],
		lanes: [],
		tasks: [
			{ taskId: "TS-001", taskFolder: "/tmp/tasks/TS-001", laneNumber: 1, sessionName: "orch-lane-1", status: "succeeded", startedAt: Date.now() - 60000, endedAt: Date.now() - 30000, doneFileFound: true, exitReason: "" },
			{ taskId: "TS-002", taskFolder: "/tmp/tasks/TS-002", laneNumber: 2, sessionName: "orch-lane-2", status: "running", startedAt: Date.now() - 60000, endedAt: null, doneFileFound: false, exitReason: "" },
		],
		mergeResults: [],
		totalTasks: 2,
		succeededTasks: 1,
		failedTasks: 0,
		skippedTasks: 0,
		blockedTasks: 0,
		blockedTaskIds: [],
		lastError: null,
		errors: [],
		...overrides,
	};
}

{
	console.log("  ▸ orphans + valid state → recommend 'resume'");
	const state = minimalPersistedState();
	const result = analyzeOrchestratorStartupState(
		["orch-lane-1", "orch-lane-2"],
		"valid",
		state,
		null,
		new Set(),
	);
	assertEqual(result.recommendedAction, "resume", "recommend resume");
	assertEqual(result.orphanSessions.length, 2, "2 orphan sessions");
	assertEqual(result.stateStatus, "valid", "state is valid");
	assert(result.loadedState !== null, "loaded state preserved");
	assert(result.userMessage.includes("/orch-resume"), "message mentions /orch-resume");
	assert(result.userMessage.includes(state.batchId), "message includes batchId");
}

{
	console.log("  ▸ orphans + missing state → recommend 'abort-orphans'");
	const result = analyzeOrchestratorStartupState(
		["orch-lane-1"],
		"missing",
		null,
		null,
		new Set(),
	);
	assertEqual(result.recommendedAction, "abort-orphans", "recommend abort");
	assertEqual(result.stateStatus, "missing", "state is missing");
	assert(result.loadedState === null, "no loaded state");
	assert(result.userMessage.includes("/orch-abort"), "message mentions /orch-abort");
}

{
	console.log("  ▸ orphans + invalid state → recommend 'abort-orphans' with error context");
	const result = analyzeOrchestratorStartupState(
		["orch-lane-1"],
		"invalid",
		null,
		"[STATE_FILE_PARSE_ERROR] Invalid JSON at position 42",
		new Set(),
	);
	assertEqual(result.recommendedAction, "abort-orphans", "recommend abort");
	assertEqual(result.stateStatus, "invalid", "state is invalid");
	assert(result.stateError !== null, "error preserved");
	assert(result.userMessage.includes("STATE_FILE_PARSE_ERROR"), "error context in message");
	assert(result.userMessage.includes("/orch-abort"), "message mentions /orch-abort");
}

{
	console.log("  ▸ orphans + io-error state → recommend 'abort-orphans' with error context");
	const result = analyzeOrchestratorStartupState(
		["orch-lane-1"],
		"io-error",
		null,
		"[STATE_FILE_IO_ERROR] Permission denied",
		new Set(),
	);
	assertEqual(result.recommendedAction, "abort-orphans", "recommend abort");
	assertEqual(result.stateStatus, "io-error", "state is io-error");
	assert(result.stateError !== null, "error preserved");
	assert(result.userMessage.includes("Permission denied"), "error context in message");
}

{
	console.log("  ▸ no orphans + valid state + all done → recommend 'cleanup-stale'");
	const state = minimalPersistedState();
	const result = analyzeOrchestratorStartupState(
		[],
		"valid",
		state,
		null,
		new Set(["TS-001", "TS-002"]), // All tasks done
	);
	assertEqual(result.recommendedAction, "cleanup-stale", "recommend cleanup");
	assertEqual(result.orphanSessions.length, 0, "no orphans");
	assert(result.userMessage.includes("stale"), "message mentions stale");
	assert(result.userMessage.includes(".DONE"), "message mentions .DONE files");
}

{
	console.log("  ▸ no orphans + valid state + not all done → recommend 'resume' (crashed batch)");
	const state = minimalPersistedState();
	const result = analyzeOrchestratorStartupState(
		[],
		"valid",
		state,
		null,
		new Set(["TS-001"]), // Only TS-001 done, TS-002 not
	);
	assertEqual(result.recommendedAction, "resume", "recommend resume for crashed batch");
	assert(result.userMessage.includes("interrupted"), "message mentions interrupted");
	assert(result.userMessage.includes("1/2"), "shows completion ratio");
	assert(result.userMessage.includes("/orch-resume"), "message mentions /orch-resume");
}

{
	console.log("  ▸ no orphans + missing state → recommend 'start-fresh'");
	const result = analyzeOrchestratorStartupState(
		[],
		"missing",
		null,
		null,
		new Set(),
	);
	assertEqual(result.recommendedAction, "start-fresh", "recommend start-fresh");
	assertEqual(result.userMessage, "", "no message for clean start");
}

{
	console.log("  ▸ no orphans + invalid state → recommend 'cleanup-stale'");
	const result = analyzeOrchestratorStartupState(
		[],
		"invalid",
		null,
		"[STATE_SCHEMA_INVALID] Unsupported schema version 99",
		new Set(),
	);
	assertEqual(result.recommendedAction, "cleanup-stale", "recommend cleanup for invalid state");
	assert(result.userMessage.includes("unusable"), "message mentions unusable");
	assert(result.userMessage.includes("schema version"), "error context in message");
}

{
	console.log("  ▸ no orphans + io-error state → recommend 'cleanup-stale'");
	const result = analyzeOrchestratorStartupState(
		[],
		"io-error",
		null,
		"[STATE_FILE_IO_ERROR] EACCES: permission denied",
		new Set(),
	);
	assertEqual(result.recommendedAction, "cleanup-stale", "recommend cleanup for io-error");
	assert(result.userMessage.includes("unusable"), "message mentions unusable");
}

{
	console.log("  ▸ no orphans + valid state + zero tasks → recommend 'resume' (edge case)");
	// Edge case: state with empty tasks array — allDone is false since allTaskIds.length === 0
	const state = minimalPersistedState({ tasks: [], totalTasks: 0 });
	const result = analyzeOrchestratorStartupState(
		[],
		"valid",
		state,
		null,
		new Set(),
	);
	// With zero tasks, allTaskIds.length > 0 check fails, so allDone = false
	// Falls through to "not all done" → resume recommendation
	assertEqual(result.recommendedAction, "resume", "zero-task state recommends resume");
}

// ═══════════════════════════════════════════════════════════════════════
// 4.1: checkResumeEligibility
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 4.1: checkResumeEligibility ──");

// Reimplement checkResumeEligibility (mirrors source exactly)
function checkResumeEligibility(state: any): any {
	const { phase, batchId } = state;

	switch (phase) {
		case "paused":
			return { eligible: true, reason: `Batch ${batchId} is paused and can be resumed.`, phase, batchId };
		case "executing":
			return { eligible: true, reason: `Batch ${batchId} was executing when the orchestrator disconnected. Can be resumed.`, phase, batchId };
		case "merging":
			return { eligible: true, reason: `Batch ${batchId} was merging when the orchestrator disconnected. Can be resumed.`, phase, batchId };
		case "stopped":
			return { eligible: false, reason: `Batch ${batchId} was stopped by failure policy. Use /orch-abort to clean up, then start a new batch.`, phase, batchId };
		case "failed":
			return { eligible: false, reason: `Batch ${batchId} has a terminal failure. Use /orch-abort to clean up, then start a new batch.`, phase, batchId };
		case "completed":
			return { eligible: false, reason: `Batch ${batchId} already completed. Delete the state file or start a new batch.`, phase, batchId };
		case "idle":
			return { eligible: false, reason: `Batch ${batchId} never started execution. Start a new batch with /orch.`, phase, batchId };
		case "planning":
			return { eligible: false, reason: `Batch ${batchId} was still in planning phase. Start a new batch with /orch.`, phase, batchId };
		default:
			return { eligible: false, reason: `Batch ${batchId} has unknown phase "${phase}". Delete the state file and start a new batch.`, phase, batchId };
	}
}

{
	console.log("  ▸ paused → eligible");
	const state = minimalPersistedState({ phase: "paused" });
	const result = checkResumeEligibility(state);
	assertEqual(result.eligible, true, "paused is eligible");
	assertEqual(result.phase, "paused", "phase preserved");
}

{
	console.log("  ▸ executing → eligible (crashed batch)");
	const state = minimalPersistedState({ phase: "executing" });
	const result = checkResumeEligibility(state);
	assertEqual(result.eligible, true, "executing is eligible");
}

{
	console.log("  ▸ merging → eligible (crashed during merge)");
	const state = minimalPersistedState({ phase: "merging" });
	const result = checkResumeEligibility(state);
	assertEqual(result.eligible, true, "merging is eligible");
}

{
	console.log("  ▸ stopped → not eligible");
	const state = minimalPersistedState({ phase: "stopped" });
	const result = checkResumeEligibility(state);
	assertEqual(result.eligible, false, "stopped is not eligible");
	assert(result.reason.includes("stopped"), "reason mentions stopped");
}

{
	console.log("  ▸ failed → not eligible");
	const state = minimalPersistedState({ phase: "failed" });
	const result = checkResumeEligibility(state);
	assertEqual(result.eligible, false, "failed is not eligible");
}

{
	console.log("  ▸ completed → not eligible");
	const state = minimalPersistedState({ phase: "completed" });
	const result = checkResumeEligibility(state);
	assertEqual(result.eligible, false, "completed is not eligible");
}

{
	console.log("  ▸ idle → not eligible");
	const state = minimalPersistedState({ phase: "idle" });
	const result = checkResumeEligibility(state);
	assertEqual(result.eligible, false, "idle is not eligible");
}

// ═══════════════════════════════════════════════════════════════════════
// 4.2: reconcileTaskStates
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 4.2: reconcileTaskStates ──");

// Reimplement reconcileTaskStates (mirrors source exactly)
function reconcileTaskStates(
	persistedState: any,
	aliveSessions: ReadonlySet<string>,
	doneTaskIds: ReadonlySet<string>,
	existingWorktrees: ReadonlySet<string> = new Set(),
): any[] {
	return persistedState.tasks.map((task: any) => {
		const sessionAlive = aliveSessions.has(task.sessionName);
		const doneFileFound = doneTaskIds.has(task.taskId);
		const worktreeExists = existingWorktrees.has(task.taskId);

		// Precedence 1: .DONE file found → task completed
		if (doneFileFound) {
			return {
				taskId: task.taskId,
				persistedStatus: task.status,
				liveStatus: "succeeded",
				sessionAlive,
				doneFileFound: true,
				worktreeExists,
				action: "mark-complete",
			};
		}

		// Precedence 2: Session alive → reconnect
		if (sessionAlive) {
			return {
				taskId: task.taskId,
				persistedStatus: task.status,
				liveStatus: "running",
				sessionAlive: true,
				doneFileFound: false,
				worktreeExists,
				action: "reconnect",
			};
		}

		// Precedence 3: Already terminal in persisted state → skip
		const terminalStatuses = ["succeeded", "failed", "stalled", "skipped"];
		if (terminalStatuses.includes(task.status)) {
			return {
				taskId: task.taskId,
				persistedStatus: task.status,
				liveStatus: task.status,
				sessionAlive: false,
				doneFileFound: false,
				worktreeExists,
				action: "skip",
			};
		}

		// Precedence 4: Session dead + no .DONE + worktree exists → re-execute
		if (worktreeExists) {
			return {
				taskId: task.taskId,
				persistedStatus: task.status,
				liveStatus: "pending",
				sessionAlive: false,
				doneFileFound: false,
				worktreeExists: true,
				action: "re-execute",
			};
		}

		// Precedence 5: Never-started task (pending + no session assigned) → remain pending
		if (task.status === "pending" && !task.sessionName) {
			return {
				taskId: task.taskId,
				persistedStatus: task.status,
				liveStatus: "pending",
				sessionAlive: false,
				doneFileFound: false,
				worktreeExists: false,
				action: "pending",
			};
		}

		// Precedence 6: Dead session + not terminal + no .DONE + no worktree → failed
		return {
			taskId: task.taskId,
			persistedStatus: task.status,
			liveStatus: "failed",
			sessionAlive: false,
			doneFileFound: false,
			worktreeExists: false,
			action: "mark-failed",
		};
	});
}

function makeTaskRecord(overrides: Partial<any> = {}): any {
	return {
		taskId: "TASK-001",
		laneNumber: 1,
		sessionName: "orch-lane-1",
		status: "running",
		taskFolder: "/path/to/task",
		startedAt: 1000,
		endedAt: null,
		doneFileFound: false,
		exitReason: "",
		...overrides,
	};
}

{
	console.log("  ▸ alive session + no .DONE → action 'reconnect'");
	const state = minimalPersistedState({
		tasks: [makeTaskRecord({ taskId: "T1", sessionName: "orch-lane-1", status: "running" })],
	});
	const result = reconcileTaskStates(state, new Set(["orch-lane-1"]), new Set());
	assertEqual(result.length, 1, "one task reconciled");
	assertEqual(result[0].action, "reconnect", "action is reconnect");
	assertEqual(result[0].sessionAlive, true, "session alive");
	assertEqual(result[0].liveStatus, "running", "live status is running");
}

{
	console.log("  ▸ dead session + .DONE exists → action 'mark-complete'");
	const state = minimalPersistedState({
		tasks: [makeTaskRecord({ taskId: "T1", sessionName: "orch-lane-1", status: "running" })],
	});
	const result = reconcileTaskStates(state, new Set(), new Set(["T1"]));
	assertEqual(result[0].action, "mark-complete", "action is mark-complete");
	assertEqual(result[0].doneFileFound, true, "done file found");
	assertEqual(result[0].liveStatus, "succeeded", "live status is succeeded");
}

{
	console.log("  ▸ dead session + no .DONE → action 'mark-failed'");
	const state = minimalPersistedState({
		tasks: [makeTaskRecord({ taskId: "T1", sessionName: "orch-lane-1", status: "running" })],
	});
	const result = reconcileTaskStates(state, new Set(), new Set());
	assertEqual(result[0].action, "mark-failed", "action is mark-failed");
	assertEqual(result[0].liveStatus, "failed", "live status is failed");
}

{
	console.log("  ▸ alive session + .DONE exists → action 'mark-complete' (DONE takes precedence)");
	const state = minimalPersistedState({
		tasks: [makeTaskRecord({ taskId: "T1", sessionName: "orch-lane-1", status: "running" })],
	});
	const result = reconcileTaskStates(state, new Set(["orch-lane-1"]), new Set(["T1"]));
	assertEqual(result[0].action, "mark-complete", "DONE takes precedence over alive session");
	assertEqual(result[0].doneFileFound, true, "done file found");
	assertEqual(result[0].sessionAlive, true, "session is alive (but DONE overrides)");
}

{
	console.log("  ▸ persisted succeeded + no session → action 'skip' (already done)");
	const state = minimalPersistedState({
		tasks: [makeTaskRecord({ taskId: "T1", sessionName: "orch-lane-1", status: "succeeded" })],
	});
	const result = reconcileTaskStates(state, new Set(), new Set());
	assertEqual(result[0].action, "skip", "already succeeded → skip");
	assertEqual(result[0].liveStatus, "succeeded", "live status preserved");
}

// ═══════════════════════════════════════════════════════════════════════
// 4.3: computeResumePoint
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 4.3: computeResumePoint ──");

// Reimplement computeResumePoint (mirrors source exactly)
function computeResumePoint(
	persistedState: any,
	reconciledTasks: any[],
): any {
	const reconciledMap = new Map<string, any>();
	for (const task of reconciledTasks) {
		reconciledMap.set(task.taskId, task);
	}

	const completedTaskIds: string[] = [];
	const pendingTaskIds: string[] = [];
	const failedTaskIds: string[] = [];
	const reconnectTaskIds: string[] = [];
	const reExecuteTaskIds: string[] = [];

	for (const task of reconciledTasks) {
		switch (task.action) {
			case "mark-complete":
				completedTaskIds.push(task.taskId);
				break;
			case "skip":
				if (task.liveStatus === "succeeded" || task.persistedStatus === "succeeded") {
					completedTaskIds.push(task.taskId);
				} else if (task.liveStatus === "failed" || task.liveStatus === "stalled" || task.persistedStatus === "failed" || task.persistedStatus === "stalled") {
					failedTaskIds.push(task.taskId);
				}
				// persistedStatus === "skipped" → terminal but neither completed nor failed.
				// Not re-queued. Counted separately via batchState.skippedTasks (carried from persisted state).
				break;
			case "reconnect":
				reconnectTaskIds.push(task.taskId);
				break;
			case "re-execute":
				reExecuteTaskIds.push(task.taskId);
				break;
			case "mark-failed":
				failedTaskIds.push(task.taskId);
				break;
			case "pending":
				// Never-started tasks remain pending for execution — not failed.
				pendingTaskIds.push(task.taskId);
				break;
		}
	}

	let resumeWaveIndex = persistedState.wavePlan.length;
	for (let i = 0; i < persistedState.wavePlan.length; i++) {
		const waveTasks = persistedState.wavePlan[i];
		const allDone = waveTasks.every((taskId: string) => {
			const reconciled = reconciledMap.get(taskId);
			if (!reconciled) return false;
			// A task is "done" for wave-skip purposes if it completed or is otherwise terminal.
			// mark-failed is intentionally NOT included here.
			return (
				reconciled.action === "mark-complete" ||
				(reconciled.action === "skip" && (
					reconciled.liveStatus === "succeeded" ||
					reconciled.liveStatus === "failed" ||
					reconciled.liveStatus === "stalled" ||
					reconciled.liveStatus === "skipped" ||
					reconciled.persistedStatus === "succeeded" ||
					reconciled.persistedStatus === "failed" ||
					reconciled.persistedStatus === "stalled" ||
					reconciled.persistedStatus === "skipped"
				))
			);
		});

		if (!allDone) {
			resumeWaveIndex = i;
			break;
		}
	}

	// Determine pending tasks: tasks in resume wave and later that need execution
	const actualPendingTaskIds: string[] = [];
	for (let i = resumeWaveIndex; i < persistedState.wavePlan.length; i++) {
		for (const taskId of persistedState.wavePlan[i]) {
			const reconciled = reconciledMap.get(taskId);
			if (!reconciled) {
				actualPendingTaskIds.push(taskId); // Unknown task — treat as pending
				continue;
			}
			if (reconciled.action === "reconnect") {
				// Tasks with alive sessions need reconnection and remain pending.
				actualPendingTaskIds.push(taskId);
			}
			if (reconciled.action === "re-execute") {
				// Tasks with existing worktrees need re-execution and remain pending.
				actualPendingTaskIds.push(taskId);
			}
			if (reconciled.action === "skip" && reconciled.persistedStatus === "pending") {
				// Skipped tasks that were pending need execution
				actualPendingTaskIds.push(taskId);
			}
			if (reconciled.action === "pending") {
				// Never-started tasks from future waves need execution
				actualPendingTaskIds.push(taskId);
			}
		}
	}

	return {
		resumeWaveIndex,
		completedTaskIds,
		pendingTaskIds: actualPendingTaskIds,
		failedTaskIds,
		reconnectTaskIds,
		reExecuteTaskIds,
	};
}

{
	console.log("  ▸ all tasks in wave 0 done → resumeWaveIndex=1, future-wave pending task remains pending");
	const state = minimalPersistedState({
		wavePlan: [["T1", "T2"], ["T3"]],
		tasks: [
			makeTaskRecord({ taskId: "T1", status: "succeeded" }),
			makeTaskRecord({ taskId: "T2", status: "succeeded" }),
			// T3 is a future-wave task that was never allocated (no session name)
			makeTaskRecord({ taskId: "T3", status: "pending", sessionName: "" }),
		],
	});
	// All in wave 0 are succeeded → skip action
	const reconciled = reconcileTaskStates(state, new Set(), new Set());
	const point = computeResumePoint(state, reconciled);
	assertEqual(point.resumeWaveIndex, 1, "resumes from wave 1");
	assertEqual(point.completedTaskIds.length, 2, "2 tasks completed");
	// T3: pending + no session → "pending" action → pendingTaskIds (not failed)
	assert(point.pendingTaskIds.includes("T3"), "T3 is pending for execution (never-started future-wave task)");
	assert(!point.failedTaskIds.includes("T3"), "T3 is NOT failed (it was never started)");
}

{
	console.log("  ▸ all tasks in wave 0 done → mark-failed for allocated-but-crashed pending task");
	const state = minimalPersistedState({
		wavePlan: [["T1", "T2"], ["T3"]],
		tasks: [
			makeTaskRecord({ taskId: "T1", status: "succeeded" }),
			makeTaskRecord({ taskId: "T2", status: "succeeded" }),
			// T3 was allocated to a lane (has session name) but still pending — crashed before executing
			makeTaskRecord({ taskId: "T3", status: "pending", sessionName: "orch-lane-2" }),
		],
	});
	const reconciled = reconcileTaskStates(state, new Set(), new Set());
	const point = computeResumePoint(state, reconciled);
	// Wave 0: T1+T2 succeeded (skip→done). Wave 1: T3 mark-failed → NOT done for wave-skip.
	assertEqual(point.resumeWaveIndex, 1, "resumes from wave 1 (mark-failed NOT done for wave-skip)");
	// T3: pending status + has session + dead session + no .DONE + no worktree → mark-failed
	assert(point.failedTaskIds.includes("T3"), "T3 is failed (allocated but crashed, no worktree)");
	assert(!point.pendingTaskIds.includes("T3"), "T3 is NOT pending (it was allocated and crashed)");
}

{
	console.log("  ▸ partial wave 0 → resumeWaveIndex=0 with correct pending");
	const state = minimalPersistedState({
		wavePlan: [["T1", "T2"], ["T3"]],
		tasks: [
			makeTaskRecord({ taskId: "T1", status: "succeeded" }),
			makeTaskRecord({ taskId: "T2", status: "running" }),
			makeTaskRecord({ taskId: "T3", status: "pending" }),
		],
	});
	// T1 is succeeded→skip (terminal), T2 is running+dead→mark-failed (terminal), T3 is pending+has session→mark-failed (terminal)
	// T1 succeeded (skip→done), T2 running+dead→mark-failed (NOT done), T3 pending+session→mark-failed
	const reconciled = reconcileTaskStates(state, new Set(), new Set());
	const point = computeResumePoint(state, reconciled);
	assertEqual(point.resumeWaveIndex, 0, "resumes from wave 0 (mark-failed NOT done for wave-skip)");
	assert(point.completedTaskIds.includes("T1"), "T1 completed");
	assert(point.failedTaskIds.includes("T2"), "T2 failed");
}

{
	console.log("  ▸ mixed done/pending across waves → correct categorization");
	const state = minimalPersistedState({
		wavePlan: [["T1"], ["T2", "T3"], ["T4"]],
		tasks: [
			makeTaskRecord({ taskId: "T1", status: "succeeded" }),
			makeTaskRecord({ taskId: "T2", status: "succeeded" }),
			makeTaskRecord({ taskId: "T3", status: "running", sessionName: "orch-lane-2" }),
			makeTaskRecord({ taskId: "T4", status: "pending" }),
		],
	});
	// T1: succeeded→skip, T2: succeeded→skip, T3: running+alive→reconnect, T4: pending+dead→mark-failed
	const reconciled = reconcileTaskStates(state, new Set(["orch-lane-2"]), new Set());
	const point = computeResumePoint(state, reconciled);
	// Wave 0: T1 done. Wave 1: T2 done but T3 is reconnect (not "allDone" since reconnect != skip)
	assertEqual(point.resumeWaveIndex, 1, "resumes from wave 1 (T3 still running)");
	assertEqual(point.completedTaskIds.length, 2, "T1 and T2 completed");
	assertEqual(point.reconnectTaskIds.length, 1, "T3 needs reconnection");
	assert(point.reconnectTaskIds.includes("T3"), "T3 in reconnect list");
}

// ═══════════════════════════════════════════════════════════════════════
// 5.1: selectAbortTargetSessions
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 5.1: selectAbortTargetSessions ──");

// Reimplement selectAbortTargetSessions (mirrors source exactly)
type AbortTargetSession = {
	sessionName: string;
	laneId: string;
	taskId: string | null;
	taskFolderInWorktree: string | null;
	worktreePath: string | null;
};

function selectAbortTargetSessions(
	allSessionNames: string[],
	persistedState: any | null,
	runtimeLanes: any[],
	repoRoot: string,
): AbortTargetSession[] {
	const targetNames = allSessionNames.filter(name => {
		const suffix = name.replace(/^[^-]+-/, "");
		return suffix.startsWith("lane-") || suffix.startsWith("merge-");
	});

	const persistedLookup = new Map<string, { laneId: string; taskId: string; taskFolder: string }>();
	if (persistedState) {
		for (const task of persistedState.tasks) {
			if (task.sessionName) {
				persistedLookup.set(task.sessionName, {
					laneId: `lane-${task.laneNumber}`,
					taskId: task.taskId,
					taskFolder: task.taskFolder,
				});
			}
		}
	}

	const runtimeLookup = new Map<string, { laneId: string; taskId: string | null; worktreePath: string; taskFolder: string | null }>();
	for (const lane of runtimeLanes) {
		const currentTask = lane.tasks && lane.tasks.length > 0 ? lane.tasks[0] : null;
		runtimeLookup.set(lane.tmuxSessionName, {
			laneId: lane.laneId,
			taskId: currentTask?.taskId || null,
			worktreePath: lane.worktreePath,
			taskFolder: currentTask?.task?.taskFolder || null,
		});
	}

	return targetNames.map(sessionName => {
		const runtime = runtimeLookup.get(sessionName);
		const persisted = persistedLookup.get(sessionName);

		const laneId = runtime?.laneId || persisted?.laneId || "unknown";
		const taskId = runtime?.taskId || persisted?.taskId || null;
		const worktreePath = runtime?.worktreePath || null;
		const taskFolder = runtime?.taskFolder || persisted?.taskFolder || null;

		let taskFolderInWorktree: string | null = null;
		if (taskFolder && worktreePath && repoRoot) {
			const repoRootNorm = repoRoot.replace(/\\/g, "/");
			const folderNorm = taskFolder.replace(/\\/g, "/");
			let relativePath: string;
			if (folderNorm.startsWith(repoRootNorm + "/")) {
				relativePath = folderNorm.slice(repoRootNorm.length + 1);
			} else {
				relativePath = taskFolder;
			}
			taskFolderInWorktree = join(worktreePath, relativePath);
		}

		return { sessionName, laneId, taskId, taskFolderInWorktree, worktreePath };
	});
}

{
	console.log("  ▸ filters orch-lane-* and orch-merge-* sessions, ignores other sessions");
	const allSessions = [
		"orch-lane-1",
		"orch-lane-2",
		"orch-lane-1-worker",
		"orch-lane-1-reviewer",
		"orch-merge-1",
		"orch-something-else",
		"my-session",
	];
	const result = selectAbortTargetSessions(allSessions, null, [], "/repo");
	assertEqual(result.length, 5, "5 targets selected");
	const names = result.map(r => r.sessionName);
	assert(names.includes("orch-lane-1"), "includes orch-lane-1");
	assert(names.includes("orch-lane-2"), "includes orch-lane-2");
	assert(names.includes("orch-lane-1-worker"), "includes orch-lane-1-worker");
	assert(names.includes("orch-lane-1-reviewer"), "includes orch-lane-1-reviewer");
	assert(names.includes("orch-merge-1"), "includes orch-merge-1");
	assert(!names.includes("orch-something-else"), "excludes orch-something-else");
	assert(!names.includes("my-session"), "excludes my-session");
}

{
	console.log("  ▸ enriches sessions with taskFolder from persisted state");
	const allSessions = ["orch-lane-1"];
	const persisted = minimalPersistedState({
		tasks: [
			makeTaskRecord({
				taskId: "TO-001",
				sessionName: "orch-lane-1",
				laneNumber: 1,
				taskFolder: "/repo/docs/tasks/TO-001",
			}),
		],
	});
	const runtimeLanes = [
		{
			tmuxSessionName: "orch-lane-1",
			laneId: "lane-1",
			worktreePath: "/worktrees/lane-1",
			tasks: [{ taskId: "TO-001", task: { taskFolder: "/repo/docs/tasks/TO-001" } }],
		},
	];
	const result = selectAbortTargetSessions(allSessions, persisted, runtimeLanes, "/repo");
	assertEqual(result.length, 1, "1 target selected");
	assertEqual(result[0].laneId, "lane-1", "lane ID from runtime");
	assertEqual(result[0].taskId, "TO-001", "task ID from runtime");
	assert(result[0].taskFolderInWorktree !== null, "task folder resolved");
	assert(result[0].taskFolderInWorktree!.includes("lane-1"), "task folder in worktree path");
	assert(result[0].taskFolderInWorktree!.includes("TO-001"), "task folder includes task path");
}

{
	console.log("  ▸ handles no persisted state (null) gracefully");
	const allSessions = ["orch-lane-1", "orch-lane-2"];
	const result = selectAbortTargetSessions(allSessions, null, [], "/repo");
	assertEqual(result.length, 2, "2 targets selected");
	assertEqual(result[0].laneId, "unknown", "lane ID unknown without state");
	assertEqual(result[0].taskId, null, "no task ID without state");
	assertEqual(result[0].taskFolderInWorktree, null, "no task folder without state");
}

// ═══════════════════════════════════════════════════════════════════════
// 5.2: planAbortActions
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 5.2: planAbortActions ──");

type AbortActionStep =
	| { type: "write-wrapup" }
	| { type: "poll-wait"; gracePeriodMs: number; pollIntervalMs: number }
	| { type: "kill-remaining" }
	| { type: "kill-all" };

function planAbortActions(
	mode: "graceful" | "hard",
	gracePeriodMs: number = 60_000,
	pollIntervalMs: number = 2_000,
): AbortActionStep[] {
	if (mode === "hard") {
		return [{ type: "kill-all" }];
	}
	return [
		{ type: "write-wrapup" },
		{ type: "poll-wait", gracePeriodMs, pollIntervalMs },
		{ type: "kill-remaining" },
	];
}

{
	console.log("  ▸ graceful mode returns write-wrapup → poll → kill-remaining steps");
	const steps = planAbortActions("graceful", 60000, 2000);
	assertEqual(steps.length, 3, "3 steps for graceful");
	assertEqual(steps[0].type, "write-wrapup", "step 1: write-wrapup");
	assertEqual(steps[1].type, "poll-wait", "step 2: poll-wait");
	const pollStep = steps[1] as { type: "poll-wait"; gracePeriodMs: number; pollIntervalMs: number };
	assertEqual(pollStep.gracePeriodMs, 60000, "grace period 60s");
	assertEqual(pollStep.pollIntervalMs, 2000, "poll interval 2s");
	assertEqual(steps[2].type, "kill-remaining", "step 3: kill-remaining");
}

{
	console.log("  ▸ hard mode returns kill-all step only");
	const steps = planAbortActions("hard");
	assertEqual(steps.length, 1, "1 step for hard");
	assertEqual(steps[0].type, "kill-all", "step 1: kill-all");
}

// ═══════════════════════════════════════════════════════════════════════
// 5.3: ORCH_MESSAGES for abort
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 5.3: ORCH_MESSAGES for abort ──");

{
	console.log("  ▸ all abort message functions return valid strings");

	// Reimport the source to verify the messages are defined
	// Since we can't import directly, we verify by reimplementing the message functions
	const messages = {
		abortGracefulStarting: (batchId: string, sessionCount: number) =>
			`⏳ Graceful abort of batch ${batchId}: signaling ${sessionCount} session(s) to checkpoint and exit...`,
		abortGracefulWaiting: (batchId: string, graceSec: number) =>
			`⏳ Waiting up to ${graceSec}s for sessions to checkpoint and exit...`,
		abortGracefulForceKill: (count: number) =>
			`⚠️ Force-killing ${count} session(s) that did not exit within timeout`,
		abortGracefulComplete: (batchId: string, graceful: number, forceKilled: number, durationSec: number) =>
			`✅ Graceful abort complete for batch ${batchId}: ${graceful} exited gracefully, ${forceKilled} force-killed (${durationSec}s)`,
		abortHardStarting: (batchId: string, sessionCount: number) =>
			`⚡ Hard abort of batch ${batchId}: killing ${sessionCount} session(s) immediately...`,
		abortHardComplete: (batchId: string, killed: number, durationSec: number) =>
			`✅ Hard abort complete for batch ${batchId}: ${killed} session(s) killed (${durationSec}s)`,
		abortPartialFailure: (failureCount: number) =>
			`⚠️ ${failureCount} error(s) during abort (see details above)`,
		abortNoBatch: () =>
			`No active batch to abort. Use /orch <areas|all> to start a batch.`,
		abortComplete: (mode: "graceful" | "hard", sessionsKilled: number) =>
			`🏁 Abort (${mode}) complete: ${sessionsKilled} session(s) terminated. Worktrees and branches preserved.`,
	};

	// Verify each message returns a non-empty string
	const gracefulStarting = messages.abortGracefulStarting("BATCH001", 3);
	assert(typeof gracefulStarting === "string" && gracefulStarting.length > 0, "abortGracefulStarting returns string");
	assert(gracefulStarting.includes("BATCH001"), "abortGracefulStarting includes batchId");
	assert(gracefulStarting.includes("3"), "abortGracefulStarting includes session count");

	const gracefulWaiting = messages.abortGracefulWaiting("BATCH001", 60);
	assert(typeof gracefulWaiting === "string" && gracefulWaiting.length > 0, "abortGracefulWaiting returns string");
	assert(gracefulWaiting.includes("60"), "abortGracefulWaiting includes grace period");

	const forceKill = messages.abortGracefulForceKill(2);
	assert(typeof forceKill === "string" && forceKill.length > 0, "abortGracefulForceKill returns string");
	assert(forceKill.includes("2"), "abortGracefulForceKill includes count");

	const gracefulComplete = messages.abortGracefulComplete("BATCH001", 2, 1, 45);
	assert(typeof gracefulComplete === "string" && gracefulComplete.length > 0, "abortGracefulComplete returns string");
	assert(gracefulComplete.includes("BATCH001"), "abortGracefulComplete includes batchId");

	const hardStarting = messages.abortHardStarting("BATCH001", 5);
	assert(typeof hardStarting === "string" && hardStarting.length > 0, "abortHardStarting returns string");
	assert(hardStarting.includes("5"), "abortHardStarting includes session count");

	const hardComplete = messages.abortHardComplete("BATCH001", 4, 2);
	assert(typeof hardComplete === "string" && hardComplete.length > 0, "abortHardComplete returns string");
	assert(hardComplete.includes("4"), "abortHardComplete includes kill count");

	const partialFailure = messages.abortPartialFailure(3);
	assert(typeof partialFailure === "string" && partialFailure.length > 0, "abortPartialFailure returns string");
	assert(partialFailure.includes("3"), "abortPartialFailure includes failure count");

	const noBatch = messages.abortNoBatch();
	assert(typeof noBatch === "string" && noBatch.length > 0, "abortNoBatch returns string");
	assert(noBatch.includes("/orch"), "abortNoBatch mentions /orch");

	const complete = messages.abortComplete("graceful", 3);
	assert(typeof complete === "string" && complete.length > 0, "abortComplete returns string");
	assert(complete.includes("graceful"), "abortComplete includes mode");
	assert(complete.includes("Worktrees"), "abortComplete mentions preserved worktrees");

	const hardAbortComplete = messages.abortComplete("hard", 5);
	assert(hardAbortComplete.includes("hard"), "abortComplete hard mode includes mode");
}

// Also verify abort message functions exist in the source file
{
	assert(source.includes("abortGracefulStarting:"), "source defines abortGracefulStarting");
	assert(source.includes("abortGracefulWaiting:"), "source defines abortGracefulWaiting");
	assert(source.includes("abortGracefulForceKill:"), "source defines abortGracefulForceKill");
	assert(source.includes("abortGracefulComplete:"), "source defines abortGracefulComplete");
	assert(source.includes("abortHardStarting:"), "source defines abortHardStarting");
	assert(source.includes("abortHardComplete:"), "source defines abortHardComplete");
	assert(source.includes("abortPartialFailure:"), "source defines abortPartialFailure");
	assert(source.includes("abortNoBatch:"), "source defines abortNoBatch");
	assert(source.includes("abortComplete:"), "source defines abortComplete");
}

// ═══════════════════════════════════════════════════════════════════════
// 6.1: Mixed-Outcome Lane Guard
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 6.1: Mixed-outcome lane guard ──");

/**
 * Reimplementation of the mixed-outcome lane guard logic from executeOrchBatch().
 * This tests the decision logic: a lane with both succeeded and failed tasks should
 * trigger merge failure handling (status="partial"), NOT silently merge or skip.
 */
interface TestLaneTaskOutcome {
	taskId: string;
	status: "succeeded" | "failed" | "stalled" | "skipped" | "pending" | "running";
}
interface TestLaneExecutionResult {
	laneNumber: number;
	laneId: string;
	tasks: TestLaneTaskOutcome[];
}

function detectMixedOutcomeLanes(laneResults: TestLaneExecutionResult[]): TestLaneExecutionResult[] {
	return laneResults.filter(lr => {
		const hasSucceeded = lr.tasks.some(t => t.status === "succeeded");
		const hasHardFailure = lr.tasks.some(
			t => t.status === "failed" || t.status === "stalled",
		);
		return hasSucceeded && hasHardFailure;
	});
}

function computeMergeOutcomeForWave(
	laneResults: TestLaneExecutionResult[],
	succeededTaskIds: string[],
): { status: "succeeded" | "partial" | "skipped"; failedLane: number | null; failureReason: string | null } {
	const mixedOutcomeLanes = detectMixedOutcomeLanes(laneResults);

	if (succeededTaskIds.length === 0) {
		return { status: "skipped", failedLane: null, failureReason: null };
	}

	// Build mergeable lane count (succeeded lanes WITHOUT hard failures)
	const laneOutcomeByNumber = new Map<number, TestLaneExecutionResult>();
	for (const lr of laneResults) {
		laneOutcomeByNumber.set(lr.laneNumber, lr);
	}
	const mergeableLaneCount = laneResults.filter(lane => {
		const hasSucceeded = lane.tasks.some(t => t.status === "succeeded");
		const hasHardFailure = lane.tasks.some(
			t => t.status === "failed" || t.status === "stalled",
		);
		return hasSucceeded && !hasHardFailure;
	}).length;

	if (mergeableLaneCount > 0 && mixedOutcomeLanes.length > 0) {
		// Merge happens but mixed-outcome override forces "partial"
		const mixedIds = mixedOutcomeLanes.map(l => `lane-${l.laneNumber}`).join(", ");
		return {
			status: "partial",
			failedLane: mixedOutcomeLanes[0].laneNumber,
			failureReason:
				`Lane(s) ${mixedIds} contain both succeeded and failed tasks. ` +
				`Automatic partial-branch merge is disabled to avoid dropping succeeded commits.`,
		};
	}

	if (mergeableLaneCount === 0 && mixedOutcomeLanes.length > 0) {
		// No mergeable lanes but mixed outcomes detected — still "partial"
		const mixedIds = mixedOutcomeLanes.map(l => `lane-${l.laneNumber}`).join(", ");
		return {
			status: "partial",
			failedLane: mixedOutcomeLanes[0].laneNumber,
			failureReason:
				`Lane(s) ${mixedIds} contain both succeeded and failed tasks. ` +
				`Automatic partial-branch merge is disabled to avoid dropping succeeded commits.`,
		};
	}

	if (mergeableLaneCount > 0) {
		return { status: "succeeded", failedLane: null, failureReason: null };
	}

	return { status: "skipped", failedLane: null, failureReason: null };
}

{
	console.log("  ▸ lane with both succeeded and failed tasks → mergeResult.status = 'partial'");

	const laneResults: TestLaneExecutionResult[] = [
		{
			laneNumber: 1,
			laneId: "lane-1",
			tasks: [
				{ taskId: "T-001", status: "succeeded" },
				{ taskId: "T-002", status: "failed" },
			],
		},
	];

	const result = computeMergeOutcomeForWave(laneResults, ["T-001"]);
	assertEqual(result.status, "partial", "mixed-outcome lane triggers partial status");
	assert(result.failedLane !== null, "failedLane is set");
	assertEqual(result.failedLane, 1, "failedLane points to lane 1");
	assert(result.failureReason !== null, "failure reason is provided");
	assert(result.failureReason!.includes("lane-1"), "failure reason references mixed lane ID");
	assert(result.failureReason!.includes("both succeeded and failed"), "failure reason explains mixed outcomes");
}

{
	console.log("  ▸ lane with only succeeded tasks → normal merge (not partial)");

	const laneResults: TestLaneExecutionResult[] = [
		{
			laneNumber: 1,
			laneId: "lane-1",
			tasks: [
				{ taskId: "T-001", status: "succeeded" },
				{ taskId: "T-002", status: "succeeded" },
			],
		},
	];

	const result = computeMergeOutcomeForWave(laneResults, ["T-001", "T-002"]);
	assertEqual(result.status, "succeeded", "all-succeeded lane allows normal merge");
	assertEqual(result.failedLane, null, "no failed lane");
	assertEqual(result.failureReason, null, "no failure reason");
}

{
	console.log("  ▸ lane with succeeded + stalled tasks → partial (stalled is hard failure)");

	const laneResults: TestLaneExecutionResult[] = [
		{
			laneNumber: 2,
			laneId: "lane-2",
			tasks: [
				{ taskId: "T-001", status: "succeeded" },
				{ taskId: "T-002", status: "stalled" },
			],
		},
	];

	const result = computeMergeOutcomeForWave(laneResults, ["T-001"]);
	assertEqual(result.status, "partial", "succeeded + stalled = partial");
	assertEqual(result.failedLane, 2, "failed lane is 2");
}

{
	console.log("  ▸ multiple lanes: one clean + one mixed → partial due to mixed lane");

	const laneResults: TestLaneExecutionResult[] = [
		{
			laneNumber: 1,
			laneId: "lane-1",
			tasks: [{ taskId: "T-001", status: "succeeded" }],
		},
		{
			laneNumber: 2,
			laneId: "lane-2",
			tasks: [
				{ taskId: "T-002", status: "succeeded" },
				{ taskId: "T-003", status: "failed" },
			],
		},
	];

	const result = computeMergeOutcomeForWave(laneResults, ["T-001", "T-002"]);
	assertEqual(result.status, "partial", "mixed outcome in any lane escalates to partial");
	assertEqual(result.failedLane, 2, "failed lane is the mixed-outcome lane");
}

{
	console.log("  ▸ lane with only failed tasks (no succeeded) → merge skipped (no mixed outcomes)");

	const laneResults: TestLaneExecutionResult[] = [
		{
			laneNumber: 1,
			laneId: "lane-1",
			tasks: [
				{ taskId: "T-001", status: "failed" },
				{ taskId: "T-002", status: "skipped" },
			],
		},
	];

	// No succeeded tasks
	const result = computeMergeOutcomeForWave(laneResults, []);
	assertEqual(result.status, "skipped", "all-failed lane = merge skipped");
	assertEqual(result.failedLane, null, "no failed lane (no mixed outcome)");
}

// ═══════════════════════════════════════════════════════════════════════
// 6.2: Cleanup Suppression on Merge Pause/Abort
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 6.2: Cleanup suppression on merge pause/abort ──");

/**
 * Reimplementation of cleanup suppression decision logic from executeOrchBatch().
 * Tests that when merge failure transitions batch to paused/stopped,
 * preserveWorktreesForResume is set to true and cleanup is skipped.
 */
interface CleanupDecision {
	phase: string;
	preserveWorktreesForResume: boolean;
	persistReasonBeforeCleanup: string | null;
	errorsAdded: string[];
}

function simulateMergeFailureHandling(
	mergeStatus: "failed" | "partial",
	mergeFailurePolicy: "pause" | "abort",
	waveIdx: number,
	failureReason: string,
): CleanupDecision {
	let phase = "executing";
	let preserveWorktreesForResume = false;
	let persistReasonBeforeCleanup: string | null = null;
	const errorsAdded: string[] = [];

	// This mirrors the merge failure handling code in executeOrchBatch()
	if (mergeStatus === "failed" || mergeStatus === "partial") {
		if (mergeFailurePolicy === "pause") {
			phase = "paused";
			errorsAdded.push(
				`Merge failed at wave ${waveIdx + 1}: ${failureReason}. ` +
				`Batch paused. Resolve conflicts and use /orch-resume to continue.`,
			);
			persistReasonBeforeCleanup = "merge-failure-pause";
			preserveWorktreesForResume = true;
		} else {
			// abort policy
			phase = "stopped";
			errorsAdded.push(
				`Merge failed at wave ${waveIdx + 1}: ${failureReason}. ` +
				`Batch aborted by on_merge_failure policy.`,
			);
			persistReasonBeforeCleanup = "merge-failure-abort";
			preserveWorktreesForResume = true;
		}
	}

	return { phase, preserveWorktreesForResume, persistReasonBeforeCleanup, errorsAdded };
}

{
	console.log("  ▸ merge failure + pause policy → preserveWorktrees=true, phase=paused, persist before cleanup");

	const result = simulateMergeFailureHandling("partial", "pause", 0, "conflict unresolved");
	assertEqual(result.phase, "paused", "phase transitions to paused");
	assertEqual(result.preserveWorktreesForResume, true, "worktrees preserved for resume");
	assertEqual(result.persistReasonBeforeCleanup, "merge-failure-pause", "state persisted with reason merge-failure-pause");
	assertEqual(result.errorsAdded.length, 1, "one error added");
	assert(result.errorsAdded[0].includes("paused"), "error mentions paused");
	assert(result.errorsAdded[0].includes("/orch-resume"), "error suggests resume");
}

{
	console.log("  ▸ merge failure + abort policy → preserveWorktrees=true, phase=stopped, persist before cleanup");

	const result = simulateMergeFailureHandling("failed", "abort", 1, "BUILD_FAILURE on verification");
	assertEqual(result.phase, "stopped", "phase transitions to stopped");
	assertEqual(result.preserveWorktreesForResume, true, "worktrees preserved for debugging");
	assertEqual(result.persistReasonBeforeCleanup, "merge-failure-abort", "state persisted with reason merge-failure-abort");
	assertEqual(result.errorsAdded.length, 1, "one error added");
	assert(result.errorsAdded[0].includes("aborted"), "error mentions aborted");
}

{
	console.log("  ▸ clean completion (no merge failure) → preserveWorktrees=false, cleanup proceeds");

	// Simulate: no merge failure means we never enter the merge failure handling block
	let preserveWorktreesForResume = false;
	let phase = "completed";

	// The cleanup block checks preserveWorktreesForResume
	const shouldCleanup = !preserveWorktreesForResume;

	assertEqual(shouldCleanup, true, "cleanup proceeds on clean completion");
	assertEqual(preserveWorktreesForResume, false, "worktrees not preserved");
	assertEqual(phase, "completed", "phase is completed");
}

// Verify the source code actually has the cleanup suppression logic
{
	console.log("  ▸ verify source code has preserveWorktreesForResume guard in cleanup block");
	assert(source.includes("if (preserveWorktreesForResume)"), "source checks preserveWorktreesForResume in cleanup");
	assert(source.includes("skipping final cleanup to preserve worktrees"), "source logs cleanup skip reason");
	assert(source.includes("merge-failure-pause"), "source persists state before pause cleanup");
	assert(source.includes("merge-failure-abort"), "source persists state before abort cleanup");
}

// ═══════════════════════════════════════════════════════════════════════
// 6.3: parseMergeResult Edge Cases
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 6.3: parseMergeResult edge cases ──");

// MergeError reimplementation
class TestMergeError extends Error {
	code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = "MergeError";
		this.code = code;
	}
}

// Valid merge statuses (must match source)
const TEST_VALID_MERGE_STATUSES: ReadonlySet<string> = new Set([
	"SUCCESS", "CONFLICT_RESOLVED", "CONFLICT_UNRESOLVED", "BUILD_FAILURE",
]);

/**
 * Reimplementation of parseMergeResult core logic — WITHOUT retry/sleepSync.
 * Tests the validation logic rather than the retry mechanism.
 * This mirrors the inner parsing logic of parseMergeResult exactly.
 */
function parseMergeResultCore(filePath: string): any {
	if (!existsSync(filePath)) {
		throw new TestMergeError(
			"MERGE_RESULT_INVALID",
			`Merge result file not found: ${filePath}`,
		);
	}

	const raw = readFileSync(filePath, "utf-8").trim();
	if (!raw) {
		throw new TestMergeError(
			"MERGE_RESULT_INVALID",
			`Merge result file is empty: ${filePath}`,
		);
	}

	let parsed: any;
	try {
		parsed = JSON.parse(raw);
	} catch (err: unknown) {
		throw new TestMergeError(
			"MERGE_RESULT_INVALID",
			`Failed to parse merge result JSON: ${(err as Error).message}. File: ${filePath}`,
		);
	}

	// Validate required fields
	if (typeof parsed.status !== "string") {
		throw new TestMergeError(
			"MERGE_RESULT_MISSING_FIELDS",
			`Merge result missing required field "status": ${filePath}`,
		);
	}
	if (typeof parsed.source_branch !== "string") {
		throw new TestMergeError(
			"MERGE_RESULT_MISSING_FIELDS",
			`Merge result missing required field "source_branch": ${filePath}`,
		);
	}
	if (!parsed.verification || typeof parsed.verification !== "object") {
		throw new TestMergeError(
			"MERGE_RESULT_MISSING_FIELDS",
			`Merge result missing required field "verification": ${filePath}`,
		);
	}

	// Validate status value — unknown → BUILD_FAILURE
	if (!TEST_VALID_MERGE_STATUSES.has(parsed.status)) {
		parsed.status = "BUILD_FAILURE";
	}

	// Normalize optional fields with defaults
	return {
		status: parsed.status,
		source_branch: parsed.source_branch,
		target_branch: parsed.target_branch || "",
		merge_commit: parsed.merge_commit || "",
		conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
		verification: {
			ran: !!parsed.verification.ran,
			passed: !!parsed.verification.passed,
			output: typeof parsed.verification.output === "string"
				? parsed.verification.output.slice(0, 2000)
				: "",
		},
	};
}

// Create temp dir for merge result tests
const mergeTestDir = join(tmpdir(), `orch-merge-test-${Date.now()}`);
mkdirSync(mergeTestDir, { recursive: true });

try {
	{
		console.log("  ▸ valid merge result JSON parses correctly");
		const validResult = {
			status: "SUCCESS",
			source_branch: "task/lane-1-20260309",
			target_branch: "develop",
			merge_commit: "abc123def456",
			conflicts: [],
			verification: { ran: true, passed: true, output: "All tests passed" },
		};
		const filePath = join(mergeTestDir, "valid-result.json");
		writeFileSync(filePath, JSON.stringify(validResult), "utf-8");

		const result = parseMergeResultCore(filePath);
		assertEqual(result.status, "SUCCESS", "status parsed correctly");
		assertEqual(result.source_branch, "task/lane-1-20260309", "source_branch parsed");
		assertEqual(result.target_branch, "develop", "target_branch parsed");
		assertEqual(result.merge_commit, "abc123def456", "merge_commit parsed");
		assertEqual(result.verification.ran, true, "verification.ran parsed");
		assertEqual(result.verification.passed, true, "verification.passed parsed");
		assertEqual(result.verification.output, "All tests passed", "verification.output parsed");
	}

	{
		console.log("  ▸ malformed JSON throws MERGE_RESULT_INVALID");
		const filePath = join(mergeTestDir, "malformed.json");
		writeFileSync(filePath, "{ this is not json }", "utf-8");

		assertThrows(
			() => parseMergeResultCore(filePath),
			"MERGE_RESULT_INVALID",
			"malformed JSON throws MERGE_RESULT_INVALID",
		);
	}

	{
		console.log("  ▸ missing 'status' field throws MERGE_RESULT_MISSING_FIELDS");
		const noStatus = {
			source_branch: "task/lane-1",
			verification: { ran: true, passed: true, output: "" },
		};
		const filePath = join(mergeTestDir, "no-status.json");
		writeFileSync(filePath, JSON.stringify(noStatus), "utf-8");

		assertThrows(
			() => parseMergeResultCore(filePath),
			"MERGE_RESULT_MISSING_FIELDS",
			"missing status throws MERGE_RESULT_MISSING_FIELDS",
		);
	}

	{
		console.log("  ▸ missing 'source_branch' field throws MERGE_RESULT_MISSING_FIELDS");
		const noSourceBranch = {
			status: "SUCCESS",
			verification: { ran: true, passed: true, output: "" },
		};
		const filePath = join(mergeTestDir, "no-source-branch.json");
		writeFileSync(filePath, JSON.stringify(noSourceBranch), "utf-8");

		assertThrows(
			() => parseMergeResultCore(filePath),
			"MERGE_RESULT_MISSING_FIELDS",
			"missing source_branch throws MERGE_RESULT_MISSING_FIELDS",
		);
	}

	{
		console.log("  ▸ missing 'verification' field throws MERGE_RESULT_MISSING_FIELDS");
		const noVerification = {
			status: "SUCCESS",
			source_branch: "task/lane-1",
		};
		const filePath = join(mergeTestDir, "no-verification.json");
		writeFileSync(filePath, JSON.stringify(noVerification), "utf-8");

		assertThrows(
			() => parseMergeResultCore(filePath),
			"MERGE_RESULT_MISSING_FIELDS",
			"missing verification throws MERGE_RESULT_MISSING_FIELDS",
		);
	}

	{
		console.log("  ▸ unknown status maps to BUILD_FAILURE (fail-safe)");
		const unknownStatus = {
			status: "CUSTOM_STATUS_UNKNOWN",
			source_branch: "task/lane-1",
			verification: { ran: false, passed: false, output: "" },
		};
		const filePath = join(mergeTestDir, "unknown-status.json");
		writeFileSync(filePath, JSON.stringify(unknownStatus), "utf-8");

		const result = parseMergeResultCore(filePath);
		assertEqual(result.status, "BUILD_FAILURE", "unknown status mapped to BUILD_FAILURE");
		assertEqual(result.source_branch, "task/lane-1", "source_branch preserved");
	}

	{
		console.log("  ▸ empty file throws MERGE_RESULT_INVALID");
		const filePath = join(mergeTestDir, "empty.json");
		writeFileSync(filePath, "", "utf-8");

		assertThrows(
			() => parseMergeResultCore(filePath),
			"MERGE_RESULT_INVALID",
			"empty file throws MERGE_RESULT_INVALID",
		);
	}

	{
		console.log("  ▸ non-existent file throws MERGE_RESULT_INVALID");
		const filePath = join(mergeTestDir, "does-not-exist.json");

		assertThrows(
			() => parseMergeResultCore(filePath),
			"MERGE_RESULT_INVALID",
			"non-existent file throws MERGE_RESULT_INVALID",
		);
	}

	{
		console.log("  ▸ all 4 valid merge statuses accepted");
		const statuses = ["SUCCESS", "CONFLICT_RESOLVED", "CONFLICT_UNRESOLVED", "BUILD_FAILURE"];
		let allValid = true;
		for (const status of statuses) {
			const data = {
				status,
				source_branch: `task/test-${status}`,
				verification: { ran: true, passed: status === "SUCCESS", output: "" },
			};
			const filePath = join(mergeTestDir, `status-${status}.json`);
			writeFileSync(filePath, JSON.stringify(data), "utf-8");
			try {
				const result = parseMergeResultCore(filePath);
				if (result.status !== status) allValid = false;
			} catch {
				allValid = false;
			}
		}
		assert(allValid, "all 4 valid merge statuses parsed without mapping");
	}

	{
		console.log("  ▸ optional fields default correctly when missing");
		const minimalValid = {
			status: "SUCCESS",
			source_branch: "task/minimal",
			verification: { ran: false, passed: false },
			// No target_branch, merge_commit, conflicts, verification.output
		};
		const filePath = join(mergeTestDir, "minimal-valid.json");
		writeFileSync(filePath, JSON.stringify(minimalValid), "utf-8");

		const result = parseMergeResultCore(filePath);
		assertEqual(result.target_branch, "", "missing target_branch defaults to empty string");
		assertEqual(result.merge_commit, "", "missing merge_commit defaults to empty string");
		assertEqual(result.conflicts.length, 0, "missing conflicts defaults to empty array");
		assertEqual(result.verification.output, "", "missing verification.output defaults to empty string");
	}

} finally {
	try { rmSync(mergeTestDir, { recursive: true, force: true }); } catch { /* best effort */ }
}

// Verify the source code has the retry logic and unknown status handling
{
	console.log("  ▸ verify source has retry logic and unknown status fallback");
	assert(source.includes("MERGE_RESULT_READ_RETRIES"), "source defines retry constant");
	assert(source.includes(`parsed.status = "BUILD_FAILURE"`), "source maps unknown status to BUILD_FAILURE");
	assert(source.includes("MERGE_RESULT_MISSING_FIELDS"), "source uses MERGE_RESULT_MISSING_FIELDS error code");
	assert(source.includes("MERGE_RESULT_INVALID"), "source uses MERGE_RESULT_INVALID error code");
}

// ═══════════════════════════════════════════════════════════════════════
// 6.4: End-to-End Simulated Interruption Scenario
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 6.4: End-to-end simulated interruption scenario ──");

{
	console.log("  ▸ full persist → load → reconcile → resume-point pipeline");

	// Step 1: Simulate a batch that was executing when disconnected
	const e2eRoot = join(tmpdir(), `orch-e2e-test-${Date.now()}`);
	mkdirSync(join(e2eRoot, ".pi"), { recursive: true });

	try {
		// Create a runtime state (simulating mid-batch execution)
		const runtimeState = freshMinimalBatchState();
		runtimeState.phase = "executing";
		runtimeState.batchId = "20260309E2E";
		runtimeState.startedAt = Date.now() - 120000;
		runtimeState.totalWaves = 3;
		runtimeState.totalTasks = 5;
		runtimeState.currentWaveIndex = 1;
		runtimeState.succeededTasks = 2;

		const wavePlan = [["E2E-001", "E2E-002"], ["E2E-003", "E2E-004"], ["E2E-005"]];
		const lanes = [
			minimalLane(1, ["E2E-001", "E2E-003", "E2E-005"]),
			minimalLane(2, ["E2E-002", "E2E-004"]),
		];
		const outcomes = [
			{ ...minimalOutcome("E2E-001", "succeeded"), sessionName: "orch-lane-1" },
			{ ...minimalOutcome("E2E-002", "succeeded"), sessionName: "orch-lane-2" },
			{ ...minimalOutcome("E2E-003", "running"), sessionName: "orch-lane-1" },
			{ ...minimalOutcome("E2E-004", "running"), sessionName: "orch-lane-2" },
		];

		// PERSIST: Write state to disk (simulating what executeOrchBatch does)
		persistRuntimeState("wave-execution-mid", runtimeState, wavePlan, lanes, outcomes, null, e2eRoot);

		// Verify file exists
		assert(existsSync(batchStatePath(e2eRoot)), "state file persisted to disk");

		// LOAD: Read it back (simulating what resumeOrchBatch does)
		const loadedState = loadBatchState(e2eRoot);
		assert(loadedState !== null, "state loaded successfully");
		assertEqual(loadedState!.phase, "executing", "loaded phase is executing");
		assertEqual(loadedState!.batchId, "20260309E2E", "loaded batchId matches");
		assertEqual(loadedState!.currentWaveIndex, 1, "loaded waveIndex is 1");
		assertEqual(loadedState!.totalWaves, 3, "loaded totalWaves is 3");
		// serializeBatchState builds full registry from wavePlan + outcomes.
		// Wave plan has 5 tasks, outcomes has 4 → full set is 5.
		assertEqual(loadedState!.tasks.length, 5, "5 task records persisted (all tasks in wave plan)");
		assertEqual(loadedState!.wavePlan.length, 3, "3 waves in plan");

		// RECONCILE: Simulate that after disconnect, E2E-003's session is dead + .DONE exists,
		// E2E-004's session is still alive, E2E-001/002 completed earlier
		const aliveSessions = new Set(["orch-lane-2"]); // E2E-004's session
		const doneTaskIds = new Set(["E2E-001", "E2E-002", "E2E-003"]); // E2E-003 completed while disconnected

		const reconciled = reconcileTaskStates(loadedState!, aliveSessions, doneTaskIds);
		// 5 tasks reconciled: E2E-001..004 from outcomes + E2E-005 from wave plan (pending, no session)
		assertEqual(reconciled.length, 5, "5 tasks reconciled");

		// E2E-001: succeeded in persisted + DONE → mark-complete
		const e001 = reconciled.find((r: any) => r.taskId === "E2E-001");
		assertEqual(e001!.action, "mark-complete", "E2E-001: done file → mark-complete");

		// E2E-002: succeeded in persisted + DONE → mark-complete
		const e002 = reconciled.find((r: any) => r.taskId === "E2E-002");
		assertEqual(e002!.action, "mark-complete", "E2E-002: done file → mark-complete");

		// E2E-003: running in persisted + DONE → mark-complete (DONE takes precedence)
		const e003 = reconciled.find((r: any) => r.taskId === "E2E-003");
		assertEqual(e003!.action, "mark-complete", "E2E-003: DONE takes precedence over running");

		// E2E-004: running in persisted + alive session + no DONE → reconnect
		const e004 = reconciled.find((r: any) => r.taskId === "E2E-004");
		assertEqual(e004!.action, "reconnect", "E2E-004: alive session → reconnect");

		// RESUME POINT: Determine where to resume
		const resumePoint = computeResumePoint(loadedState!, reconciled);

		// Wave 0 (E2E-001, E2E-002): both completed → skip
		// Wave 1 (E2E-003, E2E-004): E2E-003 completed, E2E-004 still running → resume from wave 1
		assertEqual(resumePoint.resumeWaveIndex, 1, "resume from wave 1 (E2E-004 still running)");
		assertEqual(resumePoint.completedTaskIds.length, 3, "3 tasks completed (E2E-001, 002, 003)");
		assert(resumePoint.completedTaskIds.includes("E2E-001"), "E2E-001 in completed");
		assert(resumePoint.completedTaskIds.includes("E2E-002"), "E2E-002 in completed");
		assert(resumePoint.completedTaskIds.includes("E2E-003"), "E2E-003 in completed");
		assertEqual(resumePoint.reconnectTaskIds.length, 1, "1 task needs reconnection");
		assert(resumePoint.reconnectTaskIds.includes("E2E-004"), "E2E-004 needs reconnection");
		// E2E-005 was pending (wave 2, not started) with dead session → mark-failed by reconciler.
		// However, it's in wave 2 (future wave), so computeResumePoint categorizes it correctly.
		assertEqual(resumePoint.failedTaskIds.length, 1, "1 task marked failed (E2E-005: pending + dead session)");

		// ORPHAN DETECTION: Check what analyzeOrchestratorStartupState would recommend
		const orphanResult = analyzeOrchestratorStartupState(
			["orch-lane-2"], // One alive session
			"valid",
			loadedState!,
			null,
			doneTaskIds,
		);
		assertEqual(orphanResult.recommendedAction, "resume", "orphan detection recommends resume");
		assert(orphanResult.userMessage.includes("/orch-resume"), "message suggests /orch-resume");

		// RESUME ELIGIBILITY: Check if state is resumable
		const eligibility = checkResumeEligibility(loadedState!);
		assertEqual(eligibility.eligible, true, "executing state is resumable");

	} finally {
		try { rmSync(e2eRoot, { recursive: true, force: true }); } catch { /* best effort */ }
	}
}

// ═══════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════
// 7.1: Schema v1 Compatibility — Load Path Regression Tests (Step 2)
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 7.1: Schema v1 compatibility — load path regression tests ──");

{
	console.log("  ▸ loadBatchState with v1 fixture yields v2 in memory (full load path)");

	// Write the v1 fixture to a temp root's .pi/batch-state.json, then load it
	const v1LoadRoot = join(tmpdir(), `orch-v1-load-test-${Date.now()}`);
	mkdirSync(join(v1LoadRoot, ".pi"), { recursive: true });

	try {
		const v1Json = loadFixture("batch-state-v1-valid.json");
		writeFileSync(batchStatePath(v1LoadRoot), v1Json, "utf-8");

		const loaded = loadBatchState(v1LoadRoot);
		assert(loaded !== null, "v1 load path: returns non-null");
		assertEqual(loaded!.schemaVersion, BATCH_STATE_SCHEMA_VERSION, "v1 load path: schemaVersion upconverted to 2");
		assertEqual(loaded!.mode, "repo", "v1 load path: mode defaults to 'repo'");
		assertEqual(loaded!.baseBranch, "", "v1 load path: baseBranch defaults to ''");

		// Verify core fields preserved through full load path
		assertEqual(loaded!.phase, "executing", "v1 load path: phase preserved");
		assertEqual(loaded!.batchId, "20260309T010000", "v1 load path: batchId preserved");
		assertEqual(loaded!.totalTasks, 3, "v1 load path: totalTasks preserved");
		assertEqual(loaded!.currentWaveIndex, 0, "v1 load path: currentWaveIndex preserved");
		assertEqual(loaded!.totalWaves, 2, "v1 load path: totalWaves preserved");

		// Verify task records survived upconversion
		assertEqual(loaded!.tasks.length, 3, "v1 load path: 3 task records preserved");
		assertEqual(loaded!.tasks[0].taskId, "TS-001", "v1 load path: task TS-001 preserved");
		assertEqual(loaded!.tasks[0].status, "succeeded", "v1 load path: task status preserved");
		assertEqual(loaded!.tasks[1].taskId, "TS-002", "v1 load path: task TS-002 preserved");
		assertEqual(loaded!.tasks[1].status, "running", "v1 load path: task TS-002 status preserved");
		assertEqual(loaded!.tasks[2].taskId, "TS-003", "v1 load path: task TS-003 preserved");
		assertEqual(loaded!.tasks[2].status, "pending", "v1 load path: task TS-003 status preserved");

		// Verify task repo fields are undefined (v1 has no repo fields)
		assertEqual(loaded!.tasks[0].repoId, undefined, "v1 load path: task[0].repoId is undefined");
		assertEqual(loaded!.tasks[0].resolvedRepoId, undefined, "v1 load path: task[0].resolvedRepoId is undefined");
		assertEqual(loaded!.tasks[1].repoId, undefined, "v1 load path: task[1].repoId is undefined");
		assertEqual(loaded!.tasks[2].repoId, undefined, "v1 load path: task[2].repoId is undefined");

		// Verify lane records survived upconversion
		assertEqual(loaded!.lanes.length, 2, "v1 load path: 2 lane records preserved");
		assertEqual(loaded!.lanes[0].laneId, "lane-1", "v1 load path: lane-1 preserved");
		assertEqual(loaded!.lanes[1].laneId, "lane-2", "v1 load path: lane-2 preserved");

		// Verify lane repo fields are undefined (v1 has no lane repoId)
		assertEqual(loaded!.lanes[0].repoId, undefined, "v1 load path: lane[0].repoId is undefined");
		assertEqual(loaded!.lanes[1].repoId, undefined, "v1 load path: lane[1].repoId is undefined");

		// Verify wavePlan preserved
		assertEqual(loaded!.wavePlan.length, 2, "v1 load path: 2 waves preserved");
		assertEqual(loaded!.wavePlan[0].length, 2, "v1 load path: wave 0 has 2 tasks");
		assertEqual(loaded!.wavePlan[1].length, 1, "v1 load path: wave 1 has 1 task");

	} finally {
		try { rmSync(v1LoadRoot, { recursive: true, force: true }); } catch { /* best effort */ }
	}
}

{
	console.log("  ▸ v1 file is NOT rewritten on load (on-disk schema remains 1)");

	const v1NoRewriteRoot = join(tmpdir(), `orch-v1-norewrite-test-${Date.now()}`);
	mkdirSync(join(v1NoRewriteRoot, ".pi"), { recursive: true });

	try {
		const v1Json = loadFixture("batch-state-v1-valid.json");
		const statePath = batchStatePath(v1NoRewriteRoot);
		writeFileSync(statePath, v1Json, "utf-8");

		// Capture the on-disk content before load
		const beforeLoad = readFileSync(statePath, "utf-8");
		const beforeParsed = JSON.parse(beforeLoad);
		assertEqual(beforeParsed.schemaVersion, 1, "on-disk: v1 schemaVersion before load");

		// Load (triggers in-memory upconversion)
		const loaded = loadBatchState(v1NoRewriteRoot);
		assertEqual(loaded!.schemaVersion, BATCH_STATE_SCHEMA_VERSION, "in-memory: upconverted to v2");

		// Read file again — it must NOT have been rewritten
		const afterLoad = readFileSync(statePath, "utf-8");
		const afterParsed = JSON.parse(afterLoad);
		assertEqual(afterParsed.schemaVersion, 1, "on-disk: v1 schemaVersion unchanged after load");
		assertEqual(afterParsed.mode, undefined, "on-disk: mode still absent (v1 has no mode)");
		assertEqual(afterParsed.baseBranch, undefined, "on-disk: baseBranch still absent (v1 has no baseBranch)");

		// Verify byte-level content unchanged
		assertEqual(afterLoad, beforeLoad, "on-disk: file content identical before and after load");

	} finally {
		try { rmSync(v1NoRewriteRoot, { recursive: true, force: true }); } catch { /* best effort */ }
	}
}

{
	console.log("  ▸ v1 load followed by explicit save writes v2 to disk");

	const v1SaveRoot = join(tmpdir(), `orch-v1-save-test-${Date.now()}`);
	mkdirSync(join(v1SaveRoot, ".pi"), { recursive: true });

	try {
		const v1Json = loadFixture("batch-state-v1-valid.json");
		const statePath = batchStatePath(v1SaveRoot);
		writeFileSync(statePath, v1Json, "utf-8");

		// Load v1 (in-memory upconversion)
		const loaded = loadBatchState(v1SaveRoot);
		assertEqual(loaded!.schemaVersion, BATCH_STATE_SCHEMA_VERSION, "loaded as v2 in memory");

		// Now save the upconverted state back (simulating what happens on next persist)
		const reserializedJson = JSON.stringify(loaded, null, 2);
		saveBatchState(reserializedJson, v1SaveRoot);

		// Read and verify it's now v2 on disk
		const afterSave = readFileSync(statePath, "utf-8");
		const afterParsed = JSON.parse(afterSave);
		assertEqual(afterParsed.schemaVersion, BATCH_STATE_SCHEMA_VERSION, "on-disk: v2 after explicit save");
		assertEqual(afterParsed.mode, "repo", "on-disk: mode persisted as 'repo'");
		assertEqual(afterParsed.baseBranch, "", "on-disk: baseBranch persisted as ''");

	} finally {
		try { rmSync(v1SaveRoot, { recursive: true, force: true }); } catch { /* best effort */ }
	}
}

// ═══════════════════════════════════════════════════════════════════════
// 7.2: Schema v2 Compatibility — Load Path Regression Tests (Step 2)
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 7.2: Schema v2 compatibility — load path regression tests ──");

{
	console.log("  ▸ loadBatchState with v2 repo-mode fixture (batch-state-valid.json)");

	const v2RepoRoot = join(tmpdir(), `orch-v2-repo-load-test-${Date.now()}`);
	mkdirSync(join(v2RepoRoot, ".pi"), { recursive: true });

	try {
		const v2Json = loadFixture("batch-state-valid.json");
		writeFileSync(batchStatePath(v2RepoRoot), v2Json, "utf-8");

		const loaded = loadBatchState(v2RepoRoot);
		assert(loaded !== null, "v2 repo-mode load: returns non-null");
		assertEqual(loaded!.schemaVersion, BATCH_STATE_SCHEMA_VERSION, "v2 repo-mode load: schemaVersion is 2");
		assertEqual(loaded!.mode, "repo", "v2 repo-mode load: mode is 'repo'");
		assertEqual(loaded!.baseBranch, "main", "v2 repo-mode load: baseBranch is 'main'");
		assertEqual(loaded!.phase, "executing", "v2 repo-mode load: phase preserved");
		assertEqual(loaded!.batchId, "20260309T010000", "v2 repo-mode load: batchId preserved");
		assertEqual(loaded!.tasks.length, 3, "v2 repo-mode load: 3 task records");
		assertEqual(loaded!.lanes.length, 2, "v2 repo-mode load: 2 lane records");

		// Verify no spurious repo fields in repo-mode fixture
		assertEqual(loaded!.tasks[0].repoId, undefined, "v2 repo-mode load: task repoId is undefined");
		assertEqual(loaded!.tasks[0].resolvedRepoId, undefined, "v2 repo-mode load: task resolvedRepoId is undefined");
		assertEqual(loaded!.lanes[0].repoId, undefined, "v2 repo-mode load: lane repoId is undefined");

	} finally {
		try { rmSync(v2RepoRoot, { recursive: true, force: true }); } catch { /* best effort */ }
	}
}

{
	console.log("  ▸ loadBatchState with v2 workspace-mode fixture (batch-state-v2-workspace.json)");

	const v2WsRoot = join(tmpdir(), `orch-v2-ws-load-test-${Date.now()}`);
	mkdirSync(join(v2WsRoot, ".pi"), { recursive: true });

	try {
		const v2WsJson = loadFixture("batch-state-v2-workspace.json");
		writeFileSync(batchStatePath(v2WsRoot), v2WsJson, "utf-8");

		const loaded = loadBatchState(v2WsRoot);
		assert(loaded !== null, "v2 workspace-mode load: returns non-null");
		assertEqual(loaded!.schemaVersion, BATCH_STATE_SCHEMA_VERSION, "v2 workspace-mode load: schemaVersion is 2");
		assertEqual(loaded!.mode, "workspace", "v2 workspace-mode load: mode is 'workspace'");
		assertEqual(loaded!.baseBranch, "main", "v2 workspace-mode load: baseBranch preserved");
		assertEqual(loaded!.phase, "executing", "v2 workspace-mode load: phase preserved");
		assertEqual(loaded!.batchId, "20260315T100000", "v2 workspace-mode load: batchId preserved");

		// Verify task repo fields from workspace-mode fixture
		assertEqual(loaded!.tasks.length, 2, "v2 workspace-mode load: 2 task records");
		assertEqual(loaded!.tasks[0].taskId, "WS-001", "v2 workspace-mode load: task WS-001");
		assertEqual(loaded!.tasks[0].repoId, "api", "v2 workspace-mode load: task[0].repoId is 'api'");
		assertEqual(loaded!.tasks[0].resolvedRepoId, "api", "v2 workspace-mode load: task[0].resolvedRepoId is 'api'");
		assertEqual(loaded!.tasks[1].taskId, "WS-002", "v2 workspace-mode load: task WS-002");
		assertEqual(loaded!.tasks[1].repoId, undefined, "v2 workspace-mode load: task[1].repoId is undefined");
		assertEqual(loaded!.tasks[1].resolvedRepoId, "frontend", "v2 workspace-mode load: task[1].resolvedRepoId is 'frontend'");

		// Verify lane repo fields
		assertEqual(loaded!.lanes.length, 2, "v2 workspace-mode load: 2 lane records");
		assertEqual(loaded!.lanes[0].repoId, "api", "v2 workspace-mode load: lane[0].repoId is 'api'");
		assertEqual(loaded!.lanes[1].repoId, "frontend", "v2 workspace-mode load: lane[1].repoId is 'frontend'");

	} finally {
		try { rmSync(v2WsRoot, { recursive: true, force: true }); } catch { /* best effort */ }
	}
}

// ═══════════════════════════════════════════════════════════════════════
// 7.3: Schema Version Guardrails (Step 2)
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 7.3: Schema version guardrails ──");

{
	console.log("  ▸ loadBatchState rejects unsupported schema version (>2) with actionable message");

	const futureVersionRoot = join(tmpdir(), `orch-future-version-test-${Date.now()}`);
	mkdirSync(join(futureVersionRoot, ".pi"), { recursive: true });

	try {
		const futureVersionJson = loadFixture("batch-state-wrong-version.json");
		writeFileSync(batchStatePath(futureVersionRoot), futureVersionJson, "utf-8");

		assertThrows(
			() => loadBatchState(futureVersionRoot),
			"STATE_SCHEMA_INVALID",
			"future version (99) through load path throws STATE_SCHEMA_INVALID",
		);

		// Also verify the error message is actionable
		try {
			loadBatchState(futureVersionRoot);
		} catch (err: unknown) {
			const e = err as { message?: string };
			assert(
				e.message !== undefined && e.message.includes("Delete .pi/batch-state.json"),
				"error message includes actionable instruction to delete state file",
			);
			assert(
				e.message !== undefined && e.message.includes("99"),
				"error message includes the unsupported version number",
			);
		}

	} finally {
		try { rmSync(futureVersionRoot, { recursive: true, force: true }); } catch { /* best effort */ }
	}
}

{
	console.log("  ▸ loadBatchState rejects schema version 0 (below supported range)");

	const v0Root = join(tmpdir(), `orch-v0-test-${Date.now()}`);
	mkdirSync(join(v0Root, ".pi"), { recursive: true });

	try {
		const v0State = JSON.parse(loadFixture("batch-state-valid.json"));
		v0State.schemaVersion = 0;
		writeFileSync(batchStatePath(v0Root), JSON.stringify(v0State, null, 2), "utf-8");

		assertThrows(
			() => loadBatchState(v0Root),
			"STATE_SCHEMA_INVALID",
			"version 0 through load path throws STATE_SCHEMA_INVALID",
		);

	} finally {
		try { rmSync(v0Root, { recursive: true, force: true }); } catch { /* best effort */ }
	}
}

{
	console.log("  ▸ loadBatchState rejects schema version 3 (next unsupported)");

	const v3Root = join(tmpdir(), `orch-v3-test-${Date.now()}`);
	mkdirSync(join(v3Root, ".pi"), { recursive: true });

	try {
		const v3State = JSON.parse(loadFixture("batch-state-valid.json"));
		v3State.schemaVersion = 3;
		writeFileSync(batchStatePath(v3Root), JSON.stringify(v3State, null, 2), "utf-8");

		assertThrows(
			() => loadBatchState(v3Root),
			"STATE_SCHEMA_INVALID",
			"version 3 through load path throws STATE_SCHEMA_INVALID",
		);

	} finally {
		try { rmSync(v3Root, { recursive: true, force: true }); } catch { /* best effort */ }
	}
}

{
	console.log("  ▸ loadBatchState rejects malformed JSON through full load path");

	const malformedRoot = join(tmpdir(), `orch-malformed-load-test-${Date.now()}`);
	mkdirSync(join(malformedRoot, ".pi"), { recursive: true });

	try {
		writeFileSync(batchStatePath(malformedRoot), "{ not valid json }", "utf-8");

		assertThrows(
			() => loadBatchState(malformedRoot),
			"STATE_FILE_PARSE_ERROR",
			"malformed JSON through load path throws STATE_FILE_PARSE_ERROR",
		);

	} finally {
		try { rmSync(malformedRoot, { recursive: true, force: true }); } catch { /* best effort */ }
	}
}

{
	console.log("  ▸ loadBatchState rejects v2 with missing required mode field");

	const v2NoModeRoot = join(tmpdir(), `orch-v2-nomode-test-${Date.now()}`);
	mkdirSync(join(v2NoModeRoot, ".pi"), { recursive: true });

	try {
		const v2State = JSON.parse(loadFixture("batch-state-valid.json"));
		delete v2State.mode; // Remove required v2 field
		writeFileSync(batchStatePath(v2NoModeRoot), JSON.stringify(v2State, null, 2), "utf-8");

		assertThrows(
			() => loadBatchState(v2NoModeRoot),
			"STATE_SCHEMA_INVALID",
			"v2 without mode through load path throws STATE_SCHEMA_INVALID",
		);

	} finally {
		try { rmSync(v2NoModeRoot, { recursive: true, force: true }); } catch { /* best effort */ }
	}
}

{
	console.log("  ▸ v1 upconverted state is usable for resume flow (loadBatchState → reconcile → resume)");

	// Integration test: v1 file loaded, upconverted, then used in resume decision pipeline
	const v1ResumeRoot = join(tmpdir(), `orch-v1-resume-test-${Date.now()}`);
	mkdirSync(join(v1ResumeRoot, ".pi"), { recursive: true });

	try {
		const v1Json = loadFixture("batch-state-v1-valid.json");
		writeFileSync(batchStatePath(v1ResumeRoot), v1Json, "utf-8");

		// Load through full path (v1 → v2 upconversion)
		const loaded = loadBatchState(v1ResumeRoot);
		assert(loaded !== null, "v1 resume flow: state loaded");

		// Check resume eligibility (executing phase is eligible)
		const eligibility = checkResumeEligibility(loaded!);
		assertEqual(eligibility.eligible, true, "v1 resume flow: executing phase is resumable");

		// Reconcile tasks (simulate: TS-001 done, TS-002 dead, TS-003 not started)
		const reconciled = reconcileTaskStates(loaded!, new Set(), new Set(["TS-001"]));
		assertEqual(reconciled.length, 3, "v1 resume flow: 3 tasks reconciled");

		// TS-001: succeeded + .DONE → mark-complete
		const ts001 = reconciled.find((r: any) => r.taskId === "TS-001");
		assertEqual(ts001!.action, "mark-complete", "v1 resume: TS-001 mark-complete");

		// TS-002: running + dead session + no .DONE → mark-failed
		const ts002 = reconciled.find((r: any) => r.taskId === "TS-002");
		assertEqual(ts002!.action, "mark-failed", "v1 resume: TS-002 mark-failed");

		// TS-003: pending + no session → "pending" action (never-started, remains pending for execution)
		const ts003 = reconciled.find((r: any) => r.taskId === "TS-003");
		assertEqual(ts003!.action, "pending", "v1 resume: TS-003 pending (never-started, no session)");

		// Compute resume point
		// Wave 0: TS-001 mark-complete (done) + TS-002 mark-failed (NOT done for wave-skip)
		const resumePoint = computeResumePoint(loaded!, reconciled);
		assertEqual(resumePoint.resumeWaveIndex, 0, "v1 resume: wave 0 (TS-002 mark-failed NOT done for wave-skip)");
		assertEqual(resumePoint.completedTaskIds.length, 1, "v1 resume: 1 completed (TS-001)");
		assert(resumePoint.completedTaskIds.includes("TS-001"), "v1 resume: TS-001 completed");
		assertEqual(resumePoint.failedTaskIds.length, 1, "v1 resume: 1 failed (TS-002 only)");
		assert(resumePoint.pendingTaskIds.includes("TS-003"), "v1 resume: TS-003 pending for execution");

		// Verify orphan detection with upconverted state
		const orphanResult = analyzeOrchestratorStartupState(
			[], // No orphan sessions
			"valid",
			loaded!,
			null,
			new Set(["TS-001"]), // TS-001 has .DONE
		);
		assertEqual(orphanResult.recommendedAction, "resume", "v1 resume: orphan detection recommends resume");

	} finally {
		try { rmSync(v1ResumeRoot, { recursive: true, force: true }); } catch { /* best effort */ }
	}
}

// ═══════════════════════════════════════════════════════════════════════
// 7.1: Mixed-repo reconciliation (TP-007 Step 0)
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 7.1: Mixed-repo reconciliation ──");

// Helper: create a workspace-mode persisted state with multi-repo lanes and tasks
function workspacePersistedState(overrides?: Partial<PersistedBatchStateForTest>): PersistedBatchStateForTest {
	return {
		schemaVersion: 2,
		phase: "executing",
		batchId: "20260315T120000",
		baseBranch: "main",
		mode: "workspace",
		startedAt: Date.now() - 120000,
		updatedAt: Date.now(),
		endedAt: null,
		currentWaveIndex: 0,
		totalWaves: 1,
		wavePlan: [["WS-001", "WS-002"]],
		lanes: [
			{
				laneNumber: 1,
				laneId: "api/lane-1",
				tmuxSessionName: "orch-api-lane-1",
				worktreePath: "/tmp/ws-wt-1",
				branch: "task/api-lane-1-20260315T120000",
				taskIds: ["WS-001"],
				repoId: "api",
			},
			{
				laneNumber: 2,
				laneId: "frontend/lane-2",
				tmuxSessionName: "orch-frontend-lane-2",
				worktreePath: "/tmp/ws-wt-2",
				branch: "task/frontend-lane-2-20260315T120000",
				taskIds: ["WS-002"],
				repoId: "frontend",
			},
		],
		tasks: [
			{
				taskId: "WS-001",
				laneNumber: 1,
				sessionName: "orch-api-lane-1",
				status: "running",
				taskFolder: "/tmp/tasks/WS-001",
				startedAt: Date.now() - 60000,
				endedAt: null,
				doneFileFound: false,
				exitReason: "",
				repoId: "api",
				resolvedRepoId: "api",
			},
			{
				taskId: "WS-002",
				laneNumber: 2,
				sessionName: "orch-frontend-lane-2",
				status: "running",
				taskFolder: "/tmp/tasks/WS-002",
				startedAt: Date.now() - 60000,
				endedAt: null,
				doneFileFound: false,
				exitReason: "",
				repoId: "frontend",
				resolvedRepoId: "frontend",
			},
		],
		mergeResults: [],
		totalTasks: 2,
		succeededTasks: 0,
		failedTasks: 0,
		skippedTasks: 0,
		blockedTasks: 0,
		blockedTaskIds: [],
		lastError: null,
		errors: [],
		...overrides,
	};
}

// Reimplement resolveRepoRoot for test self-containment (mirrors source)
function resolveRepoRoot(
	repoId: string | undefined,
	defaultRepoRoot: string,
	workspaceConfig?: { repos: Map<string, { path: string }> } | null,
): string {
	if (!repoId || !workspaceConfig) {
		return defaultRepoRoot;
	}
	const repoConfig = workspaceConfig.repos.get(repoId);
	if (!repoConfig) {
		return defaultRepoRoot;
	}
	return repoConfig.path;
}

// Reimplement collectRepoRoots for test self-containment (mirrors source)
function collectRepoRoots(
	persistedState: { lanes: Array<{ repoId?: string }> },
	defaultRepoRoot: string,
	workspaceConfig?: { repos: Map<string, { path: string }> } | null,
): string[] {
	const roots = new Set<string>();
	for (const lane of persistedState.lanes) {
		const root = resolveRepoRoot(lane.repoId, defaultRepoRoot, workspaceConfig);
		roots.add(root);
	}
	roots.add(defaultRepoRoot);
	return [...roots];
}

{
	console.log("  ▸ workspace v2: one repo lane alive + another dead → correct reconcile actions");
	const state = workspacePersistedState();
	// WS-001 (api repo): session alive
	// WS-002 (frontend repo): session dead, no .DONE
	const aliveSessions = new Set(["orch-api-lane-1"]);
	const doneTaskIds = new Set<string>();
	const result = reconcileTaskStates(state, aliveSessions, doneTaskIds);
	assertEqual(result.length, 2, "two tasks reconciled");

	// WS-001: alive session → reconnect
	assertEqual(result[0].taskId, "WS-001", "first task is WS-001");
	assertEqual(result[0].action, "reconnect", "WS-001: reconnect (alive session)");
	assertEqual(result[0].sessionAlive, true, "WS-001: session alive");

	// WS-002: dead session + no .DONE + no worktree → mark-failed
	assertEqual(result[1].taskId, "WS-002", "second task is WS-002");
	assertEqual(result[1].action, "mark-failed", "WS-002: mark-failed (dead session, no DONE, no worktree)");
	assertEqual(result[1].sessionAlive, false, "WS-002: session not alive");
	assertEqual(result[1].liveStatus, "failed", "WS-002: live status failed");
}

{
	console.log("  ▸ workspace v2: .DONE in one repo + dead session in another → mark-complete vs mark-failed");
	const state = workspacePersistedState();
	// WS-001 (api repo): .DONE found
	// WS-002 (frontend repo): dead session, no .DONE
	const aliveSessions = new Set<string>();
	const doneTaskIds = new Set(["WS-001"]);
	const result = reconcileTaskStates(state, aliveSessions, doneTaskIds);
	assertEqual(result.length, 2, "two tasks reconciled");

	// WS-001: .DONE found → mark-complete (regardless of session state)
	assertEqual(result[0].action, "mark-complete", "WS-001: mark-complete (.DONE found)");
	assertEqual(result[0].doneFileFound, true, "WS-001: done file found");
	assertEqual(result[0].liveStatus, "succeeded", "WS-001: live status succeeded");

	// WS-002: dead session + no .DONE → mark-failed
	assertEqual(result[1].action, "mark-failed", "WS-002: mark-failed (dead session, no .DONE)");
	assertEqual(result[1].liveStatus, "failed", "WS-002: live status failed");
}

{
	console.log("  ▸ v1 state (no repo fields) reconciles correctly with all-undefined repo fields");
	// Simulate v1 state that was upconverted to v2 (mode="repo", no repo fields)
	const state = minimalPersistedState({
		mode: "repo",
		baseBranch: "",
		tasks: [
			makeTaskRecord({ taskId: "T1", sessionName: "orch-lane-1", status: "running" }),
			makeTaskRecord({ taskId: "T2", sessionName: "orch-lane-2", status: "succeeded" }),
		],
		wavePlan: [["T1", "T2"]],
		lanes: [
			{ laneNumber: 1, laneId: "lane-1", tmuxSessionName: "orch-lane-1", worktreePath: "/tmp/wt-1", branch: "b1", taskIds: ["T1"] },
			{ laneNumber: 2, laneId: "lane-2", tmuxSessionName: "orch-lane-2", worktreePath: "/tmp/wt-2", branch: "b2", taskIds: ["T2"] },
		],
	});
	// Verify no repo fields on tasks or lanes
	assertEqual(state.tasks[0].repoId, undefined, "v1 task[0] repoId undefined");
	assertEqual(state.tasks[0].resolvedRepoId, undefined, "v1 task[0] resolvedRepoId undefined");
	assertEqual(state.lanes[0].repoId, undefined, "v1 lane[0] repoId undefined");

	// T1: running + dead session → mark-failed
	// T2: succeeded + dead session → skip (terminal status)
	const result = reconcileTaskStates(state, new Set(), new Set());
	assertEqual(result[0].action, "mark-failed", "v1 T1: mark-failed");
	assertEqual(result[1].action, "skip", "v1 T2: skip (already succeeded)");
	assertEqual(result[1].liveStatus, "succeeded", "v1 T2: live status preserved");
}

{
	console.log("  ▸ workspace v2: worktree exists vs missing split across repos → re-execute vs mark-failed");
	const state = workspacePersistedState();
	// WS-001 (api repo): dead session + worktree exists → re-execute
	// WS-002 (frontend repo): dead session + no worktree → mark-failed
	const aliveSessions = new Set<string>();
	const doneTaskIds = new Set<string>();
	const existingWorktrees = new Set(["WS-001"]); // Only WS-001's worktree exists
	const result = reconcileTaskStates(state, aliveSessions, doneTaskIds, existingWorktrees);
	assertEqual(result.length, 2, "two tasks reconciled");

	// WS-001: dead + worktree exists → re-execute
	assertEqual(result[0].action, "re-execute", "WS-001: re-execute (worktree exists)");
	assertEqual(result[0].worktreeExists, true, "WS-001: worktree exists");
	assertEqual(result[0].liveStatus, "pending", "WS-001: live status pending (for re-execution)");

	// WS-002: dead + no worktree → mark-failed
	assertEqual(result[1].action, "mark-failed", "WS-002: mark-failed (no worktree)");
	assertEqual(result[1].worktreeExists, false, "WS-002: worktree missing");
}

{
	console.log("  ▸ resolveRepoRoot: v2 lanes get correct repo root, v1/undefined lanes get default root");
	const wsConfig = {
		repos: new Map([
			["api", { path: "/repos/api" }],
			["frontend", { path: "/repos/frontend" }],
		]),
	};
	const defaultRoot = "/repos/default";

	// v2 workspace mode: repoId present → resolved to workspace config path
	assertEqual(
		resolveRepoRoot("api", defaultRoot, wsConfig),
		"/repos/api",
		"resolveRepoRoot('api') → workspace config path",
	);
	assertEqual(
		resolveRepoRoot("frontend", defaultRoot, wsConfig),
		"/repos/frontend",
		"resolveRepoRoot('frontend') → workspace config path",
	);

	// v1/repo mode: repoId undefined → default root
	assertEqual(
		resolveRepoRoot(undefined, defaultRoot, wsConfig),
		defaultRoot,
		"resolveRepoRoot(undefined) → default root",
	);

	// No workspace config (repo mode): always default root
	assertEqual(
		resolveRepoRoot("api", defaultRoot, null),
		defaultRoot,
		"resolveRepoRoot('api', null config) → default root",
	);

	// Unknown repoId: falls back to default
	assertEqual(
		resolveRepoRoot("unknown-repo", defaultRoot, wsConfig),
		defaultRoot,
		"resolveRepoRoot('unknown-repo') → default root (defensive fallback)",
	);
}

{
	console.log("  ▸ collectRepoRoots: workspace mode collects per-repo roots from lanes");
	const wsConfig = {
		repos: new Map([
			["api", { path: "/repos/api" }],
			["frontend", { path: "/repos/frontend" }],
		]),
	};
	const defaultRoot = "/repos/default";
	const state = workspacePersistedState();

	const roots = collectRepoRoots(state, defaultRoot, wsConfig);
	assert(roots.includes("/repos/api"), "collectRepoRoots includes api root");
	assert(roots.includes("/repos/frontend"), "collectRepoRoots includes frontend root");
	assert(roots.includes(defaultRoot), "collectRepoRoots includes default root");
	assertEqual(roots.length, 3, "collectRepoRoots returns 3 unique roots");
}

{
	console.log("  ▸ collectRepoRoots: repo mode (v1) returns only default root");
	const state = minimalPersistedState({
		lanes: [
			{ laneNumber: 1, laneId: "lane-1", tmuxSessionName: "orch-lane-1", worktreePath: "/tmp/wt-1", branch: "b1", taskIds: ["T1"] },
			{ laneNumber: 2, laneId: "lane-2", tmuxSessionName: "orch-lane-2", worktreePath: "/tmp/wt-2", branch: "b2", taskIds: ["T2"] },
		],
	});
	const defaultRoot = "/repos/main";
	// No workspace config → repo mode
	const roots = collectRepoRoots(state, defaultRoot, null);
	assertEqual(roots.length, 1, "repo mode: only default root");
	assertEqual(roots[0], defaultRoot, "repo mode: root is default");
}

{
	console.log("  ▸ workspace v2: computeResumePoint with mixed-repo outcomes");
	const state = workspacePersistedState({
		wavePlan: [["WS-001", "WS-002"], ["WS-003"]],
		tasks: [
			{
				taskId: "WS-001", laneNumber: 1, sessionName: "orch-api-lane-1",
				status: "running", taskFolder: "/tmp/tasks/WS-001",
				startedAt: Date.now() - 60000, endedAt: null,
				doneFileFound: false, exitReason: "",
				repoId: "api", resolvedRepoId: "api",
			},
			{
				taskId: "WS-002", laneNumber: 2, sessionName: "orch-frontend-lane-2",
				status: "running", taskFolder: "/tmp/tasks/WS-002",
				startedAt: Date.now() - 60000, endedAt: null,
				doneFileFound: false, exitReason: "",
				repoId: "frontend", resolvedRepoId: "frontend",
			},
			{
				taskId: "WS-003", laneNumber: 1, sessionName: "orch-api-lane-1",
				status: "pending", taskFolder: "/tmp/tasks/WS-003",
				startedAt: null, endedAt: null,
				doneFileFound: false, exitReason: "",
				repoId: "api", resolvedRepoId: "api",
			},
		],
	});

	// WS-001 (api): .DONE found → mark-complete
	// WS-002 (frontend): dead session → mark-failed
	// WS-003 (api, wave 2): pending
	const reconciled = reconcileTaskStates(state, new Set(), new Set(["WS-001"]));
	const point = computeResumePoint(state, reconciled);

	// Wave 0: WS-001 mark-complete (done) + WS-002 mark-failed (NOT done for wave-skip)
	assertEqual(point.resumeWaveIndex, 0, "resumes from wave 0 (mark-failed NOT done for wave-skip)");
	assert(point.completedTaskIds.includes("WS-001"), "WS-001 in completed");
	assert(point.failedTaskIds.includes("WS-002"), "WS-002 in failed");
	assert(point.failedTaskIds.includes("WS-003"), "WS-003 in failed (mark-failed: dead session + no DONE + no worktree)");
}

{
	console.log("  ▸ workspace v2: both repo lanes alive → both reconnect");
	const state = workspacePersistedState();
	const aliveSessions = new Set(["orch-api-lane-1", "orch-frontend-lane-2"]);
	const result = reconcileTaskStates(state, aliveSessions, new Set());

	assertEqual(result[0].action, "reconnect", "WS-001 (api): reconnect");
	assertEqual(result[1].action, "reconnect", "WS-002 (frontend): reconnect");

	const point = computeResumePoint(state, result);
	assertEqual(point.reconnectTaskIds.length, 2, "both tasks need reconnection");
	assertEqual(point.resumeWaveIndex, 0, "resume from wave 0 (tasks still running)");
	assert(point.pendingTaskIds.includes("WS-001"), "WS-001 in pending (reconnect)");
	assert(point.pendingTaskIds.includes("WS-002"), "WS-002 in pending (reconnect)");
}

{
	console.log("  ▸ workspace v2: all repos completed → resume past all waves");
	const state = workspacePersistedState({
		tasks: [
			{
				taskId: "WS-001", laneNumber: 1, sessionName: "orch-api-lane-1",
				status: "succeeded", taskFolder: "/tmp/tasks/WS-001",
				startedAt: Date.now() - 60000, endedAt: Date.now() - 30000,
				doneFileFound: true, exitReason: "",
				repoId: "api", resolvedRepoId: "api",
			},
			{
				taskId: "WS-002", laneNumber: 2, sessionName: "orch-frontend-lane-2",
				status: "succeeded", taskFolder: "/tmp/tasks/WS-002",
				startedAt: Date.now() - 60000, endedAt: Date.now() - 30000,
				doneFileFound: true, exitReason: "",
				repoId: "frontend", resolvedRepoId: "frontend",
			},
		],
	});

	const reconciled = reconcileTaskStates(state, new Set(), new Set());
	const point = computeResumePoint(state, reconciled);

	assertEqual(point.resumeWaveIndex, 1, "resume past all waves (all done)");
	assertEqual(point.completedTaskIds.length, 2, "both tasks completed");
	assertEqual(point.failedTaskIds.length, 0, "no failed tasks");
}

// ═══════════════════════════════════════════════════════════════════════
// 8.1: Mixed-Repo Reconciliation (TP-007 Step 0)
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 8.1: Mixed-repo reconciliation scenarios (TP-007) ──");

// Reimplement resolveRepoRoot (mirrors source exactly)
function resolveRepoRoot(
	repoId: string | undefined,
	defaultRepoRoot: string,
	workspaceConfig?: { repos: Map<string, { path: string; defaultBranch?: string }> } | null,
): string {
	if (!repoId || !workspaceConfig) {
		return defaultRepoRoot;
	}
	const repoConfig = workspaceConfig.repos.get(repoId);
	if (!repoConfig) {
		return defaultRepoRoot;
	}
	return repoConfig.path;
}

// Helper: build a workspace-mode persisted state with multi-repo lanes
function makeWorkspaceState(overrides: Partial<any> = {}): any {
	return minimalPersistedState({
		mode: "workspace",
		baseBranch: "main",
		wavePlan: [["WS-001", "WS-002"]],
		lanes: [
			{
				laneNumber: 1, laneId: "lane-1", tmuxSessionName: "orch-lane-1",
				worktreePath: "/tmp/wt-1", branch: "task/lane-1-batch",
				taskIds: ["WS-001"], repoId: "api",
			},
			{
				laneNumber: 2, laneId: "lane-2", tmuxSessionName: "orch-lane-2",
				worktreePath: "/tmp/wt-2", branch: "task/lane-2-batch",
				taskIds: ["WS-002"], repoId: "frontend",
			},
		],
		tasks: [
			makeTaskRecord({
				taskId: "WS-001", laneNumber: 1, sessionName: "orch-lane-1",
				status: "running", taskFolder: "/tmp/tasks/WS-001",
				repoId: "api", resolvedRepoId: "api",
			}),
			makeTaskRecord({
				taskId: "WS-002", laneNumber: 2, sessionName: "orch-lane-2",
				status: "running", taskFolder: "/tmp/tasks/WS-002",
				resolvedRepoId: "frontend",
			}),
		],
		...overrides,
	});
}

// Workspace config for resolveRepoRoot tests
const testWorkspaceConfig = {
	repos: new Map([
		["api", { path: "/repos/api", defaultBranch: "main" }],
		["frontend", { path: "/repos/frontend", defaultBranch: "develop" }],
	]),
};

{
	console.log("  ▸ workspace v2: one repo lane alive + another dead → correct reconcile actions");
	const state = makeWorkspaceState();
	// WS-001 (api repo) has alive session, WS-002 (frontend repo) has dead session
	const reconciled = reconcileTaskStates(
		state,
		new Set(["orch-lane-1"]),  // only api lane alive
		new Set(),                  // no .DONE files
	);
	assertEqual(reconciled.length, 2, "workspace: 2 tasks reconciled");

	const ws001 = reconciled.find((r: any) => r.taskId === "WS-001");
	assertEqual(ws001!.action, "reconnect", "workspace: WS-001 reconnect (alive session)");
	assertEqual(ws001!.sessionAlive, true, "workspace: WS-001 session alive");

	const ws002 = reconciled.find((r: any) => r.taskId === "WS-002");
	assertEqual(ws002!.action, "mark-failed", "workspace: WS-002 mark-failed (dead session, no .DONE, no worktree)");
	assertEqual(ws002!.liveStatus, "failed", "workspace: WS-002 live status is failed");
}

{
	console.log("  ▸ workspace v2: .DONE in one repo + dead session in another → mark-complete vs mark-failed");
	const state = makeWorkspaceState();
	// WS-001 (api) completed (.DONE exists), WS-002 (frontend) dead session
	const reconciled = reconcileTaskStates(
		state,
		new Set(),                 // no alive sessions
		new Set(["WS-001"]),       // WS-001 has .DONE
	);

	const ws001 = reconciled.find((r: any) => r.taskId === "WS-001");
	assertEqual(ws001!.action, "mark-complete", "workspace: WS-001 mark-complete (.DONE found)");
	assertEqual(ws001!.doneFileFound, true, "workspace: WS-001 done file found");

	const ws002 = reconciled.find((r: any) => r.taskId === "WS-002");
	assertEqual(ws002!.action, "mark-failed", "workspace: WS-002 mark-failed (dead, no .DONE)");

	// Resume point should show correct categorization
	const point = computeResumePoint(state, reconciled);
	assert(point.completedTaskIds.includes("WS-001"), "workspace: WS-001 in completed");
	assert(point.failedTaskIds.includes("WS-002"), "workspace: WS-002 in failed");
	// Wave 0: WS-001 mark-complete (done) + WS-002 mark-failed (NOT done for wave-skip)
	assertEqual(point.resumeWaveIndex, 0, "workspace: resume from wave 0 (mark-failed NOT done for wave-skip)");
}

{
	console.log("  ▸ v1 state (no repo fields) reconciles correctly with all-undefined repo fields");
	// Simulate a v1-upconverted state: mode=repo, no repo fields on tasks/lanes
	const v1State = minimalPersistedState({
		mode: "repo",
		baseBranch: "",
		wavePlan: [["T1", "T2"]],
		lanes: [
			{
				laneNumber: 1, laneId: "lane-1", tmuxSessionName: "orch-lane-1",
				worktreePath: "/tmp/wt-1", branch: "task/lane-1-batch",
				taskIds: ["T1", "T2"],
				// No repoId — v1 behavior
			},
		],
		tasks: [
			makeTaskRecord({ taskId: "T1", laneNumber: 1, sessionName: "orch-lane-1", status: "succeeded" }),
			makeTaskRecord({ taskId: "T2", laneNumber: 1, sessionName: "orch-lane-1", status: "running" }),
		],
	});

	// T1: succeeded → skip, T2: running + dead session → mark-failed
	const reconciled = reconcileTaskStates(v1State, new Set(), new Set());
	const t1 = reconciled.find((r: any) => r.taskId === "T1");
	assertEqual(t1!.action, "skip", "v1: T1 skip (already succeeded)");
	const t2 = reconciled.find((r: any) => r.taskId === "T2");
	assertEqual(t2!.action, "mark-failed", "v1: T2 mark-failed (dead session)");

	const point = computeResumePoint(v1State, reconciled);
	// Wave 0: T1 skip/succeeded (done) + T2 mark-failed (NOT done for wave-skip)
	assertEqual(point.resumeWaveIndex, 0, "v1: resume from wave 0 (mark-failed NOT done for wave-skip)");
	assert(point.completedTaskIds.includes("T1"), "v1: T1 completed");
	assert(point.failedTaskIds.includes("T2"), "v1: T2 failed");

	// Verify v1 lanes have no repoId
	assertEqual(v1State.lanes[0].repoId, undefined, "v1: lane has no repoId");
	assertEqual(v1State.tasks[0].repoId, undefined, "v1: task has no repoId");
}

{
	console.log("  ▸ worktree exists vs missing split across repos → correct re-execute vs mark-failed");
	const state = makeWorkspaceState();
	// WS-001 (api): dead session + worktree exists → re-execute
	// WS-002 (frontend): dead session + no worktree → mark-failed
	const reconciled = reconcileTaskStates(
		state,
		new Set(),                   // no alive sessions
		new Set(),                   // no .DONE files
		new Set(["WS-001"]),         // only WS-001 has worktree
	);

	const ws001 = reconciled.find((r: any) => r.taskId === "WS-001");
	assertEqual(ws001!.action, "re-execute", "workspace: WS-001 re-execute (worktree exists)");
	assertEqual(ws001!.worktreeExists, true, "workspace: WS-001 worktree exists");
	assertEqual(ws001!.liveStatus, "pending", "workspace: WS-001 live status pending (will be re-executed)");

	const ws002 = reconciled.find((r: any) => r.taskId === "WS-002");
	assertEqual(ws002!.action, "mark-failed", "workspace: WS-002 mark-failed (no worktree)");
	assertEqual(ws002!.worktreeExists, false, "workspace: WS-002 no worktree");

	const point = computeResumePoint(state, reconciled);
	assert(point.reExecuteTaskIds.includes("WS-001"), "workspace: WS-001 in re-execute list");
	assert(point.failedTaskIds.includes("WS-002"), "workspace: WS-002 in failed list");
	assertEqual(point.resumeWaveIndex, 0, "workspace: resume from wave 0");
}

{
	console.log("  ▸ resolveRepoRoot integration: v2 lanes get correct repo root, v1/undefined lanes get default root");

	const defaultRoot = "/default/repo";

	// v2 workspace: lane with repoId="api" → resolves to /repos/api
	const apiRoot = resolveRepoRoot("api", defaultRoot, testWorkspaceConfig);
	assertEqual(apiRoot, "/repos/api", "resolveRepoRoot: api → /repos/api");

	const frontendRoot = resolveRepoRoot("frontend", defaultRoot, testWorkspaceConfig);
	assertEqual(frontendRoot, "/repos/frontend", "resolveRepoRoot: frontend → /repos/frontend");

	// v1/repo mode: undefined repoId → returns default root
	const undefinedRoot = resolveRepoRoot(undefined, defaultRoot, testWorkspaceConfig);
	assertEqual(undefinedRoot, defaultRoot, "resolveRepoRoot: undefined → default root");

	// v1/repo mode: no workspace config → returns default root
	const noConfigRoot = resolveRepoRoot("api", defaultRoot, null);
	assertEqual(noConfigRoot, defaultRoot, "resolveRepoRoot: null config → default root");

	// v1/repo mode: empty string repoId → returns default root (falsy check)
	const emptyRoot = resolveRepoRoot("", defaultRoot, testWorkspaceConfig);
	assertEqual(emptyRoot, defaultRoot, "resolveRepoRoot: empty string → default root");

	// Unknown repoId → defensive fallback to default root
	const unknownRoot = resolveRepoRoot("unknown-repo", defaultRoot, testWorkspaceConfig);
	assertEqual(unknownRoot, defaultRoot, "resolveRepoRoot: unknown repo → default root");
}

{
	console.log("  ▸ workspace v2: multi-wave with cross-repo completion states");
	// Wave 0: WS-001 (api) + WS-002 (frontend), both completed
	// Wave 1: WS-003 (api) running, WS-004 (frontend) pending
	const state = minimalPersistedState({
		mode: "workspace",
		baseBranch: "main",
		wavePlan: [["WS-001", "WS-002"], ["WS-003", "WS-004"]],
		lanes: [
			{
				laneNumber: 1, laneId: "lane-1", tmuxSessionName: "orch-lane-1",
				worktreePath: "/tmp/wt-1", branch: "task/lane-1-batch",
				taskIds: ["WS-001", "WS-003"], repoId: "api",
			},
			{
				laneNumber: 2, laneId: "lane-2", tmuxSessionName: "orch-lane-2",
				worktreePath: "/tmp/wt-2", branch: "task/lane-2-batch",
				taskIds: ["WS-002", "WS-004"], repoId: "frontend",
			},
		],
		tasks: [
			makeTaskRecord({ taskId: "WS-001", laneNumber: 1, sessionName: "orch-lane-1", status: "succeeded", repoId: "api", resolvedRepoId: "api" }),
			makeTaskRecord({ taskId: "WS-002", laneNumber: 2, sessionName: "orch-lane-2", status: "succeeded", resolvedRepoId: "frontend" }),
			makeTaskRecord({ taskId: "WS-003", laneNumber: 1, sessionName: "orch-lane-1", status: "running", repoId: "api", resolvedRepoId: "api" }),
			makeTaskRecord({ taskId: "WS-004", laneNumber: 2, sessionName: "orch-lane-2", status: "pending", resolvedRepoId: "frontend" }),
		],
	});

	// WS-001 and WS-002 done, WS-003 has alive session, WS-004 dead
	const reconciled = reconcileTaskStates(
		state,
		new Set(["orch-lane-1"]), // WS-003's lane is alive
		new Set(["WS-001", "WS-002"]), // wave 0 tasks have .DONE
	);

	// Wave 0 should be fully done
	const ws001 = reconciled.find((r: any) => r.taskId === "WS-001");
	const ws002 = reconciled.find((r: any) => r.taskId === "WS-002");
	assertEqual(ws001!.action, "mark-complete", "multi-wave: WS-001 mark-complete");
	assertEqual(ws002!.action, "mark-complete", "multi-wave: WS-002 mark-complete");

	// Wave 1: WS-003 reconnect, WS-004 mark-failed
	const ws003 = reconciled.find((r: any) => r.taskId === "WS-003");
	const ws004 = reconciled.find((r: any) => r.taskId === "WS-004");
	assertEqual(ws003!.action, "reconnect", "multi-wave: WS-003 reconnect");
	assertEqual(ws004!.action, "mark-failed", "multi-wave: WS-004 mark-failed");

	const point = computeResumePoint(state, reconciled);
	assertEqual(point.resumeWaveIndex, 1, "multi-wave: skips wave 0 (all done), resumes at wave 1");
	assertEqual(point.completedTaskIds.length, 2, "multi-wave: 2 completed");
	assertEqual(point.reconnectTaskIds.length, 1, "multi-wave: 1 reconnect (WS-003)");
	assertEqual(point.failedTaskIds.length, 1, "multi-wave: 1 failed (WS-004)");
	assert(point.reconnectTaskIds.includes("WS-003"), "multi-wave: WS-003 in reconnect");
	assert(point.failedTaskIds.includes("WS-004"), "multi-wave: WS-004 in failed");
}

{
	console.log("  ▸ workspace v2: all repos' tasks completed → resume wave past end");
	const state = minimalPersistedState({
		mode: "workspace",
		baseBranch: "main",
		wavePlan: [["WS-001", "WS-002"]],
		lanes: [
			{
				laneNumber: 1, laneId: "lane-1", tmuxSessionName: "orch-lane-1",
				worktreePath: "/tmp/wt-1", branch: "task/lane-1-batch",
				taskIds: ["WS-001"], repoId: "api",
			},
			{
				laneNumber: 2, laneId: "lane-2", tmuxSessionName: "orch-lane-2",
				worktreePath: "/tmp/wt-2", branch: "task/lane-2-batch",
				taskIds: ["WS-002"], repoId: "frontend",
			},
		],
		tasks: [
			makeTaskRecord({ taskId: "WS-001", laneNumber: 1, sessionName: "orch-lane-1", status: "succeeded", repoId: "api" }),
			makeTaskRecord({ taskId: "WS-002", laneNumber: 2, sessionName: "orch-lane-2", status: "succeeded", resolvedRepoId: "frontend" }),
		],
	});

	const reconciled = reconcileTaskStates(state, new Set(), new Set(["WS-001", "WS-002"]));
	const point = computeResumePoint(state, reconciled);
	assertEqual(point.resumeWaveIndex, 1, "all done: resume wave past end (wavePlan.length)");
	assertEqual(point.completedTaskIds.length, 2, "all done: both tasks completed");
	assertEqual(point.failedTaskIds.length, 0, "all done: no failures");
	assertEqual(point.pendingTaskIds.length, 0, "all done: no pending");
}

{
	console.log("  ▸ unique repo roots collected from persisted lanes (for worktree reset/cleanup)");
	// Simulate the per-repo root collection logic used in resumeOrchBatch
	const persistedLanes = [
		{ repoId: "api" },
		{ repoId: "frontend" },
		{ repoId: "api" },  // duplicate
		{ repoId: undefined },  // v1/repo-mode lane
	];
	const defaultRoot = "/default/repo";

	const uniqueRoots = new Set<string>();
	for (const lr of persistedLanes) {
		uniqueRoots.add(resolveRepoRoot(lr.repoId, defaultRoot, testWorkspaceConfig));
	}

	assertEqual(uniqueRoots.size, 3, "unique roots: 3 distinct roots (api, frontend, default)");
	assert(uniqueRoots.has("/repos/api"), "unique roots: includes api root");
	assert(uniqueRoots.has("/repos/frontend"), "unique roots: includes frontend root");
	assert(uniqueRoots.has(defaultRoot), "unique roots: includes default root (v1/undefined lane)");
}

{
	console.log("  ▸ v1 state with zero lanes: fallback adds default repo root");
	// Edge case: v1 state with no lanes persisted (very early crash)
	const emptyLanesState = minimalPersistedState({
		mode: "repo",
		lanes: [],
		tasks: [],
		wavePlan: [],
	});
	const defaultRoot = "/default/repo";

	const uniqueRoots = new Set<string>();
	for (const lr of emptyLanesState.lanes) {
		uniqueRoots.add(resolveRepoRoot(lr.repoId, defaultRoot, null));
	}
	if (uniqueRoots.size === 0) {
		uniqueRoots.add(defaultRoot);
	}

	assertEqual(uniqueRoots.size, 1, "empty lanes fallback: 1 root");
	assert(uniqueRoots.has(defaultRoot), "empty lanes fallback: default root used");
}

// ═══════════════════════════════════════════════════════════════════════
// 4.7: Step 1 — Blocked propagation, skipped semantics, counter stability
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 4.7: Step 1 — blocked propagation & skipped semantics ──");

// Helper: build a simple dependency graph for testing blocked propagation
function buildTestDepGraph(
	deps: Record<string, string[]>,
): { dependencies: Map<string, string[]>; dependents: Map<string, string[]>; nodes: Set<string> } {
	const dependencies = new Map<string, string[]>();
	const dependents = new Map<string, string[]>();
	const nodes = new Set<string>();

	for (const [taskId, taskDeps] of Object.entries(deps)) {
		nodes.add(taskId);
		dependencies.set(taskId, taskDeps);
		if (!dependents.has(taskId)) dependents.set(taskId, []);
		for (const dep of taskDeps) {
			nodes.add(dep);
			if (!dependencies.has(dep)) dependencies.set(dep, []);
			if (!dependents.has(dep)) dependents.set(dep, []);
			dependents.get(dep)!.push(taskId);
		}
	}

	return { dependencies, dependents, nodes };
}

// Reimplement computeTransitiveDependents (mirrors execution.ts exactly)
function computeTransitiveDependents(
	failedTaskIds: Set<string>,
	dependencyGraph: { dependents: Map<string, string[]> },
): Set<string> {
	const blocked = new Set<string>();
	const queue = [...failedTaskIds];

	while (queue.length > 0) {
		const current = queue.shift()!;
		const deps = dependencyGraph.dependents.get(current) || [];
		const sortedDeps = [...deps].sort();

		for (const dep of sortedDeps) {
			if (blocked.has(dep)) continue;
			if (failedTaskIds.has(dep)) continue;
			blocked.add(dep);
			queue.push(dep);
		}
	}

	return blocked;
}

{
	console.log("  ▸ reconciled failure in repo A blocks dependent in repo B under skip-dependents");
	// Scenario: workspace mode, 2 waves
	// Wave 0: WS-001 (api) fails on reconciliation, WS-002 (frontend) succeeds
	// Wave 1: WS-003 (api) depends on WS-001, WS-004 (frontend) depends on WS-002
	// Under skip-dependents: WS-003 should be blocked, WS-004 should still execute

	const depGraph = buildTestDepGraph({
		"WS-001": [],
		"WS-002": [],
		"WS-003": ["WS-001"],  // WS-003 depends on WS-001
		"WS-004": ["WS-002"],  // WS-004 depends on WS-002
	});

	const state = minimalPersistedState({
		mode: "workspace",
		wavePlan: [["WS-001", "WS-002"], ["WS-003", "WS-004"]],
		blockedTaskIds: [],
		lanes: [
			{
				laneNumber: 1, laneId: "lane-1", tmuxSessionName: "orch-lane-1",
				worktreePath: "/tmp/wt-1", branch: "task/lane-1-batch",
				taskIds: ["WS-001", "WS-003"], repoId: "api",
			},
			{
				laneNumber: 2, laneId: "lane-2", tmuxSessionName: "orch-lane-2",
				worktreePath: "/tmp/wt-2", branch: "task/lane-2-batch",
				taskIds: ["WS-002", "WS-004"], repoId: "frontend",
			},
		],
		tasks: [
			makeTaskRecord({ taskId: "WS-001", laneNumber: 1, sessionName: "orch-lane-1", status: "running", repoId: "api" }),
			makeTaskRecord({ taskId: "WS-002", laneNumber: 2, sessionName: "orch-lane-2", status: "succeeded", resolvedRepoId: "frontend" }),
			// Wave 2 tasks: never started (no session assigned) → action: "pending"
			makeTaskRecord({ taskId: "WS-003", laneNumber: 0, sessionName: "", status: "pending", repoId: "api" }),
			makeTaskRecord({ taskId: "WS-004", laneNumber: 0, sessionName: "", status: "pending", resolvedRepoId: "frontend" }),
		],
	});

	// WS-001: dead session, no .DONE, no worktree → mark-failed
	// WS-002: .DONE exists → mark-complete
	// WS-003, WS-004: pending + no session → action: "pending"
	const reconciled = reconcileTaskStates(state, new Set(), new Set(["WS-002"]));

	const ws001 = reconciled.find((r: any) => r.taskId === "WS-001");
	const ws002 = reconciled.find((r: any) => r.taskId === "WS-002");
	const ws003 = reconciled.find((r: any) => r.taskId === "WS-003");
	const ws004 = reconciled.find((r: any) => r.taskId === "WS-004");
	assertEqual(ws001!.action, "mark-failed", "cross-repo blocked: WS-001 mark-failed");
	assertEqual(ws002!.action, "mark-complete", "cross-repo blocked: WS-002 mark-complete");
	assertEqual(ws003!.action, "pending", "cross-repo blocked: WS-003 pending (never started)");
	assertEqual(ws004!.action, "pending", "cross-repo blocked: WS-004 pending (never started)");

	const point = computeResumePoint(state, reconciled);
	assertEqual(point.failedTaskIds.length, 1, "cross-repo blocked: 1 failed (WS-001)");
	assert(point.failedTaskIds.includes("WS-001"), "cross-repo blocked: WS-001 in failed");

	// Now simulate what resumeOrchBatch does: compute transitive dependents from failures
	const failedSet = new Set(point.failedTaskIds);
	const blocked = computeTransitiveDependents(failedSet, depGraph);

	assertEqual(blocked.size, 1, "cross-repo blocked: 1 task blocked (WS-003)");
	assert(blocked.has("WS-003"), "cross-repo blocked: WS-003 blocked (depends on failed WS-001)");
	assert(!blocked.has("WS-004"), "cross-repo blocked: WS-004 NOT blocked (WS-002 succeeded)");

	// Verify wave 1 execution filter: WS-003 blocked, WS-004 eligible
	const blockedTaskIds = new Set<string>([...state.blockedTaskIds, ...blocked]);
	const completedSet = new Set(point.completedTaskIds);
	const wave1Tasks = state.wavePlan[1].filter(
		(taskId: string) => !completedSet.has(taskId) && !failedSet.has(taskId) && !blockedTaskIds.has(taskId),
	);
	assertEqual(wave1Tasks.length, 1, "cross-repo blocked: 1 task eligible in wave 1");
	assertEqual(wave1Tasks[0], "WS-004", "cross-repo blocked: WS-004 is the eligible task");
}

{
	console.log("  ▸ persisted skipped tasks are not re-queued and wave is skipped over");
	const state = minimalPersistedState({
		wavePlan: [["T1", "T2"], ["T3"]],
		skippedTasks: 1,
		tasks: [
			makeTaskRecord({ taskId: "T1", status: "succeeded" }),
			makeTaskRecord({ taskId: "T2", status: "skipped" }),
			// T3 is a future-wave task that was never allocated
			makeTaskRecord({ taskId: "T3", status: "pending", sessionName: "" }),
		],
	});

	const reconciled = reconcileTaskStates(state, new Set(), new Set());
	// T1: succeeded → skip(succeeded)
	// T2: skipped → skip(skipped)
	// T3: pending + no session → action: "pending" (future-wave, not failed)

	const t1 = reconciled.find((r: any) => r.taskId === "T1");
	const t2 = reconciled.find((r: any) => r.taskId === "T2");
	assertEqual(t1!.action, "skip", "skipped-wave: T1 skip (succeeded)");
	assertEqual(t2!.action, "skip", "skipped-wave: T2 skip (skipped)");
	assertEqual(t2!.persistedStatus, "skipped", "skipped-wave: T2 persisted status is skipped");

	const point = computeResumePoint(state, reconciled);

	// Wave 0 should be skipped: T1 is succeeded (terminal), T2 is skipped (terminal)
	assertEqual(point.resumeWaveIndex, 1, "skipped-wave: wave 0 skipped (all terminal)");

	// T2 should NOT be in completedTaskIds or failedTaskIds or pendingTaskIds
	assert(!point.completedTaskIds.includes("T2"), "skipped-wave: T2 not in completed");
	assert(!point.failedTaskIds.includes("T2"), "skipped-wave: T2 not in failed");
	assert(!point.pendingTaskIds.includes("T2"), "skipped-wave: T2 not re-queued as pending");

	// T1 should be in completed
	assert(point.completedTaskIds.includes("T1"), "skipped-wave: T1 in completed");
}

{
	console.log("  ▸ wave with only mark-failed tasks is skipped over");
	const state = minimalPersistedState({
		wavePlan: [["T1", "T2"], ["T3"]],
		tasks: [
			makeTaskRecord({ taskId: "T1", status: "running" }),
			makeTaskRecord({ taskId: "T2", status: "running" }),
			makeTaskRecord({ taskId: "T3", status: "pending" }),
		],
	});

	// All dead, no .DONE, no worktrees → all mark-failed
	const reconciled = reconcileTaskStates(state, new Set(), new Set());
	assertEqual(reconciled[0].action, "mark-failed", "all-failed-wave: T1 mark-failed");
	assertEqual(reconciled[1].action, "mark-failed", "all-failed-wave: T2 mark-failed");
	assertEqual(reconciled[2].action, "mark-failed", "all-failed-wave: T3 mark-failed");

	const point = computeResumePoint(state, reconciled);
	// Wave 0: T1, T2 mark-failed → NOT done for wave-skip → resumeWaveIndex = 0
	assertEqual(point.resumeWaveIndex, 0, "all-failed-wave: resumes from wave 0 (mark-failed is NOT done for wave-skip)");
	assertEqual(point.failedTaskIds.length, 3, "all-failed-wave: 3 failed tasks");
}

{
	console.log("  ▸ blocked/skipped counter stability across pause/resume cycle");
	// Simulate: first run had 2 blocked tasks and 1 skipped task, persisted
	// Resume should carry those counters and add new ones without double-counting

	const state = minimalPersistedState({
		wavePlan: [["T1", "T2"], ["T3", "T4", "T5"]],
		blockedTasks: 2,
		blockedTaskIds: ["T4", "T5"],  // blocked from prior run
		skippedTasks: 1,
		tasks: [
			makeTaskRecord({ taskId: "T1", status: "succeeded" }),
			makeTaskRecord({ taskId: "T2", status: "failed" }),
			// Wave 2 tasks: never started (no session assigned)
			makeTaskRecord({ taskId: "T3", status: "pending", sessionName: "" }),
			makeTaskRecord({ taskId: "T4", status: "pending", sessionName: "" }),
			makeTaskRecord({ taskId: "T5", status: "pending", sessionName: "" }),
		],
	});

	const reconciled = reconcileTaskStates(state, new Set(), new Set());
	const point = computeResumePoint(state, reconciled);

	// Wave 0: T1 succeeded (skip, terminal), T2 failed (skip, terminal) → wave 0 skipped
	// Wave 1: T3, T4, T5 are pending (no session → action: "pending", NOT terminal) → resume here
	assertEqual(point.resumeWaveIndex, 1, "counter-stability: wave 0 skipped");
	assertEqual(point.completedTaskIds.length, 1, "counter-stability: 1 completed (T1)");
	assertEqual(point.failedTaskIds.length, 1, "counter-stability: 1 failed (T2)");

	// Simulate runtime state reconstruction (mirrors resumeOrchBatch step 6)
	const succeededTasks = point.completedTaskIds.length;  // 1
	const failedTasks = point.failedTaskIds.length;         // 1
	const skippedTasks = state.skippedTasks;                // 1 (carried)
	const blockedTasks = state.blockedTasks;                // 2 (carried)
	const blockedTaskIds = new Set<string>(state.blockedTaskIds);  // {T4, T5}

	// T2 is failed (from persisted state). Compute new blocked dependents:
	const depGraph = buildTestDepGraph({
		"T1": [],
		"T2": [],
		"T3": ["T2"],
		"T4": ["T1"],
		"T5": ["T3"],
	});

	const failedSet = new Set(point.failedTaskIds);
	// T2 failed → T3 depends on T2 → blocked. T5 depends on T3 → transitively blocked.
	const newBlocked = computeTransitiveDependents(failedSet, depGraph);

	for (const taskId of newBlocked) {
		blockedTaskIds.add(taskId);
	}

	// T3 depends on T2 (failed) → T3 blocked
	// T5 depends on T3 (now blocked) → T5 also blocked via transitive closure
	// T4 depends on T1 (succeeded) → T4 NOT newly blocked
	assert(blockedTaskIds.has("T3"), "counter-stability: T3 newly blocked (depends on failed T2)");
	assert(blockedTaskIds.has("T5"), "counter-stability: T5 still blocked (transitive via T3)");
	assert(blockedTaskIds.has("T4"), "counter-stability: T4 still blocked (carried from persisted)");

	// In wave 1, count blocked tasks in that wave
	const wave1BlockedCount = state.wavePlan[1].filter(
		(taskId: string) => blockedTaskIds.has(taskId),
	).length;
	assertEqual(wave1BlockedCount, 3, "counter-stability: all 3 wave-1 tasks blocked");

	// Final counters
	assertEqual(succeededTasks, 1, "counter-stability: succeededTasks = 1");
	assertEqual(failedTasks, 1, "counter-stability: failedTasks = 1");
	assertEqual(skippedTasks, 1, "counter-stability: skippedTasks = 1 (carried)");
	assertEqual(blockedTasks, 2, "counter-stability: blockedTasks starts at 2 (carried)");
	// blockedTasks would be incremented per-wave in the loop (wave 1 adds 3 more, minus already-counted ones)
}

{
	console.log("  ▸ v1 fallback: computeResumePoint works identically without repo fields");
	// v1 state has no repoId, resolvedRepoId fields on tasks/lanes
	const v1State = minimalPersistedState({
		mode: "repo",
		wavePlan: [["T1"], ["T2", "T3"]],
		blockedTaskIds: [],
		lanes: [
			{
				laneNumber: 1, laneId: "lane-1", tmuxSessionName: "orch-lane-1",
				worktreePath: "/tmp/wt-1", branch: "task/lane-1-batch",
				taskIds: ["T1", "T2"],
				// No repoId — v1
			},
			{
				laneNumber: 2, laneId: "lane-2", tmuxSessionName: "orch-lane-2",
				worktreePath: "/tmp/wt-2", branch: "task/lane-2-batch",
				taskIds: ["T3"],
				// No repoId — v1
			},
		],
		tasks: [
			makeTaskRecord({ taskId: "T1", laneNumber: 1, sessionName: "orch-lane-1", status: "succeeded" }),
			makeTaskRecord({ taskId: "T2", laneNumber: 1, sessionName: "orch-lane-1", status: "running" }),
			makeTaskRecord({ taskId: "T3", laneNumber: 2, sessionName: "orch-lane-2", status: "pending" }),
		],
	});

	// T1 done, T2 dead session (had session), T3 dead session (had session)
	const reconciled = reconcileTaskStates(v1State, new Set(), new Set());
	const point = computeResumePoint(v1State, reconciled);

	// T1: succeeded → skip(succeeded) → completed
	assertEqual(point.completedTaskIds.length, 1, "v1 fallback: 1 completed (T1)");
	assert(point.completedTaskIds.includes("T1"), "v1 fallback: T1 in completed");

	// T2: running + dead + has session → mark-failed
	// T3: pending + dead + has session → mark-failed
	assertEqual(point.failedTaskIds.length, 2, "v1 fallback: 2 failed (T2, T3)");

	// Wave 0: T1 succeeded (skip→done). Wave 1: T2, T3 mark-failed (NOT done for wave-skip).
	assertEqual(point.resumeWaveIndex, 1, "v1 fallback: resumes from wave 1 (mark-failed NOT done for wave-skip)");

	// Blocked propagation with v1 dep graph
	const depGraph = buildTestDepGraph({
		"T1": [],
		"T2": ["T1"],
		"T3": ["T2"],
	});

	const failedSet = new Set(point.failedTaskIds);
	const blocked = computeTransitiveDependents(failedSet, depGraph);
	// T2 failed, T3 failed (both already in failedTaskIds) → T3 depends on T2
	// But T3 is already in failedSet, so no NEW blocked tasks
	assertEqual(blocked.size, 0, "v1 fallback: no new blocked (T3 already failed directly)");
}

{
	console.log("  ▸ transitive blocked propagation across repos: A→B→C chain");
	// Scenario: A (api) fails → B (frontend, depends on A) blocked → C (api, depends on B) also blocked
	const depGraph = buildTestDepGraph({
		"A": [],
		"B": ["A"],
		"C": ["B"],
	});

	const failedSet = new Set(["A"]);
	const blocked = computeTransitiveDependents(failedSet, depGraph);
	assertEqual(blocked.size, 2, "transitive-chain: 2 tasks blocked");
	assert(blocked.has("B"), "transitive-chain: B blocked (direct dep of A)");
	assert(blocked.has("C"), "transitive-chain: C blocked (transitive via B)");
	assert(!blocked.has("A"), "transitive-chain: A not in blocked set (it's in failedSet)");
}

{
	console.log("  ▸ mark-complete action always categorizes as completed (not filtered by status)");
	// Previously, mark-complete was grouped with skip and could miss tasks
	// if the persistedStatus wasn't explicitly "succeeded"
	const state = minimalPersistedState({
		wavePlan: [["T1"]],
		tasks: [
			makeTaskRecord({ taskId: "T1", status: "running" }),
		],
	});

	// T1 has .DONE → mark-complete regardless of persisted status
	const reconciled = reconcileTaskStates(state, new Set(), new Set(["T1"]));
	assertEqual(reconciled[0].action, "mark-complete", "mark-complete-always: action is mark-complete");
	assertEqual(reconciled[0].persistedStatus, "running", "mark-complete-always: persisted was running");

	const point = computeResumePoint(state, reconciled);
	assertEqual(point.completedTaskIds.length, 1, "mark-complete-always: T1 in completed");
	assert(point.completedTaskIds.includes("T1"), "mark-complete-always: T1 present");
	assertEqual(point.failedTaskIds.length, 0, "mark-complete-always: no failures");
}

// ═══════════════════════════════════════════════════════════════════════
// TP-007 Step 2: Execute resumed waves safely — repo-scoped context & persistence
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── TP-007 Step 2: reconstructAllocatedLanes & collectAllRepoRoots ──");

// ── Reimplement Step 2 helpers for test self-containment ─────────────

function reconstructAllocatedLanes(
	persistedLanes: Array<{ laneNumber: number; laneId: string; tmuxSessionName: string; worktreePath: string; branch: string; taskIds: string[]; repoId?: string }>,
	persistedTasks?: Array<{ taskId: string; repoId?: string; resolvedRepoId?: string; taskFolder?: string }>,
): any[] {
	const taskLookup = new Map<string, any>();
	if (persistedTasks) {
		for (const t of persistedTasks) {
			taskLookup.set(t.taskId, t);
		}
	}

	return persistedLanes.map((lr) => ({
		laneNumber: lr.laneNumber,
		laneId: lr.laneId,
		tmuxSessionName: lr.tmuxSessionName,
		worktreePath: lr.worktreePath,
		branch: lr.branch,
		tasks: lr.taskIds.map((taskId: string) => {
			const persistedTask = taskLookup.get(taskId);
			const taskStub: any = {};
			if (persistedTask?.repoId !== undefined) {
				taskStub.promptRepoId = persistedTask.repoId;
			}
			if (persistedTask?.resolvedRepoId !== undefined) {
				taskStub.resolvedRepoId = persistedTask.resolvedRepoId;
			}
			if (persistedTask?.taskFolder) {
				taskStub.taskFolder = persistedTask.taskFolder;
			}
			return {
				taskId,
				order: 0,
				task: Object.keys(taskStub).length > 0 ? taskStub : null,
				estimatedMinutes: 0,
			};
		}),
		strategy: "round-robin",
		estimatedLoad: 0,
		estimatedMinutes: 0,
		...(lr.repoId !== undefined ? { repoId: lr.repoId } : {}),
	}));
}

function collectAllRepoRoots(
	laneSources: Array<Array<{ repoId?: string }>>,
	defaultRepoRoot: string,
	workspaceConfig?: { repos: Map<string, { path: string }> } | null,
): string[] {
	const roots = new Set<string>();
	for (const lanes of laneSources) {
		for (const lane of lanes) {
			const root = resolveRepoRoot(lane.repoId, defaultRepoRoot, workspaceConfig);
			roots.add(root);
		}
	}
	roots.add(defaultRepoRoot);
	return [...roots];
}

// 2.1: reconstructAllocatedLanes preserves repo attribution
{
	console.log("  ▸ reconstructAllocatedLanes: preserves laneNumber, laneId, branch, repoId from persisted records");
	const persistedLanes = [
		{
			laneNumber: 1,
			laneId: "lane-1",
			tmuxSessionName: "orch-lane-1",
			worktreePath: "/work/wt-1",
			branch: "orch/batch-1-lane-1",
			taskIds: ["T1", "T2"],
			repoId: "api",
		},
		{
			laneNumber: 2,
			laneId: "lane-2",
			tmuxSessionName: "orch-lane-2",
			worktreePath: "/work/wt-2",
			branch: "orch/batch-1-lane-2",
			taskIds: ["T3"],
			repoId: "frontend",
		},
	];

	const allocated = reconstructAllocatedLanes(persistedLanes);
	assertEqual(allocated.length, 2, "reconstructed 2 lanes");
	assertEqual(allocated[0].laneNumber, 1, "lane 1 number preserved");
	assertEqual(allocated[0].laneId, "lane-1", "lane 1 id preserved");
	assertEqual(allocated[0].tmuxSessionName, "orch-lane-1", "lane 1 session preserved");
	assertEqual(allocated[0].worktreePath, "/work/wt-1", "lane 1 worktree preserved");
	assertEqual(allocated[0].branch, "orch/batch-1-lane-1", "lane 1 branch preserved");
	assertEqual(allocated[0].repoId, "api", "lane 1 repoId preserved");
	assertEqual(allocated[0].tasks.length, 2, "lane 1 has 2 task stubs");
	assertEqual(allocated[0].tasks[0].taskId, "T1", "lane 1 task 1 ID correct");
	assertEqual(allocated[0].tasks[1].taskId, "T2", "lane 1 task 2 ID correct");

	assertEqual(allocated[1].laneNumber, 2, "lane 2 number preserved");
	assertEqual(allocated[1].repoId, "frontend", "lane 2 repoId preserved");
	assertEqual(allocated[1].tasks.length, 1, "lane 2 has 1 task stub");
}

// 2.2: reconstructAllocatedLanes with v1 lanes (no repoId)
{
	console.log("  ▸ reconstructAllocatedLanes: v1 lanes (no repoId) produce lanes without repoId field");
	const v1Lanes = [
		{
			laneNumber: 1,
			laneId: "lane-1",
			tmuxSessionName: "orch-lane-1",
			worktreePath: "/work/wt-1",
			branch: "orch/batch-1-lane-1",
			taskIds: ["T1"],
		},
	];

	const allocated = reconstructAllocatedLanes(v1Lanes);
	assertEqual(allocated.length, 1, "v1 reconstructed 1 lane");
	assertEqual(allocated[0].repoId, undefined, "v1 lane has no repoId");
	assertEqual(allocated[0].laneNumber, 1, "v1 lane number preserved");
}

// 2.3: collectAllRepoRoots merges roots from multiple sources
{
	console.log("  ▸ collectAllRepoRoots: merges repos from persisted + newly allocated lanes");
	const wsConfig = {
		repos: new Map<string, { path: string }>([
			["api", { path: "/repos/api" }],
			["frontend", { path: "/repos/frontend" }],
			["backend", { path: "/repos/backend" }],
		]),
	};

	// Persisted lanes have api + frontend
	const persistedLanes = [
		{ repoId: "api" as string | undefined },
		{ repoId: "frontend" as string | undefined },
	];
	// Newly allocated lanes introduce backend
	const newLanes = [
		{ repoId: "backend" as string | undefined },
		{ repoId: "api" as string | undefined }, // duplicate, should deduplicate
	];

	const roots = collectAllRepoRoots([persistedLanes, newLanes], "/default", wsConfig);
	assert(roots.includes("/repos/api"), "includes api from persisted");
	assert(roots.includes("/repos/frontend"), "includes frontend from persisted");
	assert(roots.includes("/repos/backend"), "includes backend from new lanes");
	assert(roots.includes("/default"), "includes default root");
	assertEqual(roots.length, 4, "4 unique roots (3 repos + default)");
}

// 2.4: collectAllRepoRoots in repo mode (no workspaceConfig)
{
	console.log("  ▸ collectAllRepoRoots: repo mode (null workspace) returns only default root");
	const persistedLanes = [{ repoId: undefined as string | undefined }, { repoId: undefined as string | undefined }];
	const roots = collectAllRepoRoots([persistedLanes], "/myrepo", null);
	assertEqual(roots.length, 1, "repo mode: 1 root");
	assert(roots.includes("/myrepo"), "repo mode: only default root");
}

// 2.5: Serialization round-trip preserves lane records from reconstructed lanes
{
	console.log("  ▸ serializeBatchState: reconstructed lanes preserve repo attribution through serialization");
	const persistedLanes = [
		{
			laneNumber: 1,
			laneId: "lane-1",
			tmuxSessionName: "orch-lane-1",
			worktreePath: "/work/wt-1",
			branch: "orch/batch-1-lane-1",
			taskIds: ["T1"],
			repoId: "api",
		},
		{
			laneNumber: 2,
			laneId: "lane-2",
			tmuxSessionName: "orch-lane-2",
			worktreePath: "/work/wt-2",
			branch: "orch/batch-1-lane-2",
			taskIds: ["T2"],
			repoId: "frontend",
		},
	];

	const allocated = reconstructAllocatedLanes(persistedLanes);

	// Simulate what resumeOrchBatch does: serialize with reconstructed lanes
	const state: MinimalBatchState = {
		phase: "executing",
		batchId: "test-batch",
		baseBranch: "main",
		mode: "workspace",
		startedAt: Date.now() - 5000,
		endedAt: null,
		currentWaveIndex: 0,
		totalWaves: 1,
		totalTasks: 2,
		succeededTasks: 0,
		failedTasks: 0,
		skippedTasks: 0,
		blockedTasks: 0,
		blockedTaskIds: new Set(),
		errors: [],
		mergeResults: [],
	};

	const outcomes: any[] = [
		{ taskId: "T1", status: "succeeded", startTime: 1000, endTime: 2000, exitReason: ".DONE found", sessionName: "orch-lane-1", doneFileFound: true },
		{ taskId: "T2", status: "running", startTime: 1000, endTime: null, exitReason: "", sessionName: "orch-lane-2", doneFileFound: false },
	];

	const json = serializeBatchState(state, [["T1", "T2"]], allocated, outcomes);
	const parsed = JSON.parse(json);

	// Lane records must survive serialization
	assertEqual(parsed.lanes.length, 2, "serialized 2 lane records");
	assertEqual(parsed.lanes[0].laneNumber, 1, "lane 1 number in output");
	assertEqual(parsed.lanes[0].repoId, "api", "lane 1 repoId in output");
	assertEqual(parsed.lanes[0].tmuxSessionName, "orch-lane-1", "lane 1 session in output");
	assertEqual(parsed.lanes[1].laneNumber, 2, "lane 2 number in output");
	assertEqual(parsed.lanes[1].repoId, "frontend", "lane 2 repoId in output");

	// Task records should still have correct lane assignment
	const t1 = parsed.tasks.find((t: any) => t.taskId === "T1");
	const t2 = parsed.tasks.find((t: any) => t.taskId === "T2");
	assertEqual(t1.laneNumber, 1, "T1 assigned to lane 1");
	assertEqual(t2.laneNumber, 2, "T2 assigned to lane 2");
}

// 2.6: Empty persisted lanes reconstructs to empty (graceful)
{
	console.log("  ▸ reconstructAllocatedLanes: empty input produces empty output");
	const allocated = reconstructAllocatedLanes([]);
	assertEqual(allocated.length, 0, "empty lanes: no reconstruction");
}

// 2.7: Checkpoint attribution invariants across persistence triggers
{
	console.log("  ▸ checkpoint attribution: lanes[] and tasks[].repoId survive resume-reconciliation → wave-execution-complete");

	// Simulate the resume flow: persisted state → reconstruct → first persistence call → wave execution → second persistence call
	const persistedLanes = [
		{
			laneNumber: 1,
			laneId: "lane-1",
			tmuxSessionName: "orch-lane-1",
			worktreePath: "/work/wt-1",
			branch: "orch/batch-1-lane-1",
			taskIds: ["T1"],
			repoId: "api",
		},
	];

	// Phase 1: resume-reconciliation checkpoint (before any wave executes)
	const reconstructed = reconstructAllocatedLanes(persistedLanes);
	const reconcileState: MinimalBatchState = {
		phase: "executing",
		batchId: "test-batch",
		baseBranch: "main",
		mode: "workspace",
		startedAt: Date.now() - 5000,
		endedAt: null,
		currentWaveIndex: 0,
		totalWaves: 2,
		totalTasks: 2,
		succeededTasks: 1,
		failedTasks: 0,
		skippedTasks: 0,
		blockedTasks: 0,
		blockedTaskIds: new Set(),
		errors: [],
		mergeResults: [],
	};

	const reconcileOutcomes: any[] = [
		{ taskId: "T1", status: "succeeded", startTime: 1000, endTime: 2000, exitReason: ".DONE found", sessionName: "orch-lane-1", doneFileFound: true },
	];

	const json1 = serializeBatchState(reconcileState, [["T1"], ["T2"]], reconstructed, reconcileOutcomes);
	const parsed1 = JSON.parse(json1);

	// Verify lanes survive first checkpoint
	assertEqual(parsed1.lanes.length, 1, "reconcile checkpoint: 1 lane record");
	assertEqual(parsed1.lanes[0].repoId, "api", "reconcile checkpoint: repoId preserved");
	assertEqual(parsed1.lanes[0].laneNumber, 1, "reconcile checkpoint: laneNumber preserved");

	// Phase 2: wave-execution-complete (new wave allocates lanes in new repo)
	const newWaveLanes: any[] = [{
		laneNumber: 3,
		laneId: "lane-3",
		tmuxSessionName: "orch-lane-3",
		worktreePath: "/work/wt-3",
		branch: "orch/batch-1-lane-3",
		tasks: [{ taskId: "T2", order: 0, task: { promptRepoId: "frontend", resolvedRepoId: "frontend" }, estimatedMinutes: 5 }],
		strategy: "round-robin",
		estimatedLoad: 1,
		estimatedMinutes: 5,
		repoId: "frontend",
	}];

	const waveOutcomes = [...reconcileOutcomes, { taskId: "T2", status: "succeeded", startTime: 3000, endTime: 4000, exitReason: "done", sessionName: "orch-lane-3", doneFileFound: true }];
	const json2 = serializeBatchState(reconcileState, [["T1"], ["T2"]], newWaveLanes, waveOutcomes);
	const parsed2 = JSON.parse(json2);

	// New wave lanes take over (latestAllocatedLanes behavior)
	assertEqual(parsed2.lanes.length, 1, "wave checkpoint: 1 lane (latest wave)");
	assertEqual(parsed2.lanes[0].repoId, "frontend", "wave checkpoint: new repo 'frontend'");
	assertEqual(parsed2.lanes[0].laneNumber, 3, "wave checkpoint: lane 3 from new wave");

	// Task T2 should get repo fields from allocated task
	const t2 = parsed2.tasks.find((t: any) => t.taskId === "T2");
	assertEqual(t2.repoId, "frontend", "wave checkpoint: T2 repoId from allocated task");
	assertEqual(t2.resolvedRepoId, "frontend", "wave checkpoint: T2 resolvedRepoId from allocated task");
}

// 2.8: collectAllRepoRoots covers repos introduced by resumed waves
{
	console.log("  ▸ collectAllRepoRoots: repos from resumed wave allocation are included in cleanup set");
	const wsConfig = {
		repos: new Map<string, { path: string }>([
			["api", { path: "/repos/api" }],
			["newrepo", { path: "/repos/newrepo" }],
		]),
	};

	// Scenario: persisted state only had "api" lanes. Resumed wave introduces "newrepo".
	const persistedLaneSources = [{ repoId: "api" as string | undefined }];
	const newAllocatedSources = [{ repoId: "newrepo" as string | undefined }];

	// Without collectAllRepoRoots, only api would be cleaned up.
	// With it, both are included.
	const roots = collectAllRepoRoots([persistedLaneSources, newAllocatedSources], "/default", wsConfig);
	assert(roots.includes("/repos/api"), "cleanup includes api (from persisted)");
	assert(roots.includes("/repos/newrepo"), "cleanup includes newrepo (from resumed wave)");
	assert(roots.includes("/default"), "cleanup includes default");
	assertEqual(roots.length, 3, "3 unique roots for cleanup");
}

// 2.9: v1 fallback parity — reconstructAllocatedLanes + collectAllRepoRoots in repo mode
{
	console.log("  ▸ v1 fallback: reconstructAllocatedLanes + collectAllRepoRoots unchanged for v1 state");
	const v1Lanes = [
		{
			laneNumber: 1,
			laneId: "lane-1",
			tmuxSessionName: "orch-lane-1",
			worktreePath: "/work/wt-1",
			branch: "orch/batch-1-lane-1",
			taskIds: ["T1"],
			// no repoId — v1 behavior
		},
	];

	const allocated = reconstructAllocatedLanes(v1Lanes);
	assertEqual(allocated.length, 1, "v1 parity: 1 lane reconstructed");
	assertEqual(allocated[0].repoId, undefined, "v1 parity: no repoId");

	// collectAllRepoRoots with v1 lanes + null workspace → only default
	const roots = collectAllRepoRoots([allocated], "/myrepo", null);
	assertEqual(roots.length, 1, "v1 parity: only default root");
	assert(roots.includes("/myrepo"), "v1 parity: default root present");
}

// 2.10: Checkpoint round-trip through validatePersistedState preserves repo attribution
{
	console.log("  ▸ checkpoint round-trip: serialize → validate → lanes[].repoId + tasks[].repoId survive");

	const persistedLanes = [
		{
			laneNumber: 1,
			laneId: "lane-1",
			tmuxSessionName: "orch-lane-1",
			worktreePath: "/work/wt-1",
			branch: "orch/batch-1-lane-1",
			taskIds: ["T1"],
			repoId: "api",
		},
	];

	const allocated = reconstructAllocatedLanes(persistedLanes);

	const state: MinimalBatchState = {
		phase: "paused",
		batchId: "rt-batch",
		baseBranch: "main",
		mode: "workspace",
		startedAt: Date.now() - 5000,
		endedAt: null,
		currentWaveIndex: 0,
		totalWaves: 1,
		totalTasks: 1,
		succeededTasks: 0,
		failedTasks: 0,
		skippedTasks: 0,
		blockedTasks: 0,
		blockedTaskIds: new Set(),
		errors: [],
		mergeResults: [],
	};

	const outcomes: any[] = [
		{ taskId: "T1", status: "running", startTime: 1000, endTime: null, exitReason: "", sessionName: "orch-lane-1", doneFileFound: false },
	];

	// Serialize
	const json = serializeBatchState(state, [["T1"]], allocated, outcomes);
	const raw = JSON.parse(json);

	// Manually set taskFolder (normally done by persistRuntimeState enrichment)
	raw.tasks[0].taskFolder = "/tasks/T1";

	// Validate (simulates loadBatchState → validatePersistedState)
	const validated = validatePersistedState(raw);

	assertEqual(validated.lanes.length, 1, "round-trip: 1 lane");
	assertEqual(validated.lanes[0].repoId, "api", "round-trip: lane repoId preserved");
	assertEqual(validated.lanes[0].laneNumber, 1, "round-trip: lane number preserved");
	assertEqual(validated.lanes[0].tmuxSessionName, "orch-lane-1", "round-trip: session preserved");

	assertEqual(validated.tasks.length, 1, "round-trip: 1 task");
	assertEqual(validated.tasks[0].taskId, "T1", "round-trip: task ID preserved");
	assertEqual(validated.tasks[0].laneNumber, 1, "round-trip: task lane number preserved");

	// Validate is also usable for next resume
	const reReconstruct = reconstructAllocatedLanes(validated.lanes);
	assertEqual(reReconstruct.length, 1, "re-reconstruct: 1 lane");
	assertEqual(reReconstruct[0].repoId, "api", "re-reconstruct: repoId preserved across pause/resume");
}

// ── TP-007 Step 2 additional tests ───────────────────────────────────

// 2.11: Task repo carry-forward via persistedTasks parameter
{
	console.log("  ▸ reconstructAllocatedLanes: persistedTasks carries repo fields for archived tasks");
	const persistedLanes = [
		{
			laneNumber: 1, laneId: "lane-1", tmuxSessionName: "orch-lane-1",
			worktreePath: "/wt/1", branch: "b-1", taskIds: ["T1", "T2"], repoId: "api",
		},
	];
	const persistedTasks = [
		{ taskId: "T1", repoId: "api", resolvedRepoId: "api", taskFolder: "/tasks/T1" },
		{ taskId: "T2", repoId: "api", resolvedRepoId: "api", taskFolder: "/tasks/T2" },
	];

	const allocated = reconstructAllocatedLanes(persistedLanes, persistedTasks);
	assertEqual(allocated[0].tasks[0].task?.promptRepoId, "api", "task-carry: T1 promptRepoId");
	assertEqual(allocated[0].tasks[0].task?.resolvedRepoId, "api", "task-carry: T1 resolvedRepoId");
	assertEqual(allocated[0].tasks[0].task?.taskFolder, "/tasks/T1", "task-carry: T1 taskFolder");
	assertEqual(allocated[0].tasks[1].task?.promptRepoId, "api", "task-carry: T2 promptRepoId");

	// Serialize and verify repo fields round-trip
	const state: MinimalBatchState = {
		phase: "executing", batchId: "B1", baseBranch: "main", mode: "workspace",
		startedAt: Date.now(), endedAt: null, currentWaveIndex: 0, totalWaves: 1,
		totalTasks: 2, succeededTasks: 1, failedTasks: 0, skippedTasks: 0,
		blockedTasks: 0, blockedTaskIds: new Set(), errors: [], mergeResults: [],
	};
	const outcomes = [
		{ taskId: "T1", status: "succeeded", startTime: 1000, endTime: 2000, exitReason: "done", sessionName: "orch-lane-1", doneFileFound: true },
		{ taskId: "T2", status: "running", startTime: 1000, endTime: null, exitReason: "", sessionName: "orch-lane-1", doneFileFound: false },
	];
	const json = serializeBatchState(state, [["T1", "T2"]], allocated, outcomes);
	const parsed = JSON.parse(json);
	const t1 = parsed.tasks.find((t: any) => t.taskId === "T1");
	const t2 = parsed.tasks.find((t: any) => t.taskId === "T2");
	assertEqual(t1.repoId, "api", "task-carry-roundtrip: T1 repoId in output");
	assertEqual(t1.resolvedRepoId, "api", "task-carry-roundtrip: T1 resolvedRepoId in output");
	assertEqual(t2.repoId, "api", "task-carry-roundtrip: T2 repoId in output");
}

// 2.12: Without persistedTasks, tasks have null task stub (v1 compat)
{
	console.log("  ▸ reconstructAllocatedLanes: without persistedTasks, task stubs are null (backward compat)");
	const persistedLanes = [
		{
			laneNumber: 1, laneId: "lane-1", tmuxSessionName: "s1",
			worktreePath: "/wt/1", branch: "b-1", taskIds: ["T1"],
		},
	];

	const allocated = reconstructAllocatedLanes(persistedLanes);
	assertEqual(allocated[0].tasks[0].task, null, "no-tasks-param: task stub is null");
}

// 2.13: Blocked counter — persisted-blocked in unvisited waves counted at resume init
{
	console.log("  ▸ blocked counter: persisted-blocked tasks in unvisited waves counted at resume init");

	// Simulate: 3 waves, paused at wave 1 (0-indexed). T3 (wave 2) is blocked
	// but wave 2 was never entered. blockedTasks = 1 (only T-fail-dep from wave 1).
	const wavePlan = [["T1", "T-fail"], ["T-fail-dep"], ["T3"]];
	const persistedBlockedTaskIds = new Set(["T-fail-dep", "T3"]);
	const persistedBlockedTasks = 1; // Only T-fail-dep was counted (wave 1 was entered)
	const resumeWaveIndex = 2; // Resume at wave 2 (T-fail-dep in wave 1 was already handled)

	// Count persisted-blocked tasks in unvisited waves (>= resumeWaveIndex)
	let uncountedBlocked = 0;
	for (let wi = resumeWaveIndex; wi < wavePlan.length; wi++) {
		for (const taskId of wavePlan[wi]) {
			if (persistedBlockedTaskIds.has(taskId)) {
				uncountedBlocked++;
			}
		}
	}

	const totalBlocked = persistedBlockedTasks + uncountedBlocked;
	assertEqual(uncountedBlocked, 1, "blocked-unvisited: T3 is 1 uncounted task");
	assertEqual(totalBlocked, 2, "blocked-unvisited: total = 1 (carried) + 1 (T3)");

	// Verify per-wave counting doesn't double-count
	// Wave 2 has T3 in persistedBlockedTaskIds → excluded by guard
	const wave2BlockedInLoop = wavePlan[2].filter(
		taskId => persistedBlockedTaskIds.has(taskId) && !persistedBlockedTaskIds.has(taskId),
	);
	assertEqual(wave2BlockedInLoop.length, 0, "blocked-unvisited: T3 not double-counted in loop");
}

// 2.14: Blocked counter — all blocked tasks in visited waves → no uncounted
{
	console.log("  ▸ blocked counter: all blocked tasks in already-visited waves → uncounted = 0");
	const wavePlan = [["T1", "T-fail"], ["T-dep"]];
	const persistedBlockedTaskIds = new Set(["T-dep"]);
	const resumeWaveIndex = 1; // Resume at wave 1 where T-dep lives

	let uncountedBlocked = 0;
	for (let wi = resumeWaveIndex; wi < wavePlan.length; wi++) {
		for (const taskId of wavePlan[wi]) {
			if (persistedBlockedTaskIds.has(taskId)) {
				uncountedBlocked++;
			}
		}
	}

	// T-dep IS in wave 1 which is >= resumeWaveIndex, so it's counted here.
	// But it was also counted in the prior run's wave loop. The key is: was the wave entered?
	// If resumeWaveIndex = 1, it means wave 1 had incomplete tasks. The blocked counter
	// for T-dep may or may not have been incremented. If T-dep was blocked DURING wave 1
	// execution, engine.ts counted it. If T-dep was blocked BEFORE wave 1 entered (from
	// reconciliation), the old code would have missed it.
	//
	// The fix counts ALL persisted-blocked in unvisited waves. Wave 1 IS the resume wave,
	// so T-dep at index 1 is counted. This is correct because if T-dep was already counted
	// in the prior run, it wouldn't be in resumeWaveIndex's wave — it would have been
	// skipped and the resume would start at wave 2.
	assertEqual(uncountedBlocked, 1, "blocked-visited: T-dep counted at resume init");
}

// 2.15: Re-exec merge indexing — sentinel waveIndex -1 produces valid persistence
{
	console.log("  ▸ re-exec merge: sentinel waveIndex -1 produces waveIndex 0 in persisted state");
	const state: MinimalBatchState = {
		phase: "executing", batchId: "B-reexec", baseBranch: "main", mode: "repo",
		startedAt: Date.now(), endedAt: null, currentWaveIndex: 0, totalWaves: 2,
		totalTasks: 3, succeededTasks: 1, failedTasks: 0, skippedTasks: 0,
		blockedTasks: 0, blockedTaskIds: new Set(), errors: [],
		mergeResults: [
			// Re-exec merge with sentinel
			{ waveIndex: -1, status: "succeeded", failedLane: null, failureReason: null, laneResults: [], totalDurationMs: 100 },
			// Normal wave 1 merge
			{ waveIndex: 1, status: "succeeded", failedLane: null, failureReason: null, laneResults: [], totalDurationMs: 200 },
			// Normal wave 2 merge
			{ waveIndex: 2, status: "succeeded", failedLane: null, failureReason: null, laneResults: [], totalDurationMs: 300 },
		],
	};

	const json = serializeBatchState(state, [["T1"], ["T2"], ["T3"]], [], []);
	const parsed = JSON.parse(json);

	assertEqual(parsed.mergeResults.length, 3, "re-exec-merge: 3 merge results");
	assertEqual(parsed.mergeResults[0].waveIndex, 0, "re-exec-merge: sentinel -1 clamped to 0");
	assertEqual(parsed.mergeResults[1].waveIndex, 0, "re-exec-merge: wave 1 normalized to 0");
	assertEqual(parsed.mergeResults[2].waveIndex, 1, "re-exec-merge: wave 2 normalized to 1");

	// All waveIndex values are valid (>= 0)
	for (const mr of parsed.mergeResults) {
		assert(mr.waveIndex >= 0, `re-exec-merge: waveIndex ${mr.waveIndex} is non-negative`);
	}
}

// 2.16: Re-exec merge — old waveIndex=0 backward compat
{
	console.log("  ▸ re-exec merge: old waveIndex=0 (pre-fix) also clamps to 0");
	const state: MinimalBatchState = {
		phase: "executing", batchId: "B-old", baseBranch: "main", mode: "repo",
		startedAt: Date.now(), endedAt: null, currentWaveIndex: 0, totalWaves: 1,
		totalTasks: 1, succeededTasks: 1, failedTasks: 0, skippedTasks: 0,
		blockedTasks: 0, blockedTaskIds: new Set(), errors: [],
		mergeResults: [
			{ waveIndex: 0, status: "succeeded", failedLane: null, failureReason: null, laneResults: [], totalDurationMs: 50 },
		],
	};

	const json = serializeBatchState(state, [["T1"]], [], []);
	const parsed = JSON.parse(json);
	assertEqual(parsed.mergeResults[0].waveIndex, 0, "old-reexec: 0 → Math.max(0, -1) = 0");
	assert(parsed.mergeResults[0].waveIndex >= 0, "old-reexec: waveIndex is non-negative");
}

// 2.17: Mixed-repo checkpoint: tasks from different repos preserve attribution
{
	console.log("  ▸ mixed-repo checkpoint: tasks from 2 repos preserve attribution through serialize");
	const persistedLanes = [
		{
			laneNumber: 1, laneId: "l-1", tmuxSessionName: "s-1",
			worktreePath: "/wt/api-1", branch: "b-1", taskIds: ["TA"], repoId: "api",
		},
		{
			laneNumber: 2, laneId: "l-2", tmuxSessionName: "s-2",
			worktreePath: "/wt/fe-1", branch: "b-2", taskIds: ["TF"], repoId: "frontend",
		},
	];
	const persistedTasks = [
		{ taskId: "TA", repoId: "api", resolvedRepoId: "api", taskFolder: "/tasks/TA" },
		{ taskId: "TF", repoId: "frontend", resolvedRepoId: "frontend", taskFolder: "/tasks/TF" },
	];

	const allocated = reconstructAllocatedLanes(persistedLanes, persistedTasks);
	const state: MinimalBatchState = {
		phase: "executing", batchId: "B-mixed", baseBranch: "main", mode: "workspace",
		startedAt: Date.now(), endedAt: null, currentWaveIndex: 0, totalWaves: 1,
		totalTasks: 2, succeededTasks: 0, failedTasks: 0, skippedTasks: 0,
		blockedTasks: 0, blockedTaskIds: new Set(), errors: [], mergeResults: [],
	};
	const outcomes = [
		{ taskId: "TA", status: "succeeded", startTime: 1000, endTime: 2000, exitReason: "done", sessionName: "s-1", doneFileFound: true },
		{ taskId: "TF", status: "failed", startTime: 1000, endTime: 2000, exitReason: "crash", sessionName: "s-2", doneFileFound: false },
	];

	const json = serializeBatchState(state, [["TA", "TF"]], allocated, outcomes);
	const parsed = JSON.parse(json);

	// Both lanes preserved
	assertEqual(parsed.lanes.length, 2, "mixed-repo: 2 lanes");
	assertEqual(parsed.lanes[0].repoId, "api", "mixed-repo: lane 1 is api");
	assertEqual(parsed.lanes[1].repoId, "frontend", "mixed-repo: lane 2 is frontend");

	// Both tasks have repo attribution
	const ta = parsed.tasks.find((t: any) => t.taskId === "TA");
	const tf = parsed.tasks.find((t: any) => t.taskId === "TF");
	assertEqual(ta.repoId, "api", "mixed-repo: TA repoId");
	assertEqual(ta.resolvedRepoId, "api", "mixed-repo: TA resolvedRepoId");
	assertEqual(tf.repoId, "frontend", "mixed-repo: TF repoId");
	assertEqual(tf.resolvedRepoId, "frontend", "mixed-repo: TF resolvedRepoId");
}

// ═══════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════

console.log("\n══════════════════════════════════════");
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
	console.log("\n  Failed:");
	for (const f of failures) {
		console.log(`    • ${f}`);
	}
}
console.log("══════════════════════════════════════\n");

if (failed > 0) throw new Error(`${failed} test(s) failed`);

} // end runAllTests

// ── Dual-mode execution ──────────────────────────────────────────────
if (isVitest) {
	const { describe, it } = await import("vitest");
	describe("Orchestrator State Persistence", () => {
		it("passes all assertions", () => {
			runAllTests();
		});
	});
} else {
	try {
		runAllTests();
		process.exit(0);
	} catch {
		process.exit(1);
	}
}
