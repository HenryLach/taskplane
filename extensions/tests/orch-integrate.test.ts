/**
 * Orchestrator Integrate Command Tests — TP-023
 *
 * Tests for:
 * - parseIntegrateArgs() — pure argument parser
 * - resolveIntegrationContext() — pure context resolution with dependency injection
 *
 * Run: npx vitest run extensions/tests/orch-integrate.test.ts
 */

import { describe, it, expect } from "vitest";
import { parseIntegrateArgs, resolveIntegrationContext } from "../taskplane/extension.ts";
import type { IntegrateArgs, IntegrationDeps, IntegrationContext, IntegrationContextError } from "../taskplane/extension.ts";
import { StateFileError } from "../taskplane/types.ts";
import type { PersistedBatchState, OrchBatchPhase } from "../taskplane/types.ts";

// ── Helpers ───────────────────────────────────────────────────────────

/** Assert successful parse with expected values */
function expectSuccess(result: ReturnType<typeof parseIntegrateArgs>, expected: IntegrateArgs) {
	expect(result).not.toHaveProperty("error");
	const args = result as IntegrateArgs;
	expect(args.mode).toBe(expected.mode);
	expect(args.force).toBe(expected.force);
	expect(args.orchBranchArg).toBe(expected.orchBranchArg);
}

/** Assert parse error containing expected substring */
function expectError(result: ReturnType<typeof parseIntegrateArgs>, substring: string) {
	expect(result).toHaveProperty("error");
	const err = result as { error: string };
	expect(err.error).toContain(substring);
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Default mode (no arguments)
// ═══════════════════════════════════════════════════════════════════════

describe("parseIntegrateArgs — defaults", () => {
	it("returns ff mode with no arguments (undefined)", () => {
		expectSuccess(parseIntegrateArgs(undefined), {
			mode: "ff",
			force: false,
			orchBranchArg: undefined,
		});
	});

	it("returns ff mode with empty string", () => {
		expectSuccess(parseIntegrateArgs(""), {
			mode: "ff",
			force: false,
			orchBranchArg: undefined,
		});
	});

	it("returns ff mode with whitespace-only input", () => {
		expectSuccess(parseIntegrateArgs("   "), {
			mode: "ff",
			force: false,
			orchBranchArg: undefined,
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Mode flags
// ═══════════════════════════════════════════════════════════════════════

describe("parseIntegrateArgs — mode flags", () => {
	it("--merge sets mode to merge", () => {
		expectSuccess(parseIntegrateArgs("--merge"), {
			mode: "merge",
			force: false,
			orchBranchArg: undefined,
		});
	});

	it("--pr sets mode to pr", () => {
		expectSuccess(parseIntegrateArgs("--pr"), {
			mode: "pr",
			force: false,
			orchBranchArg: undefined,
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 3. --force flag
// ═══════════════════════════════════════════════════════════════════════

describe("parseIntegrateArgs — force flag", () => {
	it("--force alone sets force=true, mode stays ff", () => {
		expectSuccess(parseIntegrateArgs("--force"), {
			mode: "ff",
			force: true,
			orchBranchArg: undefined,
		});
	});

	it("--force with --merge", () => {
		expectSuccess(parseIntegrateArgs("--merge --force"), {
			mode: "merge",
			force: true,
			orchBranchArg: undefined,
		});
	});

	it("--force with --pr", () => {
		expectSuccess(parseIntegrateArgs("--pr --force"), {
			mode: "pr",
			force: true,
			orchBranchArg: undefined,
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Mutual exclusion (--merge + --pr)
// ═══════════════════════════════════════════════════════════════════════

describe("parseIntegrateArgs — mutual exclusion", () => {
	it("rejects --merge and --pr together", () => {
		expectError(parseIntegrateArgs("--merge --pr"), "Cannot use --merge and --pr together");
	});

	it("rejects --pr and --merge together (reversed order)", () => {
		expectError(parseIntegrateArgs("--pr --merge"), "Cannot use --merge and --pr together");
	});

	it("rejects --merge --pr --force together", () => {
		expectError(parseIntegrateArgs("--merge --pr --force"), "Cannot use --merge and --pr together");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Unknown flags
// ═══════════════════════════════════════════════════════════════════════

describe("parseIntegrateArgs — unknown flags", () => {
	it("rejects unknown flag --foo", () => {
		expectError(parseIntegrateArgs("--foo"), "Unknown flag: --foo");
	});

	it("rejects unknown flag --verbose", () => {
		expectError(parseIntegrateArgs("--verbose"), "Unknown flag: --verbose");
	});

	it("rejects unknown flag mixed with valid flags", () => {
		expectError(parseIntegrateArgs("--merge --unknown"), "Unknown flag: --unknown");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 6. Optional branch argument (positional)
// ═══════════════════════════════════════════════════════════════════════

describe("parseIntegrateArgs — branch argument", () => {
	it("captures single branch argument", () => {
		expectSuccess(parseIntegrateArgs("orch/op-abc123"), {
			mode: "ff",
			force: false,
			orchBranchArg: "orch/op-abc123",
		});
	});

	it("captures branch argument with --merge flag", () => {
		expectSuccess(parseIntegrateArgs("orch/op-abc123 --merge"), {
			mode: "merge",
			force: false,
			orchBranchArg: "orch/op-abc123",
		});
	});

	it("captures branch argument after flags", () => {
		expectSuccess(parseIntegrateArgs("--pr --force orch/my-branch"), {
			mode: "pr",
			force: true,
			orchBranchArg: "orch/my-branch",
		});
	});

	it("captures branch argument between flags", () => {
		expectSuccess(parseIntegrateArgs("--force orch/op-xyz --merge"), {
			mode: "merge",
			force: true,
			orchBranchArg: "orch/op-xyz",
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 7. Multiple positional arguments (rejected)
// ═══════════════════════════════════════════════════════════════════════

describe("parseIntegrateArgs — multiple positionals", () => {
	it("rejects two positional arguments", () => {
		expectError(parseIntegrateArgs("branch1 branch2"), "Expected at most one branch argument, got 2");
	});

	it("rejects three positional arguments", () => {
		expectError(parseIntegrateArgs("a b c"), "Expected at most one branch argument, got 3");
	});

	it("rejects multiple positionals with flags mixed in", () => {
		expectError(parseIntegrateArgs("branch1 --force branch2"), "Expected at most one branch argument, got 2");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 8. Combined scenarios
// ═══════════════════════════════════════════════════════════════════════

describe("parseIntegrateArgs — combined scenarios", () => {
	it("all valid args together: branch + --merge + --force", () => {
		expectSuccess(parseIntegrateArgs("orch/op-batch123 --merge --force"), {
			mode: "merge",
			force: true,
			orchBranchArg: "orch/op-batch123",
		});
	});

	it("all valid args together: branch + --pr + --force", () => {
		expectSuccess(parseIntegrateArgs("--force --pr orch/op-batch123"), {
			mode: "pr",
			force: true,
			orchBranchArg: "orch/op-batch123",
		});
	});

	it("error messages include the offending value", () => {
		const result = parseIntegrateArgs("--badopt");
		expect(result).toHaveProperty("error");
		expect((result as { error: string }).error).toContain("--badopt");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// resolveIntegrationContext — pure context resolution tests
// ═══════════════════════════════════════════════════════════════════════

/** Create a minimal PersistedBatchState for testing */
function makeBatchState(overrides: Partial<PersistedBatchState> = {}): PersistedBatchState {
	return {
		schemaVersion: 2,
		phase: "completed",
		batchId: "20260318T140000",
		baseBranch: "main",
		orchBranch: "orch/henry-20260318T140000",
		mode: "repo",
		startedAt: Date.now(),
		updatedAt: Date.now(),
		endedAt: Date.now(),
		currentWaveIndex: 0,
		totalWaves: 1,
		wavePlan: [["TASK-001"]],
		lanes: [],
		tasks: [],
		mergeResults: [],
		totalTasks: 1,
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

/** Create default deps where everything succeeds (completed state, on main) */
function makeDeps(overrides: Partial<IntegrationDeps> = {}): IntegrationDeps {
	return {
		loadBatchState: () => makeBatchState(),
		getCurrentBranch: () => "main",
		listOrchBranches: () => [],
		orchBranchExists: () => true,
		...overrides,
	};
}

/** Default parsed args (ff mode, no force, no branch arg) */
function defaultParsed(overrides: Partial<IntegrateArgs> = {}): IntegrateArgs {
	return { mode: "ff", force: false, orchBranchArg: undefined, ...overrides };
}

/** Assert result is a successful IntegrationContext */
function expectContext(result: IntegrationContext | IntegrationContextError): IntegrationContext {
	expect(result).not.toHaveProperty("error");
	expect(result).toHaveProperty("orchBranch");
	expect(result).toHaveProperty("currentBranch");
	return result as IntegrationContext;
}

/** Assert result is an IntegrationContextError */
function expectContextError(
	result: IntegrationContext | IntegrationContextError,
	substringOrSeverity?: string,
): IntegrationContextError {
	expect(result).toHaveProperty("error");
	const err = result as IntegrationContextError;
	if (substringOrSeverity === "info" || substringOrSeverity === "error") {
		expect(err.severity).toBe(substringOrSeverity);
	} else if (substringOrSeverity) {
		expect(err.error).toContain(substringOrSeverity);
	}
	return err;
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Phase gating
// ═══════════════════════════════════════════════════════════════════════

describe("resolveIntegrationContext — phase gating", () => {
	it("succeeds when phase is completed", () => {
		const result = resolveIntegrationContext(defaultParsed(), makeDeps());
		const ctx = expectContext(result);
		expect(ctx.orchBranch).toBe("orch/henry-20260318T140000");
		expect(ctx.baseBranch).toBe("main");
		expect(ctx.batchId).toBe("20260318T140000");
		expect(ctx.currentBranch).toBe("main");
	});

	const nonCompletedPhases: OrchBatchPhase[] = ["idle", "planning", "executing", "merging", "paused", "stopped", "failed"];
	for (const phase of nonCompletedPhases) {
		it(`rejects phase "${phase}" with info severity`, () => {
			const deps = makeDeps({
				loadBatchState: () => makeBatchState({ phase }),
			});
			const result = resolveIntegrationContext(defaultParsed(), deps);
			const err = expectContextError(result, "info");
			expect(err.error).toContain(`"${phase}" phase`);
			expect(err.error).toContain("Integration requires a completed batch");
		});
	}
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Legacy merge mode (empty orchBranch)
// ═══════════════════════════════════════════════════════════════════════

describe("resolveIntegrationContext — legacy merge mode", () => {
	it("detects legacy mode when orchBranch is empty string", () => {
		const deps = makeDeps({
			loadBatchState: () => makeBatchState({ orchBranch: "" }),
		});
		const result = resolveIntegrationContext(defaultParsed(), deps);
		const err = expectContextError(result, "info");
		expect(err.error).toContain("legacy merge mode");
	});

	it("includes baseBranch in legacy mode message", () => {
		const deps = makeDeps({
			loadBatchState: () => makeBatchState({ orchBranch: "", baseBranch: "develop" }),
		});
		const result = resolveIntegrationContext(defaultParsed(), deps);
		const err = expectContextError(result);
		expect(err.error).toContain("develop");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 3. State fallback branches
// ═══════════════════════════════════════════════════════════════════════

describe("resolveIntegrationContext — no state + branch scan", () => {
	it("returns error when no state, no arg, and 0 orch branches", () => {
		const deps = makeDeps({
			loadBatchState: () => null,
			listOrchBranches: () => [],
		});
		const result = resolveIntegrationContext(defaultParsed(), deps);
		const err = expectContextError(result, "error");
		expect(err.error).toContain("No completed batch found");
	});

	it("auto-detects single orch branch when no state and no arg", () => {
		const deps = makeDeps({
			loadBatchState: () => null,
			listOrchBranches: () => ["orch/auto-detected"],
			orchBranchExists: () => true,
		});
		const result = resolveIntegrationContext(defaultParsed(), deps);
		const ctx = expectContext(result);
		expect(ctx.orchBranch).toBe("orch/auto-detected");
		expect(ctx.notices.some(n => n.includes("Auto-detected"))).toBe(true);
	});

	it("returns error when no state, no arg, and multiple orch branches", () => {
		const deps = makeDeps({
			loadBatchState: () => null,
			listOrchBranches: () => ["orch/branch-a", "orch/branch-b"],
		});
		const result = resolveIntegrationContext(defaultParsed(), deps);
		const err = expectContextError(result, "error");
		expect(err.error).toContain("multiple orch branches");
		expect(err.error).toContain("orch/branch-a");
		expect(err.error).toContain("orch/branch-b");
	});

	it("uses CLI branch arg when no state available", () => {
		const deps = makeDeps({
			loadBatchState: () => null,
			orchBranchExists: () => true,
		});
		const result = resolveIntegrationContext(
			defaultParsed({ orchBranchArg: "orch/my-branch" }),
			deps,
		);
		const ctx = expectContext(result);
		expect(ctx.orchBranch).toBe("orch/my-branch");
		// baseBranch inferred from currentBranch when state is unavailable
		expect(ctx.baseBranch).toBe("main");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 4. StateFileError handling
// ═══════════════════════════════════════════════════════════════════════

describe("resolveIntegrationContext — StateFileError", () => {
	it("returns error on IO error without branch arg", () => {
		const deps = makeDeps({
			loadBatchState: () => { throw new StateFileError("STATE_FILE_IO_ERROR", "permission denied"); },
		});
		const result = resolveIntegrationContext(defaultParsed(), deps);
		const err = expectContextError(result, "error");
		expect(err.error).toContain("Could not read batch state file");
	});

	it("returns error on parse error without branch arg", () => {
		const deps = makeDeps({
			loadBatchState: () => { throw new StateFileError("STATE_FILE_PARSE_ERROR", "unexpected token"); },
		});
		const result = resolveIntegrationContext(defaultParsed(), deps);
		const err = expectContextError(result, "error");
		expect(err.error).toContain("invalid JSON");
	});

	it("returns error on schema error without branch arg", () => {
		const deps = makeDeps({
			loadBatchState: () => { throw new StateFileError("STATE_SCHEMA_INVALID", "missing batchId"); },
		});
		const result = resolveIntegrationContext(defaultParsed(), deps);
		const err = expectContextError(result, "error");
		expect(err.error).toContain("invalid schema");
	});

	it("falls back to branch arg on IO error when arg provided", () => {
		const deps = makeDeps({
			loadBatchState: () => { throw new StateFileError("STATE_FILE_IO_ERROR", "permission denied"); },
			orchBranchExists: () => true,
		});
		const result = resolveIntegrationContext(
			defaultParsed({ orchBranchArg: "orch/fallback" }),
			deps,
		);
		const ctx = expectContext(result);
		expect(ctx.orchBranch).toBe("orch/fallback");
		expect(ctx.notices.some(n => n.includes("Could not read"))).toBe(true);
	});

	it("falls back to branch arg on parse error when arg provided", () => {
		const deps = makeDeps({
			loadBatchState: () => { throw new StateFileError("STATE_FILE_PARSE_ERROR", "bad json"); },
			orchBranchExists: () => true,
		});
		const result = resolveIntegrationContext(
			defaultParsed({ orchBranchArg: "orch/fallback" }),
			deps,
		);
		const ctx = expectContext(result);
		expect(ctx.orchBranch).toBe("orch/fallback");
	});

	it("falls back to branch arg on non-StateFileError when arg provided", () => {
		const deps = makeDeps({
			loadBatchState: () => { throw new Error("something unexpected"); },
			orchBranchExists: () => true,
		});
		const result = resolveIntegrationContext(
			defaultParsed({ orchBranchArg: "orch/fallback" }),
			deps,
		);
		const ctx = expectContext(result);
		expect(ctx.orchBranch).toBe("orch/fallback");
	});

	it("returns error on non-StateFileError without branch arg", () => {
		const deps = makeDeps({
			loadBatchState: () => { throw new Error("unknown failure"); },
		});
		const result = resolveIntegrationContext(defaultParsed(), deps);
		const err = expectContextError(result, "error");
		expect(err.error).toContain("Unexpected error");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 5. Branch existence check
// ═══════════════════════════════════════════════════════════════════════

describe("resolveIntegrationContext — branch existence", () => {
	it("returns error when orch branch does not exist locally", () => {
		const deps = makeDeps({
			orchBranchExists: () => false,
		});
		const result = resolveIntegrationContext(defaultParsed(), deps);
		const err = expectContextError(result, "error");
		expect(err.error).toContain("does not exist locally");
	});

	it("passes orchBranch to orchBranchExists for verification", () => {
		let checkedBranch = "";
		const deps = makeDeps({
			orchBranchExists: (b) => { checkedBranch = b; return true; },
		});
		resolveIntegrationContext(defaultParsed(), deps);
		expect(checkedBranch).toBe("orch/henry-20260318T140000");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 6. Detached HEAD
// ═══════════════════════════════════════════════════════════════════════

describe("resolveIntegrationContext — detached HEAD", () => {
	it("returns error when HEAD is detached", () => {
		const deps = makeDeps({
			getCurrentBranch: () => null,
		});
		const result = resolveIntegrationContext(defaultParsed(), deps);
		const err = expectContextError(result, "error");
		expect(err.error).toContain("HEAD is detached");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 7. Branch safety check
// ═══════════════════════════════════════════════════════════════════════

describe("resolveIntegrationContext — branch safety", () => {
	it("succeeds when current branch matches baseBranch", () => {
		const deps = makeDeps({
			getCurrentBranch: () => "main",
		});
		const result = resolveIntegrationContext(defaultParsed(), deps);
		expectContext(result);
	});

	it("fails when current branch differs from baseBranch without --force", () => {
		const deps = makeDeps({
			loadBatchState: () => makeBatchState({ baseBranch: "main" }),
			getCurrentBranch: () => "feature/other",
		});
		const result = resolveIntegrationContext(defaultParsed(), deps);
		const err = expectContextError(result, "error");
		expect(err.error).toContain("Batch was started from main");
		expect(err.error).toContain("feature/other");
	});

	it("succeeds when current branch differs from baseBranch with --force", () => {
		const deps = makeDeps({
			loadBatchState: () => makeBatchState({ baseBranch: "main" }),
			getCurrentBranch: () => "feature/other",
		});
		const result = resolveIntegrationContext(
			defaultParsed({ force: true }),
			deps,
		);
		const ctx = expectContext(result);
		expect(ctx.currentBranch).toBe("feature/other");
		expect(ctx.baseBranch).toBe("main");
	});

	it("infers baseBranch from currentBranch when state unavailable", () => {
		const deps = makeDeps({
			loadBatchState: () => null,
			listOrchBranches: () => ["orch/auto"],
			orchBranchExists: () => true,
			getCurrentBranch: () => "develop",
		});
		const result = resolveIntegrationContext(defaultParsed(), deps);
		const ctx = expectContext(result);
		// baseBranch inferred from currentBranch, so safety check always passes
		expect(ctx.baseBranch).toBe("develop");
		expect(ctx.currentBranch).toBe("develop");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 8. End-to-end happy path combinations
// ═══════════════════════════════════════════════════════════════════════

describe("resolveIntegrationContext — happy path", () => {
	it("resolves from state with all fields populated", () => {
		const deps = makeDeps();
		const result = resolveIntegrationContext(defaultParsed(), deps);
		const ctx = expectContext(result);
		expect(ctx.orchBranch).toBe("orch/henry-20260318T140000");
		expect(ctx.baseBranch).toBe("main");
		expect(ctx.batchId).toBe("20260318T140000");
		expect(ctx.currentBranch).toBe("main");
		expect(ctx.notices).toEqual([]);
	});

	it("CLI branch arg overrides state orchBranch", () => {
		const deps = makeDeps({
			orchBranchExists: (b) => b === "orch/override",
		});
		const result = resolveIntegrationContext(
			defaultParsed({ orchBranchArg: "orch/override" }),
			deps,
		);
		const ctx = expectContext(result);
		expect(ctx.orchBranch).toBe("orch/override");
		// baseBranch still comes from state
		expect(ctx.baseBranch).toBe("main");
	});
});
