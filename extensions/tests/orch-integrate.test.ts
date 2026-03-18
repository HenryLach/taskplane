/**
 * Orchestrator Integrate Command Tests — TP-023 Step 1
 *
 * Tests for parseIntegrateArgs() — the pure argument parser for
 * /orch-integrate. Validates flag parsing, mutual exclusion,
 * positional branch argument handling, and error messages.
 *
 * Run: npx vitest run extensions/tests/orch-integrate.test.ts
 */

import { describe, it, expect } from "vitest";
import { parseIntegrateArgs } from "../taskplane/extension.ts";
import type { IntegrateArgs } from "../taskplane/extension.ts";

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
