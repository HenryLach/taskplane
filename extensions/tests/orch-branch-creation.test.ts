/**
 * Orchestrator Branch Creation Tests — TP-022 Step 1
 *
 * Verifies the orch branch lifecycle at batch start:
 *   - Branch name follows `orch/{opId}-{batchId}` contract
 *   - Branch creation is positioned after all planning-phase validations
 *     (no orphan orch branches on early exits)
 *   - Failure path sets phase="failed" and pushes descriptive error
 *   - batchState.orchBranch is set on success
 *
 * These are source-level structural tests (read engine.ts and verify code
 * patterns) because executeOrchBatch depends on pi-tui, git, tmux, and
 * file system side effects that cannot be imported or mocked in this
 * test harness.
 *
 * Run: npx vitest run extensions/tests/orch-branch-creation.test.ts
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// ── Load source files ────────────────────────────────────────────────

const engineSource = readFileSync(
	join(__dirname, "..", "taskplane", "engine.ts"),
	"utf8",
);

const namingSource = readFileSync(
	join(__dirname, "..", "taskplane", "naming.ts"),
	"utf8",
);

// ── Helper: extract line numbers for patterns ────────────────────────

function findLineNumber(source: string, pattern: RegExp): number {
	const lines = source.split("\n");
	for (let i = 0; i < lines.length; i++) {
		if (pattern.test(lines[i])) return i + 1; // 1-indexed
	}
	return -1;
}

function findAllLineNumbers(source: string, pattern: RegExp): number[] {
	const lines = source.split("\n");
	const result: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (pattern.test(lines[i])) result.push(i + 1);
	}
	return result;
}

// ── Tests ─────────────────────────────────────────────────────────────

function runAllTests(): void {
	console.log("\n── TP-022 Step 1: Orch Branch Creation Tests ──\n");

	// ── 1.1 Branch name format ───────────────────────────────────

	console.log("  1.1 Branch name format");

	{
		// Verify the branch name is constructed as orch/{opId}-{batchId}
		const nameMatch = engineSource.match(
			/const\s+orchBranch\s*=\s*`orch\/\$\{(\w+)\}-\$\{([^}]+)\}`/,
		);
		assert(nameMatch !== null, "orchBranch uses template literal with orch/{opId}-{batchId} format");

		if (nameMatch) {
			assertEqual(nameMatch[1], "opId", "first interpolation is opId");
			assert(
				nameMatch[2].includes("batchId") || nameMatch[2].includes("batchState.batchId"),
				"second interpolation references batchId",
			);
		}
	}

	{
		// Verify opId comes from resolveOperatorId
		const opIdMatch = engineSource.match(
			/const\s+opId\s*=\s*resolveOperatorId\s*\(\s*orchConfig\s*\)/,
		);
		assert(opIdMatch !== null, "opId is resolved via resolveOperatorId(orchConfig)");
	}

	{
		// Verify resolveOperatorId never returns empty string (FALLBACK = "op")
		assert(
			namingSource.includes('const FALLBACK = "op"'),
			"resolveOperatorId has non-empty fallback 'op'",
		);
		assert(
			namingSource.includes("return FALLBACK"),
			"resolveOperatorId returns fallback when all sources fail",
		);
	}

	// ── 1.2 Branch creation uses runGit ──────────────────────────

	console.log("  1.2 Branch creation via runGit");

	{
		const createMatch = engineSource.match(
			/runGit\s*\(\s*\[\s*"branch"\s*,\s*orchBranch\s*,\s*batchState\.baseBranch\s*\]\s*,\s*repoRoot\s*\)/,
		);
		assert(
			createMatch !== null,
			'orch branch created via runGit(["branch", orchBranch, baseBranch], repoRoot)',
		);
	}

	// ── 1.3 Failure path handling ────────────────────────────────

	console.log("  1.3 Failure path handling");

	{
		// After runGit call, check for failure handling block
		const failureBlock = engineSource.includes('if (!branchResult.ok)');
		assert(failureBlock, "branch creation checks branchResult.ok for failure");
	}

	{
		// Verify failure sets phase = "failed"
		// Extract the block after `if (!branchResult.ok)` up to the closing brace
		const failMatch = engineSource.match(
			/if\s*\(!branchResult\.ok\)\s*\{([\s\S]*?)^\t\}/m,
		);
		assert(failMatch !== null, "failure block is present after branchResult.ok check");

		if (failMatch) {
			const failBlock = failMatch[1];
			assert(
				failBlock.includes('batchState.phase = "failed"'),
				"failure sets batchState.phase to 'failed'",
			);
			assert(
				failBlock.includes("batchState.endedAt = Date.now()"),
				"failure sets batchState.endedAt",
			);
			assert(
				failBlock.includes("batchState.errors.push("),
				"failure pushes error message to batchState.errors",
			);
			assert(
				failBlock.includes("onNotify("),
				"failure calls onNotify with error message",
			);
			assert(
				failBlock.includes("return;"),
				"failure returns early from function",
			);
		}
	}

	{
		// Verify error message includes the branch name for debuggability
		assert(
			engineSource.includes("Failed to create orch branch"),
			"failure error message includes descriptive text",
		);
		assert(
			engineSource.includes("${orchBranch}") || engineSource.includes("'${orchBranch}'"),
			"failure error message includes orchBranch name",
		);
	}

	// ── 1.4 State assignment on success ──────────────────────────

	console.log("  1.4 State assignment on success");

	{
		assert(
			engineSource.includes("batchState.orchBranch = orchBranch"),
			"orchBranch is stored in batchState.orchBranch on success",
		);
	}

	{
		// Verify execLog is called after branch creation
		const logMatch = engineSource.match(
			/execLog\s*\(\s*"batch"\s*,\s*batchState\.batchId\s*,\s*"created orch branch"/,
		);
		assert(logMatch !== null, "execLog records orch branch creation");
	}

	// ── 1.5 Position: after all planning-phase validations ──────

	console.log("  1.5 No orphan branches on planning early exits");

	{
		// Key structural invariant: the orch branch creation MUST come AFTER
		// all planning-phase early returns. This prevents orphan orch branches
		// when preflight, discovery, graph validation, or wave computation fails.

		const orchCreationLine = findLineNumber(
			engineSource,
			/const\s+orchBranch\s*=\s*`orch\//,
		);
		assert(orchCreationLine > 0, "orchBranch assignment line found in engine.ts");

		// Planning-phase early return markers
		const preflightReturnLine = findLineNumber(
			engineSource,
			/Preflight check failed/,
		);
		const fatalDiscoveryReturnLine = findLineNumber(
			engineSource,
			/Discovery had fatal errors/,
		);
		const noPendingReturnLine = findLineNumber(
			engineSource,
			/No pending tasks found/,
		);
		const graphValidationReturnLine = findLineNumber(
			engineSource,
			/Graph validation failed/,
		);
		const waveComputationReturnLine = findLineNumber(
			engineSource,
			/Wave computation failed/,
		);

		// All planning gates must be BEFORE orch branch creation
		assert(
			preflightReturnLine > 0 && preflightReturnLine < orchCreationLine,
			`preflight failure (L${preflightReturnLine}) is before orch branch creation (L${orchCreationLine})`,
		);
		assert(
			fatalDiscoveryReturnLine > 0 && fatalDiscoveryReturnLine < orchCreationLine,
			`fatal discovery failure (L${fatalDiscoveryReturnLine}) is before orch branch creation (L${orchCreationLine})`,
		);
		assert(
			noPendingReturnLine > 0 && noPendingReturnLine < orchCreationLine,
			`no-pending-tasks exit (L${noPendingReturnLine}) is before orch branch creation (L${orchCreationLine})`,
		);
		assert(
			graphValidationReturnLine > 0 && graphValidationReturnLine < orchCreationLine,
			`graph validation failure (L${graphValidationReturnLine}) is before orch branch creation (L${orchCreationLine})`,
		);
		assert(
			waveComputationReturnLine > 0 && waveComputationReturnLine < orchCreationLine,
			`wave computation failure (L${waveComputationReturnLine}) is before orch branch creation (L${orchCreationLine})`,
		);
	}

	{
		// Verify the Phase 2 marker comes AFTER orch branch creation
		const orchCreationLine = findLineNumber(
			engineSource,
			/batchState\.orchBranch\s*=\s*orchBranch/,
		);
		const phase2Line = findLineNumber(
			engineSource,
			/Phase 2.*Wave Execution/,
		);
		assert(
			orchCreationLine > 0 && phase2Line > 0 && orchCreationLine < phase2Line,
			`orchBranch assignment (L${orchCreationLine}) is before Phase 2 start (L${phase2Line})`,
		);
	}

	{
		// Verify there are no early returns between orch branch creation success
		// and Phase 2 start (only the branch creation failure return is allowed)
		const lines = engineSource.split("\n");
		const orchAssignLine = findLineNumber(
			engineSource,
			/batchState\.orchBranch\s*=\s*orchBranch/,
		);
		const phase2Line = findLineNumber(
			engineSource,
			/Phase 2.*Wave Execution/,
		);

		// Count returns between orchBranch assignment and Phase 2
		let returnsBetween = 0;
		for (let i = orchAssignLine; i < phase2Line - 1; i++) {
			if (/^\s*return;/.test(lines[i])) {
				returnsBetween++;
			}
		}
		assertEqual(
			returnsBetween,
			0,
			"no early returns between orchBranch assignment and Phase 2 start",
		);
	}

	// ── 1.6 Orch branch comment documents positioning rationale ─

	console.log("  1.6 Code comment documents deferred creation rationale");

	{
		assert(
			engineSource.includes("after all planning validations pass") ||
			engineSource.includes("avoid orphan branches on") ||
			engineSource.includes("planning-phase early exits"),
			"comment explains why orch branch creation is deferred past planning gates",
		);
	}

	// ── 1.7 resolveOperatorId import ─────────────────────────────

	console.log("  1.7 resolveOperatorId is imported from naming module");

	{
		assert(
			engineSource.includes('import { resolveOperatorId }') ||
			engineSource.includes('resolveOperatorId'),
			"engine.ts imports resolveOperatorId",
		);
		assert(
			engineSource.includes('from "./naming.ts"') ||
			engineSource.includes("from './naming.ts'"),
			"resolveOperatorId is imported from naming.ts",
		);
	}

	// ── Summary ──────────────────────────────────────────────────

	console.log(`\nResults: ${passed} passed, ${failed} failed`);
	if (failures.length > 0) {
		console.error("\nFailures:");
		for (const f of failures) console.error(`  - ${f}`);
	}
	if (failed > 0) throw new Error(`${failed} test(s) failed`);
}

// ── Dual-mode execution ──────────────────────────────────────────────

if (isVitest) {
	const { describe, it } = await import("vitest");
	describe("Orch Branch Creation (TP-022 Step 1)", () => {
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
