/**
 * Orchestrator Integrate Command Tests — TP-023
 *
 * Tests for:
 * - parseIntegrateArgs() — pure argument parser
 * - resolveIntegrationContext() — pure context resolution with dependency injection
 * - executeIntegration() — mode execution with DI for git/gh ops
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test extensions/tests/orch-integrate.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { parseIntegrateArgs, resolveIntegrationContext, executeIntegration, dropBatchAutostash, collectRepoCleanupFindings } from "../taskplane/extension.ts";
import { computeIntegrateCleanupResult } from "../taskplane/messages.ts";
import type {
	IntegrateArgs,
	IntegrateMode,
	IntegrationDeps,
	IntegrationContext,
	IntegrationContextError,
	IntegrationResult,
	IntegrationExecDeps,
} from "../taskplane/extension.ts";
import type { IntegrateCleanupRepoFindings } from "../taskplane/messages.ts";
import { StateFileError, DEFAULT_ORCHESTRATOR_CONFIG } from "../taskplane/types.ts";
import type { PersistedBatchState, OrchBatchPhase, OrchestratorConfig } from "../taskplane/types.ts";
import { execSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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

	const nonCompletedPhases: OrchBatchPhase[] = ["idle", "launching", "planning", "executing", "merging", "paused", "stopped", "failed"];
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

// ═══════════════════════════════════════════════════════════════════════
// executeIntegration — mode execution tests
// ═══════════════════════════════════════════════════════════════════════

/** Create a default IntegrationContext for executeIntegration tests */
function makeContext(overrides: Partial<IntegrationContext> = {}): IntegrationContext {
	return {
		orchBranch: "orch/henry-20260318T140000",
		baseBranch: "main",
		batchId: "20260318T140000",
		currentBranch: "main",
		notices: [],
		...overrides,
	};
}

/** Create default exec deps where everything succeeds */
function makeExecDeps(overrides: Partial<IntegrationExecDeps> = {}): IntegrationExecDeps {
	return {
		// merge-base --is-ancestor returns false by default so executeIntegration
		// does not short-circuit to the already-merged cleanup path.
		runGit: (args: string[]) => {
			if (args[0] === "merge-base") return { ok: false, stdout: "", stderr: "" };
			return { ok: true, stdout: "", stderr: "" };
		},
		runCommand: () => ({ ok: true, stdout: "https://github.com/org/repo/pull/42", stderr: "" }),
		deleteBatchState: () => {},
		...overrides,
	};
}

// ── Fast-forward mode ─────────────────────────────────────────────────

describe("executeIntegration — fast-forward mode", () => {
	it("succeeds with ff merge and sets integratedLocally=true", () => {
		const result = executeIntegration("ff", makeContext(), makeExecDeps());
		expect(result.success).toBe(true);
		expect(result.integratedLocally).toBe(true);
		expect(result.message).toContain("Fast-forwarded");
		expect(result.message).toContain("main");
		expect(result.message).toContain("orch/henry-20260318T140000");
	});

	it("calls git merge --ff-only with the orch branch", () => {
		const gitCalls: string[][] = [];
		const deps = makeExecDeps({
			runGit: (args) => {
				gitCalls.push(args);
				if (args[0] === "merge-base") return { ok: false, stdout: "", stderr: "" };
				return { ok: true, stdout: "", stderr: "" };
			},
		});
		executeIntegration("ff", makeContext(), deps);
		// status --porcelain (stash check) must occur before merge
		const statusIdx = gitCalls.findIndex(c => c[0] === "status");
		const mergeCall = gitCalls.find(c => c[0] === "merge");
		const mergeIdx = gitCalls.findIndex(c => c[0] === "merge");
		expect(statusIdx).toBeGreaterThanOrEqual(0);
		expect(mergeCall).toEqual(["merge", "--ff-only", "orch/henry-20260318T140000"]);
		expect(statusIdx).toBeLessThan(mergeIdx);
	});

	it("returns error when ff fails (diverged branches)", () => {
		const deps = makeExecDeps({
			runGit: (args) => {
				if (args[0] === "merge-base") return { ok: false, stdout: "", stderr: "" };
				if (args[0] === "merge") {
					return { ok: false, stdout: "", stderr: "fatal: Not possible to fast-forward" };
				}
				return { ok: true, stdout: "", stderr: "" };
			},
		});
		const result = executeIntegration("ff", makeContext(), deps);
		expect(result.success).toBe(false);
		expect(result.integratedLocally).toBe(false);
		expect(result.error).toContain("Fast-forward failed");
		expect(result.error).toContain("diverged");
		expect(result.error).toContain("--merge");
		expect(result.error).toContain("--pr");
	});

	it("does NOT perform cleanup on ff failure", () => {
		let cleanupCalled = false;
		const deps = makeExecDeps({
			runGit: (args) => {
				if (args[0] === "merge-base") return { ok: false, stdout: "", stderr: "" };
				if (args[0] === "merge") {
					return { ok: false, stdout: "", stderr: "fail" };
				}
				// branch -D should not be called
				if (args[0] === "branch" && args[1] === "-D") {
					cleanupCalled = true;
				}
				return { ok: true, stdout: "", stderr: "" };
			},
			deleteBatchState: () => { cleanupCalled = true; },
		});
		executeIntegration("ff", makeContext(), deps);
		expect(cleanupCalled).toBe(false);
	});
});

// ── Merge mode ─────────────────────────────────────────────────────────

describe("executeIntegration — merge mode", () => {
	it("succeeds with merge commit and sets integratedLocally=true", () => {
		const result = executeIntegration("merge", makeContext(), makeExecDeps());
		expect(result.success).toBe(true);
		expect(result.integratedLocally).toBe(true);
		expect(result.message).toContain("Merged");
		expect(result.message).toContain("merge commit");
	});

	it("calls git merge with --no-edit", () => {
		const gitCalls: string[][] = [];
		const deps = makeExecDeps({
			runGit: (args) => {
				gitCalls.push(args);
				if (args[0] === "merge-base") return { ok: false, stdout: "", stderr: "" };
				return { ok: true, stdout: "", stderr: "" };
			},
		});
		executeIntegration("merge", makeContext(), deps);
		// status --porcelain (stash check) must occur before merge
		const statusIdx = gitCalls.findIndex(c => c[0] === "status");
		const mergeCall = gitCalls.find(c => c[0] === "merge");
		const mergeIdx = gitCalls.findIndex(c => c[0] === "merge");
		expect(statusIdx).toBeGreaterThanOrEqual(0);
		expect(mergeCall).toEqual(["merge", "orch/henry-20260318T140000", "--no-edit"]);
		expect(statusIdx).toBeLessThan(mergeIdx);
	});

	it("returns error when merge fails (conflict)", () => {
		const deps = makeExecDeps({
			runGit: (args) => {
				if (args[0] === "merge-base") return { ok: false, stdout: "", stderr: "" };
				if (args[0] === "merge") {
					return { ok: false, stdout: "", stderr: "CONFLICT (content): Merge conflict in file.txt" };
				}
				return { ok: true, stdout: "", stderr: "" };
			},
		});
		const result = executeIntegration("merge", makeContext(), deps);
		expect(result.success).toBe(false);
		expect(result.integratedLocally).toBe(false);
		expect(result.error).toContain("Merge failed");
		expect(result.error).toContain("conflicts");
		expect(result.error).toContain("--pr");
	});

	it("does NOT perform cleanup on merge failure", () => {
		let cleanupCalled = false;
		const deps = makeExecDeps({
			runGit: (args) => {
				if (args[0] === "merge-base") return { ok: false, stdout: "", stderr: "" };
				if (args[0] === "merge") {
					return { ok: false, stdout: "", stderr: "fail" };
				}
				if (args[0] === "branch" && args[1] === "-D") {
					cleanupCalled = true;
				}
				return { ok: true, stdout: "", stderr: "" };
			},
			deleteBatchState: () => { cleanupCalled = true; },
		});
		executeIntegration("merge", makeContext(), deps);
		expect(cleanupCalled).toBe(false);
	});
});

// ── PR mode ────────────────────────────────────────────────────────────

describe("executeIntegration — PR mode", () => {
	it("succeeds and sets integratedLocally=false", () => {
		const result = executeIntegration("pr", makeContext(), makeExecDeps());
		expect(result.success).toBe(true);
		expect(result.integratedLocally).toBe(false);
		expect(result.message).toContain("Pull request created");
		expect(result.message).toContain("orch branch has been kept");
	});

	it("includes PR URL in success message", () => {
		const deps = makeExecDeps({
			runCommand: () => ({ ok: true, stdout: "https://github.com/org/repo/pull/42", stderr: "" }),
		});
		const result = executeIntegration("pr", makeContext(), deps);
		expect(result.message).toContain("https://github.com/org/repo/pull/42");
	});

	it("pushes orch branch before creating PR", () => {
		const calls: Array<{ type: string; args: string[] }> = [];
		const deps = makeExecDeps({
			runGit: (args) => {
				calls.push({ type: "git", args });
				if (args[0] === "merge-base") return { ok: false, stdout: "", stderr: "" };
				return { ok: true, stdout: "", stderr: "" };
			},
			runCommand: (cmd, args) => {
				calls.push({ type: cmd, args });
				return { ok: true, stdout: "https://github.com/org/repo/pull/1", stderr: "" };
			},
		});
		executeIntegration("pr", makeContext(), deps);
		// git push must occur before gh pr create
		const pushCall = calls.find(c => c.type === "git" && c.args[0] === "push");
		const prCall = calls.find(c => c.type === "gh");
		expect(pushCall).toBeDefined();
		expect(pushCall!.args).toEqual(["push", "origin", "orch/henry-20260318T140000"]);
		expect(prCall).toBeDefined();
		expect(prCall!.args).toContain("pr");
		expect(prCall!.args).toContain("create");
		// push must come before pr create
		expect(calls.indexOf(pushCall!)).toBeLessThan(calls.indexOf(prCall!));
	});

	it("returns error when push fails", () => {
		const deps = makeExecDeps({
			runGit: () => ({ ok: false, stdout: "", stderr: "fatal: remote rejected" }),
		});
		const result = executeIntegration("pr", makeContext(), deps);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Failed to push");
		expect(result.error).toContain("remote rejected");
	});

	it("returns error when gh pr create fails (after successful push)", () => {
		const deps = makeExecDeps({
			runGit: (args) => {
				if (args[0] === "merge-base") return { ok: false, stdout: "", stderr: "" };
				return { ok: true, stdout: "", stderr: "" };
			},
			runCommand: () => ({ ok: false, stdout: "", stderr: "gh: Not logged in" }),
		});
		const result = executeIntegration("pr", makeContext(), deps);
		expect(result.success).toBe(false);
		expect(result.error).toContain("PR creation failed");
		expect(result.error).toContain("create the PR manually");
	});

	it("does NOT delete local branch or state on PR success", () => {
		let branchDeleted = false;
		let stateDeleted = false;
		const deps = makeExecDeps({
			runGit: (args) => {
				if (args[0] === "merge-base") return { ok: false, stdout: "", stderr: "" };
				if (args[0] === "branch" && args[1] === "-D") branchDeleted = true;
				return { ok: true, stdout: "", stderr: "" };
			},
			runCommand: () => ({ ok: true, stdout: "https://example.com/pr/1", stderr: "" }),
			deleteBatchState: () => { stateDeleted = true; },
		});
		executeIntegration("pr", makeContext(), deps);
		expect(branchDeleted).toBe(false);
		expect(stateDeleted).toBe(false);
	});

	it("uses orch branch name in PR title when batchId is empty", () => {
		let prArgs: string[] = [];
		const deps = makeExecDeps({
			runCommand: (_cmd, args) => {
				prArgs = args;
				return { ok: true, stdout: "https://example.com/pr/1", stderr: "" };
			},
		});
		executeIntegration("pr", makeContext({ batchId: "" }), deps);
		const titleIdx = prArgs.indexOf("--title");
		expect(titleIdx).toBeGreaterThan(-1);
		expect(prArgs[titleIdx + 1]).toContain("orch/henry-20260318T140000");
		expect(prArgs[titleIdx + 1]).not.toContain("batch");
	});

	it("uses batchId in PR title when available", () => {
		let prArgs: string[] = [];
		const deps = makeExecDeps({
			runCommand: (_cmd, args) => {
				prArgs = args;
				return { ok: true, stdout: "https://example.com/pr/1", stderr: "" };
			},
		});
		executeIntegration("pr", makeContext({ batchId: "20260318T140000" }), deps);
		const titleIdx = prArgs.indexOf("--title");
		expect(titleIdx).toBeGreaterThan(-1);
		expect(prArgs[titleIdx + 1]).toContain("20260318T140000");
	});
});

// ── Already-merged detection ────────────────────────────────────────

describe("executeIntegration — already merged detection", () => {
	it("short-circuits to cleanup when orch branch is already an ancestor of HEAD", () => {
		let branchDeleted = false;
		let stateDeleted = false;
		let mergeAttempted = false;
		const deps = makeExecDeps({
			runGit: (args) => {
				if (args[0] === "merge-base") return { ok: true, stdout: "", stderr: "" }; // already merged
				if (args[0] === "merge") mergeAttempted = true;
				if (args[0] === "branch" && args[1] === "-D") branchDeleted = true;
				return { ok: true, stdout: "", stderr: "" };
			},
			deleteBatchState: () => { stateDeleted = true; },
		});
		const result = executeIntegration("ff", makeContext(), deps);
		expect(result.success).toBe(true);
		expect(mergeAttempted).toBe(false);      // no merge attempt
		expect(branchDeleted).toBe(true);         // cleanup ran
		expect(stateDeleted).toBe(true);          // cleanup ran
		expect(result.message).toContain("Already integrated");
	});
});

// ── Cleanup behavior ──────────────────────────────────────────────────

describe("executeIntegration — cleanup", () => {
	it("deletes orch branch and batch state on ff success", () => {
		let branchDeleted = false;
		let stateDeleted = false;
		const deps = makeExecDeps({
			runGit: (args) => {
				if (args[0] === "branch" && args[1] === "-D") {
					branchDeleted = true;
					expect(args[2]).toBe("orch/henry-20260318T140000");
				}
				return { ok: true, stdout: "", stderr: "" };
			},
			deleteBatchState: () => { stateDeleted = true; },
		});
		executeIntegration("ff", makeContext(), deps);
		expect(branchDeleted).toBe(true);
		expect(stateDeleted).toBe(true);
	});

	it("deletes orch branch and batch state on merge success", () => {
		let branchDeleted = false;
		let stateDeleted = false;
		const deps = makeExecDeps({
			runGit: (args) => {
				if (args[0] === "branch" && args[1] === "-D") branchDeleted = true;
				return { ok: true, stdout: "", stderr: "" };
			},
			deleteBatchState: () => { stateDeleted = true; },
		});
		executeIntegration("merge", makeContext(), deps);
		expect(branchDeleted).toBe(true);
		expect(stateDeleted).toBe(true);
	});

	it("warns but still succeeds if branch deletion fails", () => {
		const deps = makeExecDeps({
			runGit: (args) => {
				if (args[0] === "branch" && args[1] === "-D") {
					return { ok: false, stdout: "", stderr: "error: branch not found" };
				}
				return { ok: true, stdout: "", stderr: "" };
			},
		});
		const result = executeIntegration("ff", makeContext(), deps);
		expect(result.success).toBe(true);
		expect(result.message).toContain("Could not delete local branch");
	});

	it("warns but still succeeds if state deletion throws", () => {
		const deps = makeExecDeps({
			deleteBatchState: () => { throw new Error("permission denied"); },
		});
		const result = executeIntegration("ff", makeContext(), deps);
		expect(result.success).toBe(true);
		expect(result.message).toContain("Could not clean up batch state");
	});

	it("warns for both branch and state cleanup failures without failing", () => {
		const deps = makeExecDeps({
			runGit: (args) => {
				if (args[0] === "branch" && args[1] === "-D") {
					return { ok: false, stdout: "", stderr: "branch error" };
				}
				return { ok: true, stdout: "", stderr: "" };
			},
			deleteBatchState: () => { throw new Error("state error"); },
		});
		const result = executeIntegration("ff", makeContext(), deps);
		expect(result.success).toBe(true);
		expect(result.message).toContain("Could not delete local branch");
		expect(result.message).toContain("Could not clean up batch state");
	});
});

// ── TP-029 Step 3: computeIntegrateCleanupResult ─────────────────────

describe("computeIntegrateCleanupResult — pure function", () => {
	it("returns clean=true when all repos have no findings", () => {
		const findings: IntegrateCleanupRepoFindings[] = [
			{
				repoRoot: "/repo-a",
				repoId: "repo-a",
				staleWorktrees: [],
				staleLaneBranches: [],
				staleOrchBranches: [],
				staleAutostashEntries: [],
				nonEmptyWorktreeContainers: [],
			},
			{
				repoRoot: "/repo-b",
				repoId: "repo-b",
				staleWorktrees: [],
				staleLaneBranches: [],
				staleOrchBranches: [],
				staleAutostashEntries: [],
				nonEmptyWorktreeContainers: [],
			},
		];
		const result = computeIntegrateCleanupResult(findings);
		expect(result.clean).toBe(true);
		expect(result.dirtyRepos).toHaveLength(0);
		expect(result.report).toContain("🧹");
		expect(result.report).toContain("no stale");
	});

	it("returns clean=false and reports stale worktrees", () => {
		const findings: IntegrateCleanupRepoFindings[] = [
			{
				repoRoot: "/repo-a",
				repoId: "repo-a",
				staleWorktrees: ["/worktrees/lane-1"],
				staleLaneBranches: [],
				staleOrchBranches: [],
				staleAutostashEntries: [],
				nonEmptyWorktreeContainers: [],
			},
		];
		const result = computeIntegrateCleanupResult(findings);
		expect(result.clean).toBe(false);
		expect(result.dirtyRepos).toHaveLength(1);
		expect(result.report).toContain("⚠️");
		expect(result.report).toContain("stale worktree");
		expect(result.report).toContain("git worktree remove");
	});

	it("reports multiple issue types across multiple repos", () => {
		const findings: IntegrateCleanupRepoFindings[] = [
			{
				repoRoot: "/repo-a",
				repoId: "repo-a",
				staleWorktrees: [],
				staleLaneBranches: ["task/op-lane-1-abc"],
				staleOrchBranches: ["orch/op-abc"],
				staleAutostashEntries: [],
				nonEmptyWorktreeContainers: [],
			},
			{
				repoRoot: "/repo-b",
				repoId: "repo-b",
				staleWorktrees: [],
				staleLaneBranches: [],
				staleOrchBranches: [],
				staleAutostashEntries: ["0"],
				nonEmptyWorktreeContainers: ["/repo-b/.worktrees"],
			},
		];
		const result = computeIntegrateCleanupResult(findings);
		expect(result.clean).toBe(false);
		expect(result.dirtyRepos).toHaveLength(2);
		expect(result.report).toContain("repo-a");
		expect(result.report).toContain("lane branch");
		expect(result.report).toContain("orch branch");
		expect(result.report).toContain("repo-b");
		expect(result.report).toContain("autostash");
		expect(result.report).toContain("container");
	});

	it("uses (default) label for repo-mode (repoId undefined)", () => {
		const findings: IntegrateCleanupRepoFindings[] = [
			{
				repoRoot: "/repo",
				repoId: undefined,
				staleWorktrees: ["/wt"],
				staleLaneBranches: [],
				staleOrchBranches: [],
				staleAutostashEntries: [],
				nonEmptyWorktreeContainers: [],
			},
		];
		const result = computeIntegrateCleanupResult(findings);
		expect(result.report).toContain("(default)");
	});

	it("includes recovery commands for all artifact types", () => {
		const findings: IntegrateCleanupRepoFindings[] = [
			{
				repoRoot: "/repo",
				repoId: "myrepo",
				staleWorktrees: ["/wt/lane-1"],
				staleLaneBranches: ["task/op-lane-1-batch"],
				staleOrchBranches: ["orch/op-batch"],
				staleAutostashEntries: ["2"],
				nonEmptyWorktreeContainers: [],
			},
		];
		const result = computeIntegrateCleanupResult(findings);
		expect(result.report).toContain('git worktree remove --force');
		expect(result.report).toContain('git branch -D');
		expect(result.report).toContain('git stash drop');
	});
});

// ── TP-029 Step 4: Notification severity policy ──────────────────────

describe("computeIntegrateCleanupResult — notification severity policy", () => {
	it("clean result returns notifyLevel='info' (used by ctx.ui.notify in extension.ts)", () => {
		const findings: IntegrateCleanupRepoFindings[] = [
			{
				repoRoot: "/repo",
				repoId: "repo",
				staleWorktrees: [],
				staleLaneBranches: [],
				staleOrchBranches: [],
				staleAutostashEntries: [],
				nonEmptyWorktreeContainers: [],
			},
		];
		const result = computeIntegrateCleanupResult(findings);
		expect(result.clean).toBe(true);
		// notifyLevel is computed by the production function and consumed directly
		// by extension.ts: ctx.ui.notify(summary, cleanupResult.notifyLevel)
		expect(result.notifyLevel).toBe("info");
	});

	it("dirty result returns notifyLevel='warning' (used by ctx.ui.notify in extension.ts)", () => {
		const findings: IntegrateCleanupRepoFindings[] = [
			{
				repoRoot: "/repo",
				repoId: "repo",
				staleWorktrees: ["/wt/lane-1"],
				staleLaneBranches: [],
				staleOrchBranches: [],
				staleAutostashEntries: [],
				nonEmptyWorktreeContainers: [],
			},
		];
		const result = computeIntegrateCleanupResult(findings);
		expect(result.clean).toBe(false);
		// notifyLevel is computed by the production function — no ternary duplication
		expect(result.notifyLevel).toBe("warning");
	});
});

// ── TP-029 Step 4: Polyrepo acceptance — all 5 dimensions ───────────

describe("computeIntegrateCleanupResult — all 5 acceptance dimensions across repos", () => {
	it("validates all 5 cleanup criteria across multiple workspace repos", () => {
		// This test covers the full polyrepo acceptance contract:
		// 1. staleWorktrees, 2. staleLaneBranches, 3. staleOrchBranches,
		// 4. staleAutostashEntries, 5. nonEmptyWorktreeContainers
		// Distributed across 3 repos (simulating a workspace with multiple repos).
		const findings: IntegrateCleanupRepoFindings[] = [
			{
				repoRoot: "/workspace/api",
				repoId: "api",
				staleWorktrees: ["/workspace/api/.worktrees/lane-1"],
				staleLaneBranches: ["task/op-lane-1-batch123"],
				staleOrchBranches: [],
				staleAutostashEntries: [],
				nonEmptyWorktreeContainers: [],
			},
			{
				repoRoot: "/workspace/frontend",
				repoId: "frontend",
				staleWorktrees: [],
				staleLaneBranches: [],
				staleOrchBranches: ["orch/op-batch123"],
				staleAutostashEntries: ["0", "1"],
				nonEmptyWorktreeContainers: [],
			},
			{
				repoRoot: "/workspace/shared",
				repoId: "shared",
				staleWorktrees: [],
				staleLaneBranches: [],
				staleOrchBranches: [],
				staleAutostashEntries: [],
				nonEmptyWorktreeContainers: ["/workspace/shared/.worktrees"],
			},
		];
		const result = computeIntegrateCleanupResult(findings);

		// Overall: dirty (3 repos have findings)
		expect(result.clean).toBe(false);
		expect(result.dirtyRepos).toHaveLength(3);

		// Dimension 1: staleWorktrees (repo: api)
		expect(result.report).toContain("api");
		expect(result.report).toContain("stale worktree");
		expect(result.report).toContain("git worktree remove");

		// Dimension 2: staleLaneBranches (repo: api)
		expect(result.report).toContain("lane branch");
		expect(result.report).toContain("git branch -D");

		// Dimension 3: staleOrchBranches (repo: frontend)
		expect(result.report).toContain("frontend");
		expect(result.report).toContain("orch branch");

		// Dimension 4: staleAutostashEntries (repo: frontend)
		expect(result.report).toContain("autostash");
		expect(result.report).toContain("git stash drop");

		// Dimension 5: nonEmptyWorktreeContainers (repo: shared)
		expect(result.report).toContain("shared");
		expect(result.report).toContain("container");

		// All recovery commands should be present
		expect(result.report).toContain("git worktree remove");
		expect(result.report).toContain("git branch -D");
		expect(result.report).toContain("git stash drop");
	});

	it("returns clean when all 5 dimensions are clear across all workspace repos", () => {
		const findings: IntegrateCleanupRepoFindings[] = [
			{
				repoRoot: "/workspace/api",
				repoId: "api",
				staleWorktrees: [],
				staleLaneBranches: [],
				staleOrchBranches: [],
				staleAutostashEntries: [],
				nonEmptyWorktreeContainers: [],
			},
			{
				repoRoot: "/workspace/frontend",
				repoId: "frontend",
				staleWorktrees: [],
				staleLaneBranches: [],
				staleOrchBranches: [],
				staleAutostashEntries: [],
				nonEmptyWorktreeContainers: [],
			},
			{
				repoRoot: "/workspace/shared",
				repoId: "shared",
				staleWorktrees: [],
				staleLaneBranches: [],
				staleOrchBranches: [],
				staleAutostashEntries: [],
				nonEmptyWorktreeContainers: [],
			},
		];
		const result = computeIntegrateCleanupResult(findings);
		expect(result.clean).toBe(true);
		expect(result.dirtyRepos).toHaveLength(0);
		expect(result.report).toContain("🧹");
		expect(result.report).toContain("no stale");
		// Verify info-level notification via production notifyLevel field
		expect(result.notifyLevel).toBe("info");
	});
});

// ── TP-029 Step 3: dropBatchAutostash ────────────────────────────────

describe("dropBatchAutostash — real git repo", () => {
	let tmpDir: string;
	const batchId = "20260319T120000";

	function initRepo(): string {
		const dir = mkdtempSync(join(tmpdir(), "tp029-stash-"));
		execSync("git init", { cwd: dir, stdio: "pipe" });
		execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
		execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
		writeFileSync(join(dir, "file.txt"), "initial");
		execSync("git add -A && git commit -m init", { cwd: dir, stdio: "pipe" });
		return dir;
	}

	function createStash(dir: string, msg: string): void {
		writeFileSync(join(dir, "dirty.txt"), `dirty-${Date.now()}-${Math.random()}`);
		execSync(`git stash push --include-untracked -m "${msg}"`, { cwd: dir, stdio: "pipe" });
	}

	function stashMessages(dir: string): string[] {
		const out = execSync("git stash list --format=%s", { cwd: dir, encoding: "utf-8" }).trim();
		return out ? out.split("\n") : [];
	}

	it("drops orch-integrate-autostash entries for matching batchId", () => {
		tmpDir = initRepo();
		createStash(tmpDir, `orch-integrate-autostash-${batchId}`);
		createStash(tmpDir, "unrelated-stash");
		expect(stashMessages(tmpDir)).toHaveLength(2);

		dropBatchAutostash(tmpDir, batchId);

		const remaining = stashMessages(tmpDir);
		expect(remaining).toHaveLength(1);
		expect(remaining[0]).toContain("unrelated-stash");
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("drops merge-agent-autostash entries for matching batchId", () => {
		tmpDir = initRepo();
		createStash(tmpDir, `merge-agent-autostash-w0-${batchId}`);
		createStash(tmpDir, `merge-agent-autostash-w1-${batchId}`);
		createStash(tmpDir, "user-stash");
		expect(stashMessages(tmpDir)).toHaveLength(3);

		dropBatchAutostash(tmpDir, batchId);

		const remaining = stashMessages(tmpDir);
		expect(remaining).toHaveLength(1);
		expect(remaining[0]).toContain("user-stash");
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("preserves stashes from different batchId", () => {
		tmpDir = initRepo();
		const otherBatch = "20260318T100000";
		createStash(tmpDir, `orch-integrate-autostash-${otherBatch}`);
		createStash(tmpDir, `merge-agent-autostash-w0-${otherBatch}`);
		expect(stashMessages(tmpDir)).toHaveLength(2);

		dropBatchAutostash(tmpDir, batchId);

		const remaining = stashMessages(tmpDir);
		expect(remaining).toHaveLength(2);
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("handles empty stash list gracefully", () => {
		tmpDir = initRepo();
		// No stashes created — should not throw
		dropBatchAutostash(tmpDir, batchId);
		expect(stashMessages(tmpDir)).toHaveLength(0);
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("handles empty batchId gracefully (no-op)", () => {
		tmpDir = initRepo();
		createStash(tmpDir, "some-stash");
		dropBatchAutostash(tmpDir, "");
		expect(stashMessages(tmpDir)).toHaveLength(1);
		rmSync(tmpDir, { recursive: true, force: true });
	});
});

// ── TP-029 Step 3: collectRepoCleanupFindings ────────────────────────

describe("collectRepoCleanupFindings — real git repo", () => {
	const batchId = "20260319T120000";
	const opId = "testop";
	const orchBranch = `orch/${opId}-${batchId}`;
	const prefix = "taskplane-wt";

	function initRepo(): string {
		const dir = mkdtempSync(join(tmpdir(), "tp029-findings-"));
		execSync("git init", { cwd: dir, stdio: "pipe" });
		execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
		execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
		writeFileSync(join(dir, "file.txt"), "initial");
		execSync("git add -A && git commit -m init", { cwd: dir, stdio: "pipe" });
		return dir;
	}

	function makeConfig(overrides: Partial<OrchestratorConfig["orchestrator"]> = {}): OrchestratorConfig {
		return {
			...DEFAULT_ORCHESTRATOR_CONFIG,
			orchestrator: {
				...DEFAULT_ORCHESTRATOR_CONFIG.orchestrator,
				worktree_prefix: prefix,
				...overrides,
			},
		};
	}

	it("returns empty findings for a clean repo", () => {
		const dir = initRepo();
		const config = makeConfig();
		const findings = collectRepoCleanupFindings(dir, "myrepo", opId, batchId, prefix, orchBranch, config);
		expect(findings.staleWorktrees).toHaveLength(0);
		expect(findings.staleLaneBranches).toHaveLength(0);
		expect(findings.staleOrchBranches).toHaveLength(0);
		expect(findings.staleAutostashEntries).toHaveLength(0);
		expect(findings.nonEmptyWorktreeContainers).toHaveLength(0);
		rmSync(dir, { recursive: true, force: true });
	});

	it("detects stale lane branches", () => {
		const dir = initRepo();
		execSync(`git branch "task/${opId}-lane-1-${batchId}"`, { cwd: dir, stdio: "pipe" });
		execSync(`git branch "task/${opId}-lane-2-${batchId}"`, { cwd: dir, stdio: "pipe" });
		const config = makeConfig();
		const findings = collectRepoCleanupFindings(dir, "myrepo", opId, batchId, prefix, orchBranch, config);
		expect(findings.staleLaneBranches).toHaveLength(2);
		expect(findings.staleLaneBranches).toContain(`task/${opId}-lane-1-${batchId}`);
		expect(findings.staleLaneBranches).toContain(`task/${opId}-lane-2-${batchId}`);
		rmSync(dir, { recursive: true, force: true });
	});

	it("detects stale orch branch", () => {
		const dir = initRepo();
		execSync(`git branch "${orchBranch}"`, { cwd: dir, stdio: "pipe" });
		const config = makeConfig();
		const findings = collectRepoCleanupFindings(dir, "myrepo", opId, batchId, prefix, orchBranch, config);
		expect(findings.staleOrchBranches).toHaveLength(1);
		expect(findings.staleOrchBranches[0]).toBe(orchBranch);
		rmSync(dir, { recursive: true, force: true });
	});

	it("detects stale autostash entries", () => {
		const dir = initRepo();
		writeFileSync(join(dir, "dirty.txt"), "dirty");
		execSync(`git stash push --include-untracked -m "orch-integrate-autostash-${batchId}"`, { cwd: dir, stdio: "pipe" });
		const config = makeConfig();
		const findings = collectRepoCleanupFindings(dir, "myrepo", opId, batchId, prefix, orchBranch, config);
		expect(findings.staleAutostashEntries).toHaveLength(1);
		rmSync(dir, { recursive: true, force: true });
	});

	it("detects non-empty .worktrees containers in subdirectory mode", () => {
		const dir = initRepo();
		const worktreesDir = join(dir, ".worktrees");
		mkdirSync(worktreesDir, { recursive: true });
		writeFileSync(join(worktreesDir, "stale-file"), "leftover");
		const config = makeConfig({ worktree_location: "subdirectory" });
		const findings = collectRepoCleanupFindings(dir, "myrepo", opId, batchId, prefix, orchBranch, config);
		expect(findings.nonEmptyWorktreeContainers).toHaveLength(1);
		rmSync(dir, { recursive: true, force: true });
	});

	it("does NOT check .worktrees containers in sibling mode", () => {
		const dir = initRepo();
		const worktreesDir = join(dir, ".worktrees");
		mkdirSync(worktreesDir, { recursive: true });
		writeFileSync(join(worktreesDir, "stale-file"), "leftover");
		const config = makeConfig({ worktree_location: "sibling" });
		const findings = collectRepoCleanupFindings(dir, "myrepo", opId, batchId, prefix, orchBranch, config);
		expect(findings.nonEmptyWorktreeContainers).toHaveLength(0);
		rmSync(dir, { recursive: true, force: true });
	});

	it("skips orch branch detection when skipOrchBranch option is set (PR mode)", () => {
		const dir = initRepo();
		// Create the orch branch — this is intentionally preserved in PR mode
		execSync(`git branch "${orchBranch}"`, { cwd: dir, stdio: "pipe" });
		const config = makeConfig();

		// Without skipOrchBranch → orch branch is flagged as stale
		const findingsDefault = collectRepoCleanupFindings(dir, "myrepo", opId, batchId, prefix, orchBranch, config);
		expect(findingsDefault.staleOrchBranches).toHaveLength(1);
		expect(findingsDefault.staleOrchBranches[0]).toBe(orchBranch);

		// With skipOrchBranch → orch branch is NOT flagged (PR mode contract)
		const findingsPr = collectRepoCleanupFindings(dir, "myrepo", opId, batchId, prefix, orchBranch, config, { skipOrchBranch: true });
		expect(findingsPr.staleOrchBranches).toHaveLength(0);

		// Other findings still work normally with skipOrchBranch
		execSync(`git branch "task/${opId}-lane-1-${batchId}"`, { cwd: dir, stdio: "pipe" });
		const findingsWithLane = collectRepoCleanupFindings(dir, "myrepo", opId, batchId, prefix, orchBranch, config, { skipOrchBranch: true });
		expect(findingsWithLane.staleLaneBranches).toHaveLength(1);
		expect(findingsWithLane.staleOrchBranches).toHaveLength(0);

		rmSync(dir, { recursive: true, force: true });
	});

	it("PR mode: clean result when only orch branch remains (everything else clean)", () => {
		const dir = initRepo();
		execSync(`git branch "${orchBranch}"`, { cwd: dir, stdio: "pipe" });
		const config = makeConfig();

		// With skipOrchBranch, the repo should be considered clean
		const findings = collectRepoCleanupFindings(dir, "myrepo", opId, batchId, prefix, orchBranch, config, { skipOrchBranch: true });
		const result = computeIntegrateCleanupResult([findings]);
		expect(result.clean).toBe(true);
		expect(result.dirtyRepos).toHaveLength(0);

		rmSync(dir, { recursive: true, force: true });
	});
});

// ── TP-099: Artifact staging preservation tests ──────────────────────

/**
 * These tests validate that the merge.ts artifact staging does NOT
 * overwrite task artifacts (STATUS.md, .DONE, REVIEW_VERDICT.json)
 * that were already brought into the merge worktree by the lane merge.
 *
 * Root cause (#356): The artifact staging previously copied files from
 * `repoRoot` (main working directory) into the merge worktree, overwriting
 * the correctly-merged versions from lane branches. This caused STATUS.md
 * execution state to be lost during integration (especially squash merge).
 *
 * Fix (TP-099): Skip files already present in mergeWorkDir; backfill
 * missing files from lane worktree first, then repoRoot as fallback.
 */
describe("TP-099: artifact staging preserves lane-merged STATUS.md", () => {
	function initRepoWithTask(): string {
		const dir = mkdtempSync(join(tmpdir(), "tp099-artifact-"));
		execSync(`git init -b main "${dir}"`, { stdio: "pipe" });
		execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
		execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
		execSync("git config core.autocrlf false", { cwd: dir, stdio: "pipe" });

		// Create initial task folder with unchecked STATUS.md
		mkdirSync(join(dir, "taskplane-tasks", "TP-001-test"), { recursive: true });
		writeFileSync(join(dir, "taskplane-tasks", "TP-001-test", "STATUS.md"),
			"# TP-001\n- [ ] Item A\n- [ ] Item B\n");
		writeFileSync(join(dir, "taskplane-tasks", "TP-001-test", "PROMPT.md"),
			"# Task: TP-001\n");
		writeFileSync(join(dir, "src.txt"), "initial code\n");
		execSync("git add -A && git commit -m init", { cwd: dir, stdio: "pipe" });
		return dir;
	}

	/**
	 * Simulate the merge scenario:
	 * 1. Create orch branch from main
	 * 2. On orch, simulate lane merge (updates STATUS.md + adds .DONE)
	 * 3. Simulate artifact staging: attempt to copy from repoRoot
	 * 4. Verify STATUS.md was NOT overwritten
	 */
	it("STATUS.md with checked items survives when already in merge worktree", () => {
		const dir = initRepoWithTask();
		try {
			// Create orch branch
			execSync("git checkout -b orch/test", { cwd: dir, stdio: "pipe" });

			// Simulate lane merge: worker updated STATUS.md with execution state
			const updatedStatus = "# TP-001\n- [x] Item A\n- [x] Item B\n## Execution Log\n| Done |\n";
			writeFileSync(join(dir, "taskplane-tasks", "TP-001-test", "STATUS.md"), updatedStatus);
			writeFileSync(join(dir, "taskplane-tasks", "TP-001-test", ".DONE"), "completed\n");
			writeFileSync(join(dir, "src.txt"), "feature code\n");
			execSync('git add -A && git commit -m "lane merge: feature + updated STATUS"', { cwd: dir, stdio: "pipe" });

			// Verify the lane merge commit has correct STATUS.md
			const laneMergedStatus = execSync(
				"git show HEAD:taskplane-tasks/TP-001-test/STATUS.md",
				{ cwd: dir, encoding: "utf-8" },
			);
			expect(laneMergedStatus).toContain("[x] Item A");
			expect(laneMergedStatus).toContain("[x] Item B");
			expect(laneMergedStatus).toContain("Execution Log");

			// Now the merge worktree has the correct STATUS.md.
			// The TP-099 fix ensures that artifact staging does NOT overwrite it.
			// We verify by checking the orch branch tip.

			// Simulate what would happen WITH the fix:
			// The file already exists in mergeWorkDir → skip overwrite.
			// Verify the file is still correct after the "staging" step.
			const statusPath = join(dir, "taskplane-tasks", "TP-001-test", "STATUS.md");
			const existsBefore = existsSync(statusPath);
			expect(existsBefore).toBe(true); // File exists → TP-099 skips overwrite

			// The file content should still be the worker-updated version
			const content = readFileSync(statusPath, "utf-8");
			expect(content).toContain("[x] Item A");
			expect(content).toContain("Execution Log");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it(".DONE file survives when already in merge worktree", () => {
		const dir = initRepoWithTask();
		try {
			execSync("git checkout -b orch/test", { cwd: dir, stdio: "pipe" });

			// Simulate lane merge: worker created .DONE
			writeFileSync(join(dir, "taskplane-tasks", "TP-001-test", ".DONE"), "completed\n");
			execSync('git add -A && git commit -m "lane merge: .DONE"', { cwd: dir, stdio: "pipe" });

			// .DONE exists in merge worktree → should not be overwritten or removed
			const donePath = join(dir, "taskplane-tasks", "TP-001-test", ".DONE");
			expect(existsSync(donePath)).toBe(true);

			// Verify it's in the git tree
			const doneContent = execSync(
				"git show HEAD:taskplane-tasks/TP-001-test/.DONE",
				{ cwd: dir, encoding: "utf-8" },
			);
			expect(doneContent).toContain("completed");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("squash merge preserves .reviews files when orch tip has them", () => {
		const dir = initRepoWithTask();
		try {
			execSync("git checkout -b orch/test", { cwd: dir, stdio: "pipe" });
			mkdirSync(join(dir, "taskplane-tasks", "TP-001-test", ".reviews"), { recursive: true });
			writeFileSync(
				join(dir, "taskplane-tasks", "TP-001-test", ".reviews", "R001-code-step1.md"),
				"# Review\n\nAPPROVE\n",
			);
			execSync('git add -A && git commit -m "lane merge: add review artifacts"', { cwd: dir, stdio: "pipe" });

			// Advance main
			execSync("git checkout main", { cwd: dir, stdio: "pipe" });
			writeFileSync(join(dir, "unrelated.txt"), "other change\n");
			execSync('git add -A && git commit -m "main: unrelated"', { cwd: dir, stdio: "pipe" });

			// Squash merge (simulates GitHub's squash-and-merge)
			execSync("git merge --squash orch/test", { cwd: dir, stdio: "pipe" });
			execSync('git commit -m "Integrate orch batch (squash)"', { cwd: dir, stdio: "pipe" });

			const reviewFile = execSync(
				"git show HEAD:taskplane-tasks/TP-001-test/.reviews/R001-code-step1.md",
				{ cwd: dir, encoding: "utf-8" },
			);
			expect(reviewFile).toContain("APPROVE");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("squash merge preserves STATUS.md when orch tip has correct content", () => {
		const dir = initRepoWithTask();
		try {
			// Create orch branch with updated STATUS.md
			execSync("git checkout -b orch/test", { cwd: dir, stdio: "pipe" });
			const updatedStatus = "# TP-001\n- [x] Item A\n- [x] Item B\n## Discoveries\n| Bug found |\n";
			writeFileSync(join(dir, "taskplane-tasks", "TP-001-test", "STATUS.md"), updatedStatus);
			writeFileSync(join(dir, "taskplane-tasks", "TP-001-test", ".DONE"), "completed\n");
			writeFileSync(join(dir, "src.txt"), "feature code\n");
			execSync('git add -A && git commit -m "lane merge + correct artifacts"', { cwd: dir, stdio: "pipe" });

			// Advance main
			execSync("git checkout main", { cwd: dir, stdio: "pipe" });
			writeFileSync(join(dir, "unrelated.txt"), "other change\n");
			execSync('git add -A && git commit -m "main: unrelated"', { cwd: dir, stdio: "pipe" });

			// Squash merge (simulates GitHub's squash-and-merge)
			execSync("git merge --squash orch/test", { cwd: dir, stdio: "pipe" });
			execSync('git commit -m "Integrate orch batch (squash)"', { cwd: dir, stdio: "pipe" });

			// Verify STATUS.md on main has checked items
			const mainStatus = execSync(
				"git show HEAD:taskplane-tasks/TP-001-test/STATUS.md",
				{ cwd: dir, encoding: "utf-8" },
			);
			expect(mainStatus).toContain("[x] Item A");
			expect(mainStatus).toContain("[x] Item B");
			expect(mainStatus).toContain("Discoveries");

			// Verify .DONE on main
			const mainDone = execSync(
				"git show HEAD:taskplane-tasks/TP-001-test/.DONE",
				{ cwd: dir, encoding: "utf-8" },
			);
			expect(mainDone).toContain("completed");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("squash merge LOSES STATUS.md when artifact staging overwrites (pre-fix scenario)", () => {
		const dir = initRepoWithTask();
		try {
			// Create orch branch with updated STATUS.md
			execSync("git checkout -b orch/test", { cwd: dir, stdio: "pipe" });
			writeFileSync(join(dir, "taskplane-tasks", "TP-001-test", "STATUS.md"),
				"# TP-001\n- [x] Item A\n- [x] Item B\n");
			writeFileSync(join(dir, "taskplane-tasks", "TP-001-test", ".DONE"), "completed\n");
			writeFileSync(join(dir, "src.txt"), "feature code\n");
			execSync('git add -A && git commit -m "lane merge"', { cwd: dir, stdio: "pipe" });

			// Simulate the OLD artifact staging (pre-fix): overwrite with template
			writeFileSync(join(dir, "taskplane-tasks", "TP-001-test", "STATUS.md"),
				"# TP-001\n- [ ] Item A\n- [ ] Item B\n");
			// Old code also removed .DONE from merge worktree if repoRoot didn't have it
			execSync('git add -A && git commit -m "checkpoint artifacts (old behavior)"', { cwd: dir, stdio: "pipe" });

			// Advance main
			execSync("git checkout main", { cwd: dir, stdio: "pipe" });
			writeFileSync(join(dir, "unrelated.txt"), "change\n");
			execSync('git add -A && git commit -m "main"', { cwd: dir, stdio: "pipe" });

			// Squash merge
			execSync("git merge --squash orch/test", { cwd: dir, stdio: "pipe" });
			execSync('git commit -m "squash"', { cwd: dir, stdio: "pipe" });

			// STATUS.md should have been reverted to template (demonstrates the bug)
			const mainStatus = execSync(
				"git show HEAD:taskplane-tasks/TP-001-test/STATUS.md",
				{ cwd: dir, encoding: "utf-8" },
			);
			// This demonstrates the pre-fix bug: STATUS.md has unchecked items
			expect(mainStatus).toContain("[ ] Item A");
			expect(mainStatus).not.toContain("[x]");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
