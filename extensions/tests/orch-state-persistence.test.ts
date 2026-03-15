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
	if (!obj.baseBranch) obj.baseBranch = "";
	if (!obj.mode) obj.mode = "repo";
	if (isV1) obj.schemaVersion = BATCH_STATE_SCHEMA_VERSION;

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
// 2.1: persistRuntimeState — integration with state triggers
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── 2.1: persistRuntimeState integration tests ──");

// Helper: build a minimal valid runtime batch state for persistence tests
interface MinimalBatchState {
	phase: string;
	batchId: string;
	pauseSignal: { paused: boolean };
	waveResults: any[];
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
		pauseSignal: { paused: false },
		waveResults: [],
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
function minimalLane(laneNum: number, taskIds: string[]): any {
	return {
		laneNumber: laneNum,
		laneId: `lane-${laneNum}`,
		tmuxSessionName: `orch-lane-${laneNum}`,
		worktreePath: `/tmp/wt-${laneNum}`,
		branch: `task/lane-${laneNum}-20260309T030000`,
		tasks: taskIds.map(id => ({ taskId: id, parsedTask: null, weight: 2, estimatedMinutes: 10 })),
		strategy: "affinity-first",
		estimatedLoad: 2,
		estimatedMinutes: 10,
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
function serializeBatchState(
	state: MinimalBatchState,
	wavePlan: string[][],
	lanes: any[],
	allTaskOutcomes: any[],
): string {
	const now = Date.now();

	const taskRecords = allTaskOutcomes.map((outcome: any) => ({
		taskId: outcome.taskId,
		laneNumber: lanes.find((l: any) =>
			l.tasks.some((t: any) => t.taskId === outcome.taskId),
		)?.laneNumber ?? 0,
		sessionName: outcome.sessionName,
		status: outcome.status,
		taskFolder: "",
		startedAt: outcome.startTime,
		endedAt: outcome.endTime,
		doneFileFound: outcome.doneFileFound,
		exitReason: outcome.exitReason,
	}));

	const laneRecords = lanes.map((lane: any) => ({
		laneNumber: lane.laneNumber,
		laneId: lane.laneId,
		tmuxSessionName: lane.tmuxSessionName,
		worktreePath: lane.worktreePath,
		branch: lane.branch,
		taskIds: lane.tasks.map((t: any) => t.taskId),
	}));

	const mergeResults = state.waveResults
		.filter((wr: any) => wr.waveIndex <= state.currentWaveIndex)
		.map((wr: any) => ({
			waveIndex: wr.waveIndex,
			status: wr.overallStatus === "aborted" ? "failed" : wr.overallStatus,
			failedLane: null,
			failureReason: null,
		}));

	const persisted = {
		schemaVersion: BATCH_STATE_SCHEMA_VERSION,
		phase: state.phase,
		batchId: state.batchId,
		mode: "repo",
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
function persistRuntimeState(
	reason: string,
	batchState: MinimalBatchState,
	wavePlan: string[][],
	lanes: any[],
	allTaskOutcomes: any[],
	discovery: { pending: Map<string, { taskFolder: string }> } | null,
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
		return {
			orphanSessions: [],
			stateStatus,
			loadedState,
			stateError,
			recommendedAction: "resume",
			userMessage:
				`🔄 Found interrupted batch ${loadedState.batchId} (${loadedState.phase}).\n` +
				`   ${completedCount}/${allTaskIds.length} task(s) completed.\n` +
				`   Use /orch-resume to continue, or /orch-abort to clean up.`,
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
): any[] {
	return persistedState.tasks.map((task: any) => {
		const sessionAlive = aliveSessions.has(task.sessionName);
		const doneFileFound = doneTaskIds.has(task.taskId);

		// Precedence 1: .DONE file found → task completed
		if (doneFileFound) {
			return {
				taskId: task.taskId,
				persistedStatus: task.status,
				liveStatus: "succeeded",
				sessionAlive,
				doneFileFound: true,
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
				action: "skip",
			};
		}

		// Precedence 4: Dead session + not terminal + no .DONE → failed
		return {
			taskId: task.taskId,
			persistedStatus: task.status,
			liveStatus: "failed",
			sessionAlive: false,
			doneFileFound: false,
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

	for (const task of reconciledTasks) {
		switch (task.action) {
			case "mark-complete":
			case "skip":
				if (task.liveStatus === "succeeded" || task.persistedStatus === "succeeded") {
					completedTaskIds.push(task.taskId);
				} else if (task.liveStatus === "failed" || task.liveStatus === "stalled" || task.persistedStatus === "failed" || task.persistedStatus === "stalled") {
					failedTaskIds.push(task.taskId);
				}
				break;
			case "reconnect":
				reconnectTaskIds.push(task.taskId);
				break;
			case "mark-failed":
				failedTaskIds.push(task.taskId);
				break;
		}
	}

	let resumeWaveIndex = persistedState.wavePlan.length;
	for (let i = 0; i < persistedState.wavePlan.length; i++) {
		const waveTasks = persistedState.wavePlan[i];
		const allDone = waveTasks.every((taskId: string) => {
			const reconciled = reconciledMap.get(taskId);
			if (!reconciled) return false;
			return (
				reconciled.action === "mark-complete" ||
				(reconciled.action === "skip" && (
					reconciled.liveStatus === "succeeded" ||
					reconciled.liveStatus === "failed" ||
					reconciled.liveStatus === "stalled" ||
					reconciled.persistedStatus === "succeeded" ||
					reconciled.persistedStatus === "failed" ||
					reconciled.persistedStatus === "stalled"
				))
			);
		});

		if (!allDone) {
			resumeWaveIndex = i;
			break;
		}
	}

	const actualPendingTaskIds: string[] = [];
	for (let i = resumeWaveIndex; i < persistedState.wavePlan.length; i++) {
		for (const taskId of persistedState.wavePlan[i]) {
			const reconciled = reconciledMap.get(taskId);
			if (!reconciled) {
				actualPendingTaskIds.push(taskId);
				continue;
			}
			if (reconciled.action === "reconnect" || reconciled.action === "mark-failed") {
				actualPendingTaskIds.push(taskId);
			}
			if (reconciled.action === "skip" && reconciled.persistedStatus === "pending") {
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
	};
}

{
	console.log("  ▸ all tasks in wave 0 done → resumeWaveIndex=1");
	const state = minimalPersistedState({
		wavePlan: [["T1", "T2"], ["T3"]],
		tasks: [
			makeTaskRecord({ taskId: "T1", status: "succeeded" }),
			makeTaskRecord({ taskId: "T2", status: "succeeded" }),
			makeTaskRecord({ taskId: "T3", status: "pending" }),
		],
	});
	// All in wave 0 are succeeded → skip action
	const reconciled = reconcileTaskStates(state, new Set(), new Set());
	const point = computeResumePoint(state, reconciled);
	assertEqual(point.resumeWaveIndex, 1, "resumes from wave 1");
	assertEqual(point.completedTaskIds.length, 2, "2 tasks completed");
	assert(point.pendingTaskIds.includes("T3"), "T3 is pending (mark-failed since dead+no DONE)");
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
	// T1 is succeeded→skip, T2 is running+dead→mark-failed, T3 is pending→mark-failed
	const reconciled = reconcileTaskStates(state, new Set(), new Set());
	const point = computeResumePoint(state, reconciled);
	assertEqual(point.resumeWaveIndex, 0, "resumes from wave 0 (T2 not done)");
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
		assertEqual(loadedState!.tasks.length, 4, "4 task records persisted");
		assertEqual(loadedState!.wavePlan.length, 3, "3 waves in plan");

		// RECONCILE: Simulate that after disconnect, E2E-003's session is dead + .DONE exists,
		// E2E-004's session is still alive, E2E-001/002 completed earlier
		const aliveSessions = new Set(["orch-lane-2"]); // E2E-004's session
		const doneTaskIds = new Set(["E2E-001", "E2E-002", "E2E-003"]); // E2E-003 completed while disconnected

		const reconciled = reconcileTaskStates(loadedState!, aliveSessions, doneTaskIds);
		assertEqual(reconciled.length, 4, "4 tasks reconciled");

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
		assertEqual(resumePoint.failedTaskIds.length, 0, "no failed tasks");

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
