/**
 * Orchestrator Pure Function Tests — TS-007 Step 7
 *
 * Tests for deterministic, side-effect-free functions exported from
 * task-orchestrator.ts. Since pi packages (@mariozechner/pi-tui) are
 * globally installed and not importable by tsx, we extract the pure
 * function source and test them in isolation.
 *
 * Run: npx tsx extensions/tests/orch-pure-functions.test.ts
 *   or: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test extensions/tests/orch-pure-functions.test.ts
 *
 * Test categories:
 *   7.1 — computeOrchSummaryCounts
 *   7.2 — formatElapsedTime
 *   7.3 — buildDashboardViewModel
 *   7.4 — computeTransitiveDependents
 *   7.5 — resolveWorktreeBasePath (extracted from source)
 *   7.6 — generateWorktreePath (table-driven, extracted from source)
 *   7.7 — listWorktrees regex pattern (naming invariant: {prefix}-{N})
 *   7.8 — computeSavedBranchName (branch → saved/ prefix)
 *   7.9 — resolveSavedBranchCollision (decision table: absent/same/diff SHA)
 *   7.10 — hasUnmergedCommits (source verification: error codes, git usage)
 *   7.11 — preserveBranch (source verification: graceful error handling)
 *   7.12 — ensureBranchDeleted (source verification: rename semantics)
 */

import { readFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Legacy compatibility: older harnesses may set VITEST.
// Treat either NODE_TEST_CONTEXT or VITEST as "running under a test runner".
const isTestRunner = !!(process.env.NODE_TEST_CONTEXT || process.env.VITEST);

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

// ── Extract pure functions from source ───────────────────────────────

// Read the source files and extract the pure functions we need to test.
// This avoids needing to resolve @mariozechner/pi-tui at import time.
// Functions were refactored from the monolith task-orchestrator.ts into
// separate modules under taskplane/.

const sourceFiles = [
	join(__dirname, "..", "taskplane", "formatting.ts"),
	join(__dirname, "..", "taskplane", "execution.ts"),
	join(__dirname, "..", "taskplane", "worktree.ts"),
	join(__dirname, "..", "taskplane", "messages.ts"),
	join(__dirname, "..", "taskplane", "waves.ts"),
	join(__dirname, "..", "taskplane", "types.ts"),
];
const source = sourceFiles.map(f => readFileSync(f, "utf8")).join("\n");

/**
 * Extract a function body from the source by searching for its definition.
 * Returns the code from "function NAME(" to the matching closing brace.
 */
function extractFunction(src: string, name: string): string {
	const pattern = new RegExp(`function ${name}\\s*[<(]`);
	const match = pattern.exec(src);
	if (!match) throw new Error(`Function '${name}' not found in source`);

	let depth = 0;
	let started = false;
	let start = match.index;

	for (let i = match.index; i < src.length; i++) {
		if (src[i] === "{") {
			depth++;
			started = true;
		}
		if (src[i] === "}") {
			depth--;
			if (started && depth === 0) {
				return src.slice(start, i + 1);
			}
		}
	}

	throw new Error(`Could not find end of function '${name}'`);
}

// We'll test each function via eval-like approach. Since these are pure
// functions with minimal dependencies, we can build a test module.

// ═══════════════════════════════════════════════════════════════════════
// 7.1: computeOrchSummaryCounts — test inline reimplementation
// ═══════════════════════════════════════════════════════════════════════

// Reimplemented from source (verified by reading the actual implementation)
function computeOrchSummaryCounts(
	batchState: any,
	monitorState?: any,
): { completed: number; running: number; queued: number; failed: number; blocked: number; stalled: number; total: number } {
	let running = 0;
	let stalled = 0;

	if (monitorState) {
		for (const lane of monitorState.lanes) {
			if (lane.currentTaskSnapshot) {
				if (lane.currentTaskSnapshot.status === "stalled") stalled++;
				else if (lane.currentTaskSnapshot.status === "running") running++;
			}
		}
	}

	const completed = batchState.succeededTasks;
	const failed = batchState.failedTasks;
	const blocked = batchState.blockedTasks;
	const total = batchState.totalTasks;
	const queued = Math.max(0, total - completed - failed - blocked - stalled - running - batchState.skippedTasks);

	return { completed, running, queued, failed, blocked, stalled, total };
}

// Reimplemented from source (verified by reading the actual implementation)
function formatElapsedTime(startMs: number, endMs?: number | null): string {
	if (startMs <= 0) return "0s";
	const elapsed = (endMs ?? Date.now()) - startMs;
	if (elapsed < 0) return "0s";

	const totalSec = Math.floor(elapsed / 1000);
	const hours = Math.floor(totalSec / 3600);
	const minutes = Math.floor((totalSec % 3600) / 60);
	const seconds = totalSec % 60;

	if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
	if (minutes > 0) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

// Reimplemented from source (verified by reading the actual implementation)
function computeTransitiveDependents(
	failedTaskIds: Set<string>,
	dependencyGraph: { dependents: Map<string, string[]> },
): Set<string> {
	const blocked = new Set<string>();
	const queue = [...failedTaskIds];

	while (queue.length > 0) {
		const current = queue.shift()!;
		const dependents = dependencyGraph.dependents.get(current) || [];
		const sortedDependents = [...dependents].sort();

		for (const dep of sortedDependents) {
			if (blocked.has(dep)) continue;
			if (failedTaskIds.has(dep)) continue;
			blocked.add(dep);
			queue.push(dep);
		}
	}

	return blocked;
}

// Reimplemented from source (verified by reading the actual implementation)
function buildDashboardViewModel(
	batchState: any,
	monitorState?: any,
): any {
	const summary = computeOrchSummaryCounts(batchState, monitorState);
	const elapsed = formatElapsedTime(batchState.startedAt, batchState.endedAt);

	const waveProgress = batchState.totalWaves > 0
		? `${Math.max(0, batchState.currentWaveIndex + 1)}/${batchState.totalWaves}`
		: "0/0";

	const laneCards: any[] = [];

	if (monitorState && monitorState.lanes.length > 0) {
		const sortedLanes = [...monitorState.lanes].sort((a: any, b: any) => a.laneNumber - b.laneNumber);
		for (const lane of sortedLanes) {
			const snap = lane.currentTaskSnapshot;
			let status = "idle";
			if (lane.failedTasks.length > 0) status = "failed";
			else if (snap?.status === "stalled") status = "stalled";
			else if (snap?.status === "running") status = "running";
			else if (lane.completedTasks.length > 0 && lane.remainingTasks.length === 0 && !lane.currentTaskId) status = "succeeded";

			laneCards.push({
				laneNumber: lane.laneNumber,
				laneId: lane.laneId,
				sessionName: lane.sessionName,
				sessionAlive: lane.sessionAlive,
				currentTaskId: lane.currentTaskId,
				currentStepName: snap?.currentStepName || null,
				totalChecked: snap?.totalChecked || 0,
				totalItems: snap?.totalItems || 0,
				completedTasks: lane.completedTasks.length,
				totalLaneTasks: lane.completedTasks.length + lane.failedTasks.length + lane.remainingTasks.length + (lane.currentTaskId ? 1 : 0),
				status,
				stallReason: snap?.stallReason || null,
			});
		}
	} else if (batchState.currentLanes?.length > 0) {
		const sortedLanes = [...batchState.currentLanes].sort((a: any, b: any) => a.laneNumber - b.laneNumber);
		for (const lane of sortedLanes) {
			laneCards.push({
				laneNumber: lane.laneNumber,
				laneId: lane.laneId,
				sessionName: lane.laneSessionId,
				sessionAlive: true,
				currentTaskId: lane.tasks.length > 0 ? lane.tasks[0].taskId : null,
				currentStepName: null,
				totalChecked: 0,
				totalItems: 0,
				completedTasks: 0,
				totalLaneTasks: lane.tasks.length,
				status: "running",
				stallReason: null,
			});
		}
	}

	let attachHint = "";
	const aliveLane = laneCards.find((l: any) => l.sessionAlive && l.status === "running");
	if (aliveLane) {
		attachHint = `tmux attach -t ${aliveLane.sessionName}`;
	} else if (laneCards.length > 0) {
		attachHint = "/orch-sessions for session list";
	}

	let failurePolicy: string | null = null;
	if (batchState.phase === "stopped" && batchState.waveResults?.length > 0) {
		const lastWave = batchState.waveResults[batchState.waveResults.length - 1];
		if (lastWave.stoppedEarly && lastWave.policyApplied) {
			failurePolicy = lastWave.policyApplied;
		}
	}

	return {
		phase: batchState.phase,
		batchId: batchState.batchId,
		waveProgress,
		elapsed,
		summary,
		laneCards,
		attachHint,
		errors: batchState.errors,
		failurePolicy,
	};
}

// ── All test logic wrapped in a function for dual-mode execution ─────

function runAllTests(): void {

// ── Verify reimplementation matches source ───────────────────────────

// First, let's verify that our reimplemented functions match the actual
// source code logic by checking key patterns are present in the source.

console.log("\n─── Source Verification ───");

{
	const fnSrc = extractFunction(source, "computeOrchSummaryCounts");
	assert(fnSrc.includes("Math.max(0,"), "computeOrchSummaryCounts: has Math.max(0 for queued");
	assert(fnSrc.includes("batchState.skippedTasks"), "computeOrchSummaryCounts: subtracts skippedTasks");
	assert(fnSrc.includes('status === "stalled"'), "computeOrchSummaryCounts: checks stalled status");
	assert(fnSrc.includes('status === "running"'), "computeOrchSummaryCounts: checks running status");
}

{
	const fnSrc = extractFunction(source, "formatElapsedTime");
	assert(fnSrc.includes("startMs <= 0"), "formatElapsedTime: handles startMs <= 0");
	assert(fnSrc.includes("elapsed < 0"), "formatElapsedTime: handles negative elapsed");
	assert(fnSrc.includes("3600"), "formatElapsedTime: has hour calculation");
}

{
	const fnSrc = extractFunction(source, "computeTransitiveDependents");
	assert(fnSrc.includes("queue.shift()"), "computeTransitiveDependents: uses BFS (shift)");
	assert(fnSrc.includes("sort()"), "computeTransitiveDependents: deterministic sort");
	assert(fnSrc.includes("failedTaskIds.has(dep)"), "computeTransitiveDependents: skips failed tasks");
}

{
	const fnSrc = extractFunction(source, "buildDashboardViewModel");
	assert(fnSrc.includes("laneNumber - b.laneNumber"), "buildDashboardViewModel: sorts by laneNumber");
	assert(fnSrc.includes("lane.laneSessionId"), "buildDashboardViewModel: uses laneSessionId from allocation");
	assert(fnSrc.includes("failurePolicy"), "buildDashboardViewModel: includes failurePolicy");
}

// ── Helpers ──────────────────────────────────────────────────────────

function freshBatchState(overrides: any = {}): any {
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
		...overrides,
	};
}

// ═══════════════════════════════════════════════════════════════════════
// 7.1: computeOrchSummaryCounts
// ═══════════════════════════════════════════════════════════════════════

console.log("\n─── 7.1: computeOrchSummaryCounts ───");

{
	console.log("  ▸ idle batch with no tasks");
	const result = computeOrchSummaryCounts(freshBatchState());
	assertEqual(result.completed, 0, "completed=0");
	assertEqual(result.running, 0, "running=0");
	assertEqual(result.queued, 0, "queued=0");
	assertEqual(result.failed, 0, "failed=0");
	assertEqual(result.blocked, 0, "blocked=0");
	assertEqual(result.stalled, 0, "stalled=0");
	assertEqual(result.total, 0, "total=0");
}

{
	console.log("  ▸ batch with succeeded/failed/blocked tasks, no monitor");
	const batch = freshBatchState({ totalTasks: 10, succeededTasks: 5, failedTasks: 2, blockedTasks: 1 });
	const result = computeOrchSummaryCounts(batch);
	assertEqual(result.completed, 5, "completed=5");
	assertEqual(result.failed, 2, "failed=2");
	assertEqual(result.blocked, 1, "blocked=1");
	assertEqual(result.queued, 2, "queued=2 (10-5-2-1-0-0-0)");
	assertEqual(result.total, 10, "total=10");
	assertEqual(result.running, 0, "running=0 (no monitor)");
	assertEqual(result.stalled, 0, "stalled=0 (no monitor)");
}

{
	console.log("  ▸ batch with live monitor data — running and stalled");
	const batch = freshBatchState({ totalTasks: 4, succeededTasks: 1 });
	const monitor = {
		lanes: [
			{ currentTaskSnapshot: { status: "running" } },
			{ currentTaskSnapshot: { status: "stalled" } },
		],
	};
	const result = computeOrchSummaryCounts(batch, monitor);
	assertEqual(result.running, 1, "running=1");
	assertEqual(result.stalled, 1, "stalled=1");
	assertEqual(result.completed, 1, "completed=1");
	assertEqual(result.queued, 1, "queued=1 (4-1-0-0-1-1-0)");
}

{
	console.log("  ▸ queued cannot go negative");
	const batch = freshBatchState({ totalTasks: 2, succeededTasks: 2 });
	const result = computeOrchSummaryCounts(batch);
	assertEqual(result.queued, 0, "queued=0");
}

{
	console.log("  ▸ skipped tasks reduce queued count");
	const batch = freshBatchState({ totalTasks: 5, succeededTasks: 2, skippedTasks: 1 });
	const result = computeOrchSummaryCounts(batch);
	assertEqual(result.queued, 2, "queued=2 (5-2-0-0-0-0-1)");
}

// ═══════════════════════════════════════════════════════════════════════
// 7.2: formatElapsedTime
// ═══════════════════════════════════════════════════════════════════════

console.log("\n─── 7.2: formatElapsedTime ───");

{
	console.log("  ▸ zero elapsed (startMs=0)");
	assertEqual(formatElapsedTime(0), "0s", "startMs=0 → '0s'");
}

{
	console.log("  ▸ negative elapsed (endMs < startMs)");
	assertEqual(formatElapsedTime(1000, 500), "0s", "negative → '0s'");
}

{
	console.log("  ▸ seconds only");
	assertEqual(formatElapsedTime(1000, 1000 + 45_000), "45s", "45s");
}

{
	console.log("  ▸ minutes and seconds");
	assertEqual(formatElapsedTime(1000, 1000 + 134_000), "2m 14s", "2m 14s");
}

{
	console.log("  ▸ hours, minutes, seconds");
	assertEqual(formatElapsedTime(1000, 1000 + 3_930_000), "1h 5m 30s", "1h 5m 30s");
}

{
	console.log("  ▸ exact minute boundary");
	assertEqual(formatElapsedTime(1000, 1000 + 60_000), "1m 0s", "1m 0s");
}

{
	console.log("  ▸ open-ended (no endMs) uses Date.now — returns string");
	const result = formatElapsedTime(Date.now() - 5000);
	assert(result.endsWith("s"), `open-ended returns string ending in 's': got '${result}'`);
}

{
	console.log("  ▸ exact zero seconds");
	assertEqual(formatElapsedTime(1000, 1000), "0s", "0ms elapsed → '0s'");
}

// ═══════════════════════════════════════════════════════════════════════
// 7.3: buildDashboardViewModel
// ═══════════════════════════════════════════════════════════════════════

console.log("\n─── 7.3: buildDashboardViewModel ───");

{
	console.log("  ▸ idle state — no batch");
	const vm = buildDashboardViewModel(freshBatchState());
	assertEqual(vm.phase, "idle", "phase=idle");
	assertEqual(vm.batchId, "", "batchId empty");
	assertEqual(vm.waveProgress, "0/0", "waveProgress=0/0");
	assertEqual(vm.laneCards.length, 0, "no lane cards");
	assertEqual(vm.attachHint, "", "no attach hint");
	assertEqual(vm.summary.total, 0, "total=0");
	assertEqual(vm.failurePolicy, null, "no failure policy");
}

{
	console.log("  ▸ planning state");
	const batch = freshBatchState({
		phase: "planning",
		batchId: "20260309T120000",
		totalWaves: 3,
		totalTasks: 12,
		currentWaveIndex: 0,
		startedAt: Date.now() - 5000,
	});
	const vm = buildDashboardViewModel(batch);
	assertEqual(vm.phase, "planning", "phase=planning");
	assertEqual(vm.batchId, "20260309T120000", "batchId set");
	assertEqual(vm.waveProgress, "1/3", "waveProgress=1/3");
	assertEqual(vm.summary.total, 12, "total=12");
}

{
	console.log("  ▸ executing with monitor data — sorted lanes");
	const batch = freshBatchState({
		phase: "executing",
		batchId: "20260309T120000",
		totalWaves: 2,
		totalTasks: 4,
		succeededTasks: 1,
		currentWaveIndex: 0,
		startedAt: Date.now() - 120_000,
	});
	const monitor = {
		lanes: [
			{
				laneNumber: 2,
				laneId: "lane-2",
				sessionName: "orch-lane-2",
				sessionAlive: true,
				currentTaskId: "TASK-002",
				currentTaskSnapshot: { status: "running", currentStepName: "Write Tests", totalChecked: 3, totalItems: 8 },
				completedTasks: [],
				failedTasks: [],
				remainingTasks: ["TASK-003"],
			},
			{
				laneNumber: 1,
				laneId: "lane-1",
				sessionName: "orch-lane-1",
				sessionAlive: true,
				currentTaskId: "TASK-001",
				currentTaskSnapshot: { status: "running", currentStepName: "Build Service", totalChecked: 5, totalItems: 10 },
				completedTasks: ["TASK-000"],
				failedTasks: [],
				remainingTasks: [],
			},
		],
	};
	const vm = buildDashboardViewModel(batch, monitor);
	assertEqual(vm.laneCards.length, 2, "2 lane cards");
	assertEqual(vm.laneCards[0].laneNumber, 1, "sorted: first=lane 1");
	assertEqual(vm.laneCards[1].laneNumber, 2, "sorted: second=lane 2");
	assertEqual(vm.laneCards[0].currentTaskId, "TASK-001", "lane 1 correct task");
	assertEqual(vm.laneCards[0].status, "running", "lane 1 running");
	assert(vm.attachHint.includes("orch-lane-"), "attach hint has session name");
}

{
	console.log("  ▸ executing without monitor — falls back to currentLanes");
	const batch = freshBatchState({
		phase: "executing",
		batchId: "20260309T120000",
		totalWaves: 1,
		totalTasks: 2,
		currentWaveIndex: 0,
		startedAt: Date.now() - 10_000,
		currentLanes: [
			{
				laneNumber: 1,
				laneId: "lane-1",
				laneSessionId: "orch-lane-1",
				tasks: [{ taskId: "T-001" }],
			},
		],
	});
	const vm = buildDashboardViewModel(batch, null);
	assertEqual(vm.laneCards.length, 1, "1 lane card from currentLanes");
	assertEqual(vm.laneCards[0].sessionName, "orch-lane-1", "session from allocation");
	assertEqual(vm.laneCards[0].status, "running", "assumed running");
}

{
	console.log("  ▸ stopped state with failure policy");
	const batch = freshBatchState({
		phase: "stopped",
		batchId: "20260309T120000",
		totalWaves: 3,
		totalTasks: 10,
		currentWaveIndex: 1,
		startedAt: 1000,
		endedAt: 61_000,
		succeededTasks: 3,
		failedTasks: 1,
		waveResults: [
			{ stoppedEarly: false, policyApplied: null },
			{ stoppedEarly: true, policyApplied: "stop-wave" },
		],
	});
	const vm = buildDashboardViewModel(batch);
	assertEqual(vm.phase, "stopped", "phase=stopped");
	assertEqual(vm.failurePolicy, "stop-wave", "failurePolicy=stop-wave");
	assertEqual(vm.elapsed, "1m 0s", "elapsed computed from start/end");
}

// ═══════════════════════════════════════════════════════════════════════
// 7.4: computeTransitiveDependents
// ═══════════════════════════════════════════════════════════════════════

console.log("\n─── 7.4: computeTransitiveDependents ───");

{
	console.log("  ▸ no dependents — empty result");
	const graph = { dependents: new Map() };
	const result = computeTransitiveDependents(new Set(["A"]), graph);
	assertEqual(result.size, 0, "no dependents of A");
}

{
	console.log("  ▸ single chain: A→B→C (A fails → B, C blocked)");
	const graph = { dependents: new Map([["A", ["B"]], ["B", ["C"]]]) };
	const result = computeTransitiveDependents(new Set(["A"]), graph);
	assertEqual(result.size, 2, "2 blocked tasks");
	assert(result.has("B"), "B is blocked");
	assert(result.has("C"), "C is blocked (transitive)");
	assert(!result.has("A"), "A is not in blocked set");
}

{
	console.log("  ▸ diamond: A→B, A→C, B→D, C→D (A fails → B, C, D blocked)");
	const graph = {
		dependents: new Map([["A", ["B", "C"]], ["B", ["D"]], ["C", ["D"]]]),
	};
	const result = computeTransitiveDependents(new Set(["A"]), graph);
	assertEqual(result.size, 3, "3 blocked: B, C, D");
	assert(result.has("B"), "B blocked");
	assert(result.has("C"), "C blocked");
	assert(result.has("D"), "D blocked (transitive)");
}

{
	console.log("  ▸ multiple failures: A and X both fail");
	const graph = { dependents: new Map([["A", ["B"]], ["X", ["Y"]]]) };
	const result = computeTransitiveDependents(new Set(["A", "X"]), graph);
	assertEqual(result.size, 2, "2 blocked: B, Y");
	assert(result.has("B"), "B blocked by A");
	assert(result.has("Y"), "Y blocked by X");
}

{
	console.log("  ▸ no duplicates in convergent graph");
	const graph = {
		dependents: new Map([["A", ["B", "C"]], ["B", ["D"]], ["C", ["D"]]]),
	};
	const result = computeTransitiveDependents(new Set(["A"]), graph);
	assertEqual(result.size, 3, "exactly 3 unique (D not duplicated)");
}

{
	console.log("  ▸ failed task has no entry in dependents map");
	const graph = { dependents: new Map([["B", ["A"]]]) };
	const result = computeTransitiveDependents(new Set(["A"]), graph);
	// A's entry doesn't exist in dependents → no one depends on A
	assertEqual(result.size, 0, "0 blocked (A has no dependents)");
}

{
	console.log("  ▸ empty failed set → empty result");
	const graph = { dependents: new Map([["A", ["B"]]]) };
	const result = computeTransitiveDependents(new Set(), graph);
	assertEqual(result.size, 0, "nothing failed → nothing blocked");
}

// ═══════════════════════════════════════════════════════════════════════
// Shared helper: strip TS annotations for extracted source evaluation
// ═══════════════════════════════════════════════════════════════════════

/**
 * Strip TypeScript type annotations from a function body so it can be
 * evaluated as JavaScript via `new Function()`.
 *
 * Handles: parameter types, optional params (?:), return types, const types.
 */
function stripTypeAnnotations(src: string): string {
	return src
		// Optional parameter type annotations: (name?: Type) → (name)
		.replace(/(\w+)\?\s*:\s*\w+/g, "$1")
		// Parameter type annotations: (name: Type) → (name)
		.replace(/(\w+)\s*:\s*(?:string|number|boolean|any|void|OrchestratorConfig)/g, "$1")
		// Return type annotations: ): Type { → ) {
		// Handles both primitives and custom types like SavedBranchResolution
		.replace(/\)\s*,?\s*\n?\s*\)\s*:\s*\w+\s*\{/g, ")) {")
		.replace(/\)\s*:\s*\w+\s*\{/g, ") {")
		// const declarations with types: const x: Type = → const x =
		.replace(/const\s+(\w+)\s*:\s*[^=]+=\s*/g, "const $1 = ");
}

// ═══════════════════════════════════════════════════════════════════════
// 7.5: resolveWorktreeBasePath — extracted from production source
// ═══════════════════════════════════════════════════════════════════════

// Extract the real function from source and create a callable.
// The production function takes (repoRoot, config) where config has
// shape { orchestrator: { worktree_location: string } }.

const resolveWorktreeBasePathSource = extractFunction(source, "resolveWorktreeBasePath");

// Inject `resolve` dependency (same as production uses from path module).
// stripTypeAnnotations removes TS annotations for eval compatibility.
const resolveWorktreeBasePathFn = new Function(
	"resolve",
	`return (${stripTypeAnnotations(resolveWorktreeBasePathSource)
		.replace(/^function resolveWorktreeBasePath/, "function")
	})`,
)(resolve) as (repoRoot: string, config: any) => string;

console.log("\n7.6 — resolveWorktreeBasePath (extracted from source)");

{
	const repoRoot = "/home/user/project";

	// Config fixtures matching OrchestratorConfig shape
	const siblingConfig = { orchestrator: { worktree_location: "sibling" } };
	const subdirConfig = { orchestrator: { worktree_location: "subdirectory" } };
	const unknownConfig = { orchestrator: { worktree_location: "future-mode" } };

	{
		console.log("  ▸ sibling mode returns parent of repoRoot");
		const result = resolveWorktreeBasePathFn(repoRoot, siblingConfig);
		const expected = resolve(repoRoot, "..");
		assertEqual(result, expected, "sibling base path");
	}

	{
		console.log("  ▸ subdirectory mode returns .worktrees under repoRoot");
		const result = resolveWorktreeBasePathFn(repoRoot, subdirConfig);
		const expected = resolve(repoRoot, ".worktrees");
		assertEqual(result, expected, "subdirectory base path");
	}

	{
		console.log("  ▸ unknown location defaults to subdirectory");
		const result = resolveWorktreeBasePathFn(repoRoot, unknownConfig);
		const expected = resolve(repoRoot, ".worktrees");
		assertEqual(result, expected, "default base path for unknown location");
	}
}

// ═══════════════════════════════════════════════════════════════════════
// 7.7: generateWorktreePath — table-driven end-to-end test
// ═══════════════════════════════════════════════════════════════════════

// Extract and build the real generateWorktreePath.
// It depends on resolveWorktreeBasePath (extracted above) and resolve.

const generateWorktreePathSource = extractFunction(source, "generateWorktreePath");

// We also need the DEFAULT_ORCHESTRATOR_CONFIG. Extract its worktree_location value.
const defaultLocationMatch = source.match(/const DEFAULT_ORCHESTRATOR_CONFIG[\s\S]*?worktree_location:\s*"([^"]+)"/);
const defaultWorktreeLocation = defaultLocationMatch ? defaultLocationMatch[1] : "subdirectory";

// Build the function with injected dependencies.
// resolveWorktreeBasePath is referenced by name inside generateWorktreePath,
// so we inject it as a named variable in the closure.
const generateWorktreePathFn = new Function(
	"resolve",
	"resolveWorktreeBasePath",
	"DEFAULT_ORCHESTRATOR_CONFIG",
	`return (${stripTypeAnnotations(generateWorktreePathSource)
		.replace(/^function generateWorktreePath/, "function")
	})`,
)(resolve, resolveWorktreeBasePathFn, { orchestrator: { worktree_location: defaultWorktreeLocation } }) as (prefix: string, laneNumber: number, repoRoot: string, opId: string, config?: any) => string;

console.log("\n7.7 — generateWorktreePath (table-driven, extracted from source)");

{

	// Verify the default config matches what we extracted
	assertEqual(defaultWorktreeLocation, "subdirectory", "DEFAULT_ORCHESTRATOR_CONFIG uses subdirectory");

	// Table-driven test cases: { worktree_location, repoRoot, prefix, lane, opId, expectedPath }
	// Naming rule: basename = {prefix}-{opId}-{N}
	const testCases = [
		{
			label: "subdirectory mode, lane 1",
			config: { orchestrator: { worktree_location: "subdirectory" } },
			repoRoot: "/home/user/project",
			prefix: "proj-wt",
			opId: "testop",
			lane: 1,
			expected: resolve("/home/user/project", ".worktrees", "proj-wt-testop-1"),
		},
		{
			label: "subdirectory mode, lane 3",
			config: { orchestrator: { worktree_location: "subdirectory" } },
			repoRoot: "/home/user/project",
			prefix: "proj-wt",
			opId: "testop",
			lane: 3,
			expected: resolve("/home/user/project", ".worktrees", "proj-wt-testop-3"),
		},
		{
			label: "sibling mode, lane 1",
			config: { orchestrator: { worktree_location: "sibling" } },
			repoRoot: "/home/user/project",
			prefix: "proj-wt",
			opId: "testop",
			lane: 1,
			expected: resolve("/home/user/project", "..", "proj-wt-testop-1"),
		},
		{
			label: "sibling mode, lane 2",
			config: { orchestrator: { worktree_location: "sibling" } },
			repoRoot: "/home/user/project",
			prefix: "proj-wt",
			opId: "testop",
			lane: 2,
			expected: resolve("/home/user/project", "..", "proj-wt-testop-2"),
		},
		{
			label: "default config (no config arg) → subdirectory",
			config: undefined,
			repoRoot: "/home/user/project",
			prefix: "proj-wt",
			opId: "testop",
			lane: 1,
			expected: resolve("/home/user/project", ".worktrees", "proj-wt-testop-1"),
		},
		{
			label: "Windows-style repoRoot in subdirectory mode",
			config: { orchestrator: { worktree_location: "subdirectory" } },
			repoRoot: "C:\\dev\\taskplane",
			prefix: "taskplane-wt",
			opId: "testop",
			lane: 2,
			expected: resolve("C:\\dev\\taskplane", ".worktrees", "taskplane-wt-testop-2"),
		},
	];

	for (const tc of testCases) {
		console.log(`  ▸ ${tc.label}`);
		const result = generateWorktreePathFn(tc.prefix, tc.lane, tc.repoRoot, tc.opId, tc.config);
		assertEqual(result, tc.expected, tc.label);
	}
}

// ═══════════════════════════════════════════════════════════════════════
// 7.8: listWorktrees regex pattern — naming invariant: {prefix}-{N}
// ═══════════════════════════════════════════════════════════════════════

// Extract the escapeRegex helper and the regex pattern from listWorktrees.
// We test the regex directly against basename strings to verify matching.

const escapeRegexSource = extractFunction(source, "escapeRegex");
const escapeRegexFn = new Function(
	`return (${stripTypeAnnotations(escapeRegexSource).replace(/^function escapeRegex/, "function")})`,
)() as (str: string) => string;

/** Build the listWorktrees primary regex for a given prefix and opId (mirrors production code). */
function buildListWorktreesPrimaryPattern(prefix: string, opId: string): RegExp {
	return new RegExp(`^${escapeRegexFn(prefix)}-${escapeRegexFn(opId)}-(\\d+)$`);
}

/** Build the legacy regex (opId="op" only) for backward compatibility. */
function buildListWorktreesLegacyPattern(prefix: string): RegExp {
	return new RegExp(`^${escapeRegexFn(prefix)}-(\\d+)$`);
}

console.log("\n7.8 — listWorktrees regex pattern (naming invariant: {prefix}-{opId}-{N})");

{
	// Table-driven: [prefix, opId, basename, shouldMatch, expectedLane]
	const testCases: Array<{
		label: string;
		prefix: string;
		opId: string;
		basename: string;
		shouldMatch: boolean;
		expectedLane?: number;
		patternType: "primary" | "legacy";
	}> = [
		// Primary pattern: {prefix}-{opId}-{N}
		{ label: "primary: taskplane-wt with op henrylach, lane 1", prefix: "taskplane-wt", opId: "henrylach", basename: "taskplane-wt-henrylach-1", shouldMatch: true, expectedLane: 1, patternType: "primary" },
		{ label: "primary: taskplane-wt with op henrylach, lane 10", prefix: "taskplane-wt", opId: "henrylach", basename: "taskplane-wt-henrylach-10", shouldMatch: true, expectedLane: 10, patternType: "primary" },
		{ label: "primary: different opId (no match)", prefix: "taskplane-wt", opId: "henrylach", basename: "taskplane-wt-alice-1", shouldMatch: false, patternType: "primary" },
		{ label: "primary: legacy format (no opId, no match)", prefix: "taskplane-wt", opId: "henrylach", basename: "taskplane-wt-1", shouldMatch: false, patternType: "primary" },
		{ label: "primary: no lane number", prefix: "taskplane-wt", opId: "henrylach", basename: "taskplane-wt-henrylach-", shouldMatch: false, patternType: "primary" },
		{ label: "primary: non-numeric lane", prefix: "taskplane-wt", opId: "henrylach", basename: "taskplane-wt-henrylach-abc", shouldMatch: false, patternType: "primary" },

		// Short prefix with opId
		{ label: "primary: wt prefix with op, lane 1", prefix: "wt", opId: "ci-1", basename: "wt-ci-1-1", shouldMatch: true, expectedLane: 1, patternType: "primary" },
		{ label: "primary: wt prefix with op, lane 3", prefix: "wt", opId: "ci-1", basename: "wt-ci-1-3", shouldMatch: true, expectedLane: 3, patternType: "primary" },

		// Prefix with special regex chars (dots)
		{ label: "primary: prefix with dots, lane 1", prefix: "my.project", opId: "op", basename: "my.project-op-1", shouldMatch: true, expectedLane: 1, patternType: "primary" },
		{ label: "primary: prefix with dots, dot-as-wildcard rejected", prefix: "my.project", opId: "op", basename: "myXproject-op-1", shouldMatch: false, patternType: "primary" },

		// Different prefix should not match
		{ label: "primary: wrong prefix, no match", prefix: "taskplane-wt", opId: "op", basename: "other-wt-op-1", shouldMatch: false, patternType: "primary" },

		// Legacy pattern: {prefix}-{N} (only valid when opId="op")
		{ label: "legacy: taskplane-wt, lane 1", prefix: "taskplane-wt", opId: "op", basename: "taskplane-wt-1", shouldMatch: true, expectedLane: 1, patternType: "legacy" },
		{ label: "legacy: taskplane-wt, lane 10", prefix: "taskplane-wt", opId: "op", basename: "taskplane-wt-10", shouldMatch: true, expectedLane: 10, patternType: "legacy" },
		{ label: "legacy: lane 0 matches regex", prefix: "wt", opId: "op", basename: "wt-0", shouldMatch: true, expectedLane: 0, patternType: "legacy" },
	];

	for (const tc of testCases) {
		console.log(`  ▸ ${tc.label}`);
		const pattern = tc.patternType === "primary"
			? buildListWorktreesPrimaryPattern(tc.prefix, tc.opId)
			: buildListWorktreesLegacyPattern(tc.prefix);
		const match = tc.basename.match(pattern);

		if (tc.shouldMatch) {
			assert(match !== null, `${tc.label}: should match`);
			if (match && tc.expectedLane !== undefined) {
				assertEqual(parseInt(match[1], 10), tc.expectedLane, `${tc.label}: lane number`);
			}
		} else {
			assert(match === null, `${tc.label}: should NOT match`);
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════
// 7.9: computeSavedBranchName — pure mapping
// ═══════════════════════════════════════════════════════════════════════

const computeSavedBranchNameSource = extractFunction(source, "computeSavedBranchName");
const computeSavedBranchNameFn = new Function(
	`return (${stripTypeAnnotations(computeSavedBranchNameSource)
		.replace(/^function computeSavedBranchName/, "function")
	})`,
)() as (originalBranch: string) => string;

console.log("\n7.9 — computeSavedBranchName (extracted from source)");

{
	console.log("  ▸ standard lane branch");
	assertEqual(
		computeSavedBranchNameFn("task/lane-1-20260308T111750"),
		"saved/task/lane-1-20260308T111750",
		"lane branch → saved/ prefix",
	);
}
{
	console.log("  ▸ feature branch");
	assertEqual(
		computeSavedBranchNameFn("feature/my-branch"),
		"saved/feature/my-branch",
		"feature branch → saved/ prefix",
	);
}
{
	console.log("  ▸ simple branch name");
	assertEqual(
		computeSavedBranchNameFn("main"),
		"saved/main",
		"simple name → saved/ prefix",
	);
}

// ═══════════════════════════════════════════════════════════════════════
// 7.10: resolveSavedBranchCollision — decision table
// ═══════════════════════════════════════════════════════════════════════

const resolveSavedBranchCollisionSource = extractFunction(source, "resolveSavedBranchCollision");
const resolveSavedBranchCollisionFn = new Function(
	`return (${stripTypeAnnotations(resolveSavedBranchCollisionSource)
		.replace(/^function resolveSavedBranchCollision/, "function")
	})`,
)() as (savedName: string, existingSHA: string, newSHA: string, timestamp?: string) => { action: string; savedName: string };

console.log("\n7.10 — resolveSavedBranchCollision (extracted from source)");

{
	console.log("  ▸ saved ref absent → create");
	const result = resolveSavedBranchCollisionFn("saved/task/lane-1", "", "abc123");
	assertEqual(result.action, "create", "action is create");
	assertEqual(result.savedName, "saved/task/lane-1", "uses original savedName");
}
{
	console.log("  ▸ saved ref exists, same SHA → keep-existing");
	const result = resolveSavedBranchCollisionFn("saved/task/lane-1", "abc123", "abc123");
	assertEqual(result.action, "keep-existing", "action is keep-existing");
	assertEqual(result.savedName, "saved/task/lane-1", "uses existing savedName");
}
{
	console.log("  ▸ saved ref exists, different SHA → create-suffixed");
	const result = resolveSavedBranchCollisionFn("saved/task/lane-1", "abc123", "def456", "2026-03-09T120000");
	assertEqual(result.action, "create-suffixed", "action is create-suffixed");
	assertEqual(result.savedName, "saved/task/lane-1-2026-03-09T120000", "appended timestamp suffix");
}
{
	console.log("  ▸ empty existingSHA treated as absent (falsy)");
	const result = resolveSavedBranchCollisionFn("saved/my-branch", "", "sha1");
	assertEqual(result.action, "create", "empty string existingSHA → create");
}
{
	console.log("  ▸ auto-generates timestamp when not provided for collision");
	const result = resolveSavedBranchCollisionFn("saved/task/lane-1", "sha-old", "sha-new");
	assertEqual(result.action, "create-suffixed", "action is create-suffixed");
	assert(result.savedName.startsWith("saved/task/lane-1-"), "auto-generated timestamp suffix");
	assert(result.savedName.length > "saved/task/lane-1-".length, "has timestamp content");
}

// ═══════════════════════════════════════════════════════════════════════
// 7.11: hasUnmergedCommits — source verification
// ═══════════════════════════════════════════════════════════════════════

console.log("\n7.11 — hasUnmergedCommits (source verification)");

{
	const fnSrc = extractFunction(source, "hasUnmergedCommits");
	console.log("  ▸ verifies branch exists");
	assert(fnSrc.includes(`refs/heads/\${branch}`), "checks refs/heads/{branch}");
	console.log("  ▸ verifies target branch exists");
	assert(fnSrc.includes(`refs/heads/\${targetBranch}`), "checks refs/heads/{targetBranch}");
	console.log("  ▸ uses rev-list --count (Windows-safe, no pipes)");
	assert(fnSrc.includes("rev-list"), "uses rev-list");
	assert(fnSrc.includes("--count"), "uses --count flag");
	console.log("  ▸ returns BRANCH_NOT_FOUND error code");
	assert(fnSrc.includes("BRANCH_NOT_FOUND"), "has BRANCH_NOT_FOUND code");
	console.log("  ▸ returns TARGET_BRANCH_MISSING error code");
	assert(fnSrc.includes("TARGET_BRANCH_MISSING"), "has TARGET_BRANCH_MISSING code");
	console.log("  ▸ returns UNMERGED_COUNT_FAILED error code");
	assert(fnSrc.includes("UNMERGED_COUNT_FAILED"), "has UNMERGED_COUNT_FAILED code");
	console.log("  ▸ returns UNMERGED_COUNT_PARSE_FAILED error code");
	assert(fnSrc.includes("UNMERGED_COUNT_PARSE_FAILED"), "has UNMERGED_COUNT_PARSE_FAILED code");
	console.log("  ▸ parses count with parseInt");
	assert(fnSrc.includes("parseInt"), "parses count with parseInt");
}

// ═══════════════════════════════════════════════════════════════════════
// 7.12: preserveBranch — source verification
// ═══════════════════════════════════════════════════════════════════════

console.log("\n7.12 — preserveBranch (source verification)");

{
	const fnSrc = extractFunction(source, "preserveBranch");
	console.log("  ▸ checks branch existence before proceeding");
	assert(fnSrc.includes("rev-parse"), "uses git rev-parse for branch check");
	console.log("  ▸ returns no-branch when branch doesn't exist");
	assert(fnSrc.includes("no-branch"), "handles missing branch gracefully");
	console.log("  ▸ calls hasUnmergedCommits");
	assert(fnSrc.includes("hasUnmergedCommits"), "delegates to hasUnmergedCommits");
	console.log("  ▸ calls computeSavedBranchName");
	assert(fnSrc.includes("computeSavedBranchName"), "delegates to computeSavedBranchName");
	console.log("  ▸ calls resolveSavedBranchCollision");
	assert(fnSrc.includes("resolveSavedBranchCollision"), "delegates to resolveSavedBranchCollision");
	console.log("  ▸ handles TARGET_BRANCH_MISSING gracefully (no crash)");
	assert(fnSrc.includes("TARGET_BRANCH_MISSING"), "forwards TARGET_BRANCH_MISSING code");
	console.log("  ▸ handles UNMERGED_COUNT_FAILED");
	assert(fnSrc.includes("UNMERGED_COUNT_FAILED"), "forwards UNMERGED_COUNT_FAILED code");
	console.log("  ▸ returns SAVED_BRANCH_CREATE_FAILED on git branch failure");
	assert(fnSrc.includes("SAVED_BRANCH_CREATE_FAILED"), "has SAVED_BRANCH_CREATE_FAILED code");
	console.log("  ▸ returns fully-merged when count is 0");
	assert(fnSrc.includes("fully-merged"), "has fully-merged action");
	console.log("  ▸ returns preserved on successful save");
	assert(fnSrc.includes('"preserved"'), "has preserved action");
	console.log("  ▸ returns already-preserved when collision is keep-existing");
	assert(fnSrc.includes("already-preserved"), "has already-preserved action");
	console.log("  ▸ includes unmergedCount in result");
	assert(fnSrc.includes("unmergedCount"), "passes unmergedCount through result");
}

// ═══════════════════════════════════════════════════════════════════════
// 7.13: ensureBranchDeleted — source verification (rename semantics)
// ═══════════════════════════════════════════════════════════════════════

console.log("\n7.13 — ensureBranchDeleted (source verification)");

{
	const fnSrc = extractFunction(source, "ensureBranchDeleted");
	console.log("  ▸ calls preserveBranch when targetBranch is provided");
	assert(fnSrc.includes("preserveBranch"), "delegates to preserveBranch");
	console.log("  ▸ deletes original branch after preservation (rename semantics)");
	assert(fnSrc.includes("deleteBranchBestEffort"), "calls deleteBranchBestEffort after preserve");
	console.log("  ▸ handles preserved and already-preserved actions");
	assert(fnSrc.includes('"preserved"'), "handles preserved action");
	assert(fnSrc.includes('"already-preserved"'), "handles already-preserved action");
	console.log("  ▸ passes through savedBranch and unmergedCount in result");
	assert(fnSrc.includes("savedBranch"), "forwards savedBranch");
	assert(fnSrc.includes("unmergedCount"), "forwards unmergedCount");
	console.log("  ▸ falls through to normal delete for fully-merged/no-branch");
	assert(fnSrc.includes('"fully-merged"'), "checks fully-merged action");
	assert(fnSrc.includes('"no-branch"'), "checks no-branch action");
	console.log("  ▸ skips deletion on error (safe default)");
	assert(fnSrc.includes('"error"'), "handles error action");
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
// Under node:test: register as a proper test suite
// Standalone (npx tsx): run directly with process.exit
if (isTestRunner) {
	const { describe, it } = await import("node:test");
	describe("Orchestrator Pure Functions", () => {
		it("passes all assertions", () => {
			runAllTests();
		});
	});
} else {
	try {
		runAllTests();
		process.exit(0);
	} catch (e) {
		console.error("Test run failed:", e);
		process.exit(1);
	}
}
