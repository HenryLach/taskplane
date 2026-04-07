/**
 * UX Integration Visibility Tests — TP-052
 *
 * Tests for three UX improvements:
 * 1. orchBatchComplete message includes prominent integrate guidance
 * 2. Branch protection pre-check in /orch-integrate
 * 3. Protection-related merge failure messages include --pr hint
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test extensions/tests/ux-integrate-visibility.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { ORCH_MESSAGES } from "../taskplane/messages.ts";
import { executeIntegration } from "../taskplane/extension.ts";
import type { IntegrationExecDeps } from "../taskplane/extension.ts";
import { detectBranchProtection, buildIntegrationPlan } from "../taskplane/supervisor.ts";
import type { OrchBatchRuntimeState } from "../taskplane/types.ts";

// ═══════════════════════════════════════════════════════════════════════
// 1. orchBatchComplete integrate guidance visibility
// ═══════════════════════════════════════════════════════════════════════

describe("1.x — orchBatchComplete integrate guidance", () => {
	it("1.1: includes /orch-integrate command when orch branch exists and tasks succeeded", () => {
		const msg = ORCH_MESSAGES.orchBatchComplete(
			"batch-123", 3, 0, 0, 0, 120,
			"orch/op-batch-123", "main",
		);
		expect(msg).toContain("/orch-integrate");
		expect(msg).toContain("/orch-integrate --pr");
	});

	it("1.2: includes visual box separator for integrate guidance", () => {
		const msg = ORCH_MESSAGES.orchBatchComplete(
			"batch-123", 3, 0, 0, 0, 120,
			"orch/op-batch-123", "main",
		);
		// Check for the box drawing characters
		expect(msg).toContain("┌─");
		expect(msg).toContain("└─");
		expect(msg).toContain("👉");
	});

	it("1.3: shows orch branch name in integrate guidance", () => {
		const msg = ORCH_MESSAGES.orchBatchComplete(
			"batch-123", 3, 0, 0, 0, 120,
			"orch/op-batch-123", "main",
		);
		expect(msg).toContain("orch/op-batch-123");
	});

	it("1.4: includes preview command with base branch", () => {
		const msg = ORCH_MESSAGES.orchBatchComplete(
			"batch-123", 3, 0, 0, 0, 120,
			"orch/op-batch-123", "main",
		);
		expect(msg).toContain("git log main..orch/op-batch-123");
	});

	it("1.5: omits integrate guidance when no orch branch", () => {
		const msg = ORCH_MESSAGES.orchBatchComplete(
			"batch-123", 3, 0, 0, 0, 120,
		);
		expect(msg).not.toContain("/orch-integrate");
		expect(msg).not.toContain("┌─");
	});

	it("1.6: omits integrate guidance when no succeeded tasks", () => {
		const msg = ORCH_MESSAGES.orchBatchComplete(
			"batch-123", 0, 3, 0, 0, 120,
			"orch/op-batch-123", "main",
		);
		expect(msg).not.toContain("/orch-integrate");
	});

	it("1.7: shows failure guidance when tasks failed", () => {
		const msg = ORCH_MESSAGES.orchBatchComplete(
			"batch-123", 2, 1, 0, 0, 120,
			"orch/op-batch-123", "main",
		);
		// Should have both failure guidance and integrate guidance (partial success)
		expect(msg).toContain("/orch-status");
		expect(msg).toContain("/orch-integrate");
	});

	it("1.8: mentions working branch was not modified", () => {
		const msg = ORCH_MESSAGES.orchBatchComplete(
			"batch-123", 3, 0, 0, 0, 120,
			"orch/op-batch-123", "main",
		);
		expect(msg).toContain("main branch was not modified");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 2. Branch protection detection and pre-check
// ═══════════════════════════════════════════════════════════════════════

describe("2.x — branch protection detection", () => {
	it("2.1: detectBranchProtection returns a valid status type", () => {
		// In CI/test environment, gh may or may not be available.
		// The function should return one of the three valid values.
		const result = detectBranchProtection("main", process.cwd());
		expect(["protected", "unprotected", "unknown"]).toContain(result);
	});

	it("2.2: buildIntegrationPlan selects PR mode when branch is protected", () => {
		const batchState: Partial<OrchBatchRuntimeState> = {
			orchBranch: "orch/test-batch",
			baseBranch: "main",
			batchId: "test-123",
			succeededTasks: 3,
			failedTasks: 0,
		};
		const plan = buildIntegrationPlan(
			batchState as OrchBatchRuntimeState,
			process.cwd(),
			"protected", // override protection status
		);
		expect(plan).not.toBeNull();
		expect(plan!.mode).toBe("pr");
		expect(plan!.branchProtection).toBe("protected");
		expect(plan!.rationale).toContain("protected");
	});

	it("2.3: buildIntegrationPlan with unknown protection prefers FF/merge over PR (TP-149)", () => {
		const batchState: Partial<OrchBatchRuntimeState> = {
			orchBranch: "orch/test-batch",
			baseBranch: "main",
			batchId: "test-123",
			succeededTasks: 3,
			failedTasks: 0,
		};
		const plan = buildIntegrationPlan(
			batchState as OrchBatchRuntimeState,
			process.cwd(),
			"unknown",
		);
		expect(plan).not.toBeNull();
		// TP-149: unknown protection now falls through to FF/merge instead of defaulting to PR
		expect(["ff", "merge"]).toContain(plan!.mode);
		expect(plan!.branchProtection).toBe("unknown");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Protection hint in merge failure messages
// ═══════════════════════════════════════════════════════════════════════

describe("3.x — protection hint in merge failure messages", () => {
	it("3.1: ff failure includes protection hint when stderr mentions 'protected'", () => {
		const deps: IntegrationExecDeps = {
			runGit: (args: string[]) => {
				if (args[0] === "status") return { ok: true, stdout: "", stderr: "" };
				if (args[0] === "merge") {
					return {
						ok: false,
						stdout: "",
						stderr: "error: cannot push to protected branch",
					};
				}
				return { ok: true, stdout: "", stderr: "" };
			},
			runCommand: () => ({ ok: true, stdout: "", stderr: "" }),
			deleteBatchState: () => {},
		};

		const result = executeIntegration("ff", {
			orchBranch: "orch/test",
			baseBranch: "main",
			batchId: "test-123",
			currentBranch: "main",
			notices: [],
		}, deps);

		expect(result.success).toBe(false);
		expect(result.error).toContain("--pr");
		expect(result.error).toContain("protected");
	});

	it("3.2: ff failure does NOT include protection hint for normal divergence", () => {
		const deps: IntegrationExecDeps = {
			runGit: (args: string[]) => {
				if (args[0] === "status") return { ok: true, stdout: "", stderr: "" };
				if (args[0] === "merge") {
					return {
						ok: false,
						stdout: "",
						stderr: "fatal: Not possible to fast-forward, aborting.",
					};
				}
				return { ok: true, stdout: "", stderr: "" };
			},
			runCommand: () => ({ ok: true, stdout: "", stderr: "" }),
			deleteBatchState: () => {},
		};

		const result = executeIntegration("ff", {
			orchBranch: "orch/test",
			baseBranch: "main",
			batchId: "test-123",
			currentBranch: "main",
			notices: [],
		}, deps);

		expect(result.success).toBe(false);
		expect(result.error).toContain("--pr");
		expect(result.error).not.toContain("💡"); // No protection hint for normal divergence
	});

	it("3.3: merge failure includes protection hint when stderr mentions 'permission'", () => {
		const deps: IntegrationExecDeps = {
			runGit: (args: string[]) => {
				if (args[0] === "status") return { ok: true, stdout: "", stderr: "" };
				if (args[0] === "merge") {
					return {
						ok: false,
						stdout: "",
						stderr: "error: permission denied to push to branch",
					};
				}
				return { ok: true, stdout: "", stderr: "" };
			},
			runCommand: () => ({ ok: true, stdout: "", stderr: "" }),
			deleteBatchState: () => {},
		};

		const result = executeIntegration("merge", {
			orchBranch: "orch/test",
			baseBranch: "main",
			batchId: "test-123",
			currentBranch: "main",
			notices: [],
		}, deps);

		expect(result.success).toBe(false);
		expect(result.error).toContain("--pr");
		expect(result.error).toContain("💡");
	});
});
