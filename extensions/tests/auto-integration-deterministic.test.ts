/**
 * Deterministic Auto-Integration Tests — TP-043 R006
 *
 * Tests that require mocking of child_process.execFileSync to control
 * branch protection detection and git merge-base behavior. Separated
 * from auto-integration.test.ts because vi.mock is file-scoped.
 *
 *   17.x — Deterministic buildIntegrationPlan: protected→PR, unprotected+linear→ff, unprotected+diverged→merge
 *   18.x — Auto-mode executor call order + no confirmation prompt
 *   19.x — Manual-mode guidance + branch-protection default-to-PR
 *
 * Run: npx vitest run tests/auto-integration-deterministic.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

// ── Mock child_process ───────────────────────────────────────────────
// vi.mock is hoisted and applies to all imports in this file.
// We mock execFileSync so we can control detectBranchProtection and
// git merge-base results deterministically.
// Use vi.hoisted so the mock fn is available at hoist time.

const { mockExecFileSync } = vi.hoisted(() => ({
	mockExecFileSync: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
	const original = await importOriginal<typeof import("child_process")>();
	return {
		...original,
		execFileSync: mockExecFileSync,
	};
});

import {
	buildIntegrationPlan,
	detectBranchProtection,
	formatIntegrationPlan,
	formatIntegrationOutcome,
	triggerSupervisorIntegration,
	freshSupervisorState,
	presentBatchSummary,
	deactivateSupervisor,
} from "../taskplane/supervisor.ts";

import type {
	IntegrationPlan,
	IntegrationExecutor,
	SummaryDeps,
	SupervisorState,
} from "../taskplane/supervisor.ts";

import { freshOrchBatchState } from "../taskplane/types.ts";
import type { OrchBatchRuntimeState } from "../taskplane/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "auto-int-det-test-"));
}

function makeIntegrationBatchState(overrides?: Partial<OrchBatchRuntimeState>): OrchBatchRuntimeState {
	const state = freshOrchBatchState();
	state.batchId = "20260322T120000";
	state.baseBranch = "main";
	state.orchBranch = "orch/test-20260322T120000";
	state.phase = "completed";
	state.totalTasks = 5;
	state.succeededTasks = 4;
	state.failedTasks = 1;
	state.skippedTasks = 0;
	state.blockedTasks = 0;
	state.startedAt = Date.now() - 3600_000;
	state.endedAt = Date.now();
	if (overrides) Object.assign(state, overrides);
	return state;
}

function makeMockPi() {
	const messages: Array<{ opts: any; sendOpts: any }> = [];
	return {
		messages,
		sendMessage(opts: any, sendOpts?: any) {
			messages.push({ opts, sendOpts });
		},
	};
}

function makeMockExecutor(
	resultOrFn: { success: boolean; integratedLocally: boolean; commitCount: string; message: string; error?: string } |
		((mode: string, context: any) => { success: boolean; integratedLocally: boolean; commitCount: string; message: string; error?: string }),
): IntegrationExecutor & { calls: Array<{ mode: string; context: any }> } {
	const calls: Array<{ mode: string; context: any }> = [];
	const executor = ((mode: string, context: any) => {
		calls.push({ mode, context });
		if (typeof resultOrFn === "function") {
			return resultOrFn(mode, context);
		}
		return resultOrFn;
	}) as IntegrationExecutor & { calls: typeof calls };
	executor.calls = calls;
	return executor;
}

/**
 * Configure mockExecFileSync to simulate specific branch states.
 *
 * @param protection - "protected" | "unprotected" | "unknown"
 * @param isAncestor - true if baseBranch is ancestor of orchBranch (ff possible)
 */
function configureMockExecFileSync(
	protection: "protected" | "unprotected" | "unknown",
	isAncestor: boolean = true,
) {
	mockExecFileSync.mockImplementation((cmd: string, args: string[], _opts: any) => {
		// gh repo view -- used by detectBranchProtection
		if (cmd === "gh" && args[0] === "repo" && args[1] === "view") {
			return "owner/repo";
		}

		// gh api repos/.../protection -- branch protection check
		if (cmd === "gh" && args[0] === "api" && typeof args[1] === "string" && args[1].includes("/protection")) {
			if (protection === "protected") {
				return "{}"; // 200 OK → protected
			} else if (protection === "unprotected") {
				const err = new Error("HTTP 404") as Error & { stderr: string; status: number };
				err.stderr = "HTTP 404";
				err.status = 1;
				throw err;
			} else {
				// unknown
				const err = new Error("gh not available") as Error & { stderr: string; status: number };
				err.stderr = "gh not available";
				err.status = 1;
				throw err;
			}
		}

		// git merge-base --is-ancestor
		if (cmd === "git" && args[0] === "merge-base" && args[1] === "--is-ancestor") {
			if (isAncestor) {
				return ""; // exit 0 → is ancestor → ff possible
			} else {
				const err = new Error("not ancestor") as Error & { status: number };
				err.status = 1;
				throw err;
			}
		}

		// Default: throw for unexpected calls
		throw new Error(`Unexpected execFileSync call: ${cmd} ${args.join(" ")}`);
	});
}

// ═════════════════════════════════════════════════════════════════════
// 17.x — Deterministic buildIntegrationPlan branch tests
// ═════════════════════════════════════════════════════════════════════

describe("17.x — Deterministic buildIntegrationPlan: branch→mode mapping", () => {
	afterEach(() => {
		mockExecFileSync.mockReset();
	});

	it("17.1: protected base branch → PR mode", () => {
		configureMockExecFileSync("protected");
		const batchState = makeIntegrationBatchState();

		const plan = buildIntegrationPlan(batchState, "/fake/cwd");

		expect(plan).not.toBeNull();
		expect(plan!.mode).toBe("pr");
		expect(plan!.branchProtection).toBe("protected");
		expect(plan!.rationale).toContain("protected");
	});

	it("17.2: unknown protection → PR mode (safety fallback)", () => {
		configureMockExecFileSync("unknown");
		const batchState = makeIntegrationBatchState();

		const plan = buildIntegrationPlan(batchState, "/fake/cwd");

		expect(plan).not.toBeNull();
		expect(plan!.mode).toBe("pr");
		expect(plan!.branchProtection).toBe("unknown");
		expect(plan!.rationale).toContain("safety");
	});

	it("17.3: unprotected + linear history → ff mode", () => {
		configureMockExecFileSync("unprotected", true /* isAncestor */);
		const batchState = makeIntegrationBatchState();

		const plan = buildIntegrationPlan(batchState, "/fake/cwd");

		expect(plan).not.toBeNull();
		expect(plan!.mode).toBe("ff");
		expect(plan!.branchProtection).toBe("unprotected");
		expect(plan!.rationale).toContain("linear");
	});

	it("17.4: unprotected + diverged branches → merge mode", () => {
		configureMockExecFileSync("unprotected", false /* not ancestor */);
		const batchState = makeIntegrationBatchState();

		const plan = buildIntegrationPlan(batchState, "/fake/cwd");

		expect(plan).not.toBeNull();
		expect(plan!.mode).toBe("merge");
		expect(plan!.branchProtection).toBe("unprotected");
		expect(plan!.rationale).toContain("diverged");
	});

	it("17.5: plan includes correct task counts from batch state", () => {
		configureMockExecFileSync("unprotected", true);
		const batchState = makeIntegrationBatchState({ succeededTasks: 7, failedTasks: 2 });

		const plan = buildIntegrationPlan(batchState, "/fake/cwd");

		expect(plan).not.toBeNull();
		expect(plan!.succeededTasks).toBe(7);
		expect(plan!.failedTasks).toBe(2);
		expect(plan!.orchBranch).toBe("orch/test-20260322T120000");
		expect(plan!.baseBranch).toBe("main");
		expect(plan!.batchId).toBe("20260322T120000");
	});
});

// ═════════════════════════════════════════════════════════════════════
// 18.x — Auto-mode executor call order + no confirmation prompt
// ═════════════════════════════════════════════════════════════════════

describe("18.x — Auto mode: executor call order and message assertions", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		mockExecFileSync.mockReset();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("18.1: ff success — executor called once with ff mode, success message emitted, no confirmation", () => {
		configureMockExecFileSync("unprotected", true);
		const pi = makeMockPi();
		const state = freshSupervisorState();
		state.active = true;
		state.stateRoot = tmpDir;
		const batchState = makeIntegrationBatchState();

		const executor = makeMockExecutor({
			success: true,
			integratedLocally: true,
			commitCount: "5",
			message: "Fast-forwarded 5 commits",
		});

		triggerSupervisorIntegration(pi as any, state, batchState, "auto", "/fake/cwd", executor);

		// Executor called exactly once with ff mode
		expect(executor.calls).toHaveLength(1);
		expect(executor.calls[0].mode).toBe("ff");
		expect(executor.calls[0].context.orchBranch).toBe("orch/test-20260322T120000");
		expect(executor.calls[0].context.baseBranch).toBe("main");

		// Success message emitted (no confirmation prompt)
		const integrationMsg = pi.messages.find(
			(m: any) => m.opts.customType === "supervisor-integration-result",
		);
		expect(integrationMsg).toBeDefined();
		expect(integrationMsg!.opts.content[0].text).toContain("✅");
		expect(integrationMsg!.opts.content[0].text).toContain("Integration complete");
		expect(integrationMsg!.sendOpts.triggerTurn).toBe(false);

		// NO confirmation-related messages (no triggerTurn: true)
		const confirmMsgs = pi.messages.filter(
			(m: any) => m.sendOpts && m.sendOpts.triggerTurn === true,
		);
		expect(confirmMsgs).toHaveLength(0);

		// Supervisor deactivated
		expect(state.active).toBe(false);
	});

	it("18.2: ff failure → automatic merge fallback — executor called twice", () => {
		configureMockExecFileSync("unprotected", true);
		const pi = makeMockPi();
		const state = freshSupervisorState();
		state.active = true;
		state.stateRoot = tmpDir;
		const batchState = makeIntegrationBatchState();

		const executor = makeMockExecutor((mode) => {
			if (mode === "ff") {
				return { success: false, integratedLocally: false, commitCount: "0", message: "not linear", error: "branches diverged" };
			}
			return { success: true, integratedLocally: true, commitCount: "3", message: "Merged 3 commits" };
		});

		triggerSupervisorIntegration(pi as any, state, batchState, "auto", "/fake/cwd", executor);

		// Executor called twice: ff first, then merge fallback
		expect(executor.calls).toHaveLength(2);
		expect(executor.calls[0].mode).toBe("ff");
		expect(executor.calls[1].mode).toBe("merge");

		// Success message includes fallback warning
		const resultMsg = pi.messages.find(
			(m: any) => m.opts.customType === "supervisor-integration-result",
		);
		expect(resultMsg).toBeDefined();
		expect(resultMsg!.opts.content[0].text).toContain("✅");
		expect(resultMsg!.opts.content[0].text).toContain("Fast-forward failed");
		expect(resultMsg!.opts.content[0].text).toContain("Fell back to merge");

		// No confirmation prompts
		const confirmMsgs = pi.messages.filter(
			(m: any) => m.sendOpts && m.sendOpts.triggerTurn === true,
		);
		expect(confirmMsgs).toHaveLength(0);

		expect(state.active).toBe(false);
	});

	it("18.3: both ff and merge fail — error reported, no confirmation", () => {
		configureMockExecFileSync("unprotected", true);
		const pi = makeMockPi();
		const state = freshSupervisorState();
		state.active = true;
		state.stateRoot = tmpDir;
		const batchState = makeIntegrationBatchState();

		const executor = makeMockExecutor({
			success: false,
			integratedLocally: false,
			commitCount: "0",
			message: "conflict in src/app.ts",
			error: "Merge conflict in src/app.ts",
		});

		triggerSupervisorIntegration(pi as any, state, batchState, "auto", "/fake/cwd", executor);

		// Executor called twice (ff + merge fallback both fail)
		expect(executor.calls).toHaveLength(2);
		expect(executor.calls[0].mode).toBe("ff");
		expect(executor.calls[1].mode).toBe("merge");

		// Error message emitted
		const resultMsg = pi.messages.find(
			(m: any) => m.opts.customType === "supervisor-integration-result",
		);
		expect(resultMsg).toBeDefined();
		expect(resultMsg!.opts.content[0].text).toContain("❌");
		expect(resultMsg!.opts.content[0].text).toContain("Integration failed");
		expect(resultMsg!.opts.content[0].text).toContain("/orch-integrate");

		// No confirmation prompts
		const confirmMsgs = pi.messages.filter(
			(m: any) => m.sendOpts && m.sendOpts.triggerTurn === true,
		);
		expect(confirmMsgs).toHaveLength(0);

		expect(state.active).toBe(false);
	});

	it("18.4: no executor — fallback message with /orch-integrate, no confirmation", () => {
		configureMockExecFileSync("unprotected", true);
		const pi = makeMockPi();
		const state = freshSupervisorState();
		state.active = true;
		state.stateRoot = tmpDir;
		const batchState = makeIntegrationBatchState();

		triggerSupervisorIntegration(pi as any, state, batchState, "auto", "/fake/cwd", undefined);

		// Fallback message with /orch-integrate instruction
		expect(pi.messages.length).toBeGreaterThanOrEqual(1);
		const fallbackMsg = pi.messages.find(
			(m: any) => m.opts.content[0].text.includes("executor unavailable") ||
				m.opts.content[0].text.includes("/orch-integrate"),
		);
		expect(fallbackMsg).toBeDefined();
		expect(fallbackMsg!.sendOpts.triggerTurn).toBe(false);

		expect(state.active).toBe(false);
	});

	it("18.5: PR mode — executor called with pr mode, CI lifecycle message emitted", () => {
		configureMockExecFileSync("protected");
		const pi = makeMockPi();
		const state = freshSupervisorState();
		state.active = true;
		state.stateRoot = tmpDir;
		const batchState = makeIntegrationBatchState();

		const executor = makeMockExecutor({
			success: true,
			integratedLocally: false,
			commitCount: "0",
			message: "PR #42 created",
		});

		triggerSupervisorIntegration(pi as any, state, batchState, "auto", "/fake/cwd", executor);

		// Executor called with pr mode (since branch is protected)
		expect(executor.calls).toHaveLength(1);
		expect(executor.calls[0].mode).toBe("pr");

		// CI polling message emitted (since PR wasn't locally integrated)
		const progressMsg = pi.messages.find(
			(m: any) => m.opts.customType === "supervisor-integration-progress",
		);
		expect(progressMsg).toBeDefined();
		expect(progressMsg!.opts.content[0].text).toContain("CI");

		// No confirmation prompts
		const confirmMsgs = pi.messages.filter(
			(m: any) => m.sendOpts && m.sendOpts.triggerTurn === true,
		);
		expect(confirmMsgs).toHaveLength(0);
	});

	it("18.6: merge mode (diverged branches) — executor called with merge mode", () => {
		configureMockExecFileSync("unprotected", false /* diverged */);
		const pi = makeMockPi();
		const state = freshSupervisorState();
		state.active = true;
		state.stateRoot = tmpDir;
		const batchState = makeIntegrationBatchState();

		const executor = makeMockExecutor({
			success: true,
			integratedLocally: true,
			commitCount: "3",
			message: "Merged with 0 conflicts",
		});

		triggerSupervisorIntegration(pi as any, state, batchState, "auto", "/fake/cwd", executor);

		// Executor called with merge mode (branches diverged)
		expect(executor.calls).toHaveLength(1);
		expect(executor.calls[0].mode).toBe("merge");

		// Success message
		const resultMsg = pi.messages.find(
			(m: any) => m.opts.customType === "supervisor-integration-result",
		);
		expect(resultMsg).toBeDefined();
		expect(resultMsg!.opts.content[0].text).toContain("✅");

		expect(state.active).toBe(false);
	});
});

// ═════════════════════════════════════════════════════════════════════
// 19.x — Manual-mode guidance + branch-protection default-to-PR
// ═════════════════════════════════════════════════════════════════════

describe("19.x — Manual-mode guidance and branch-protection-detected default-to-PR", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		mockExecFileSync.mockReset();
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("19.1: manual mode — triggerSupervisorIntegration type signature excludes 'manual'", () => {
		// TypeScript type check: triggerSupervisorIntegration only accepts
		// "supervised" | "auto". Verify this via source inspection since
		// TS type errors aren't catchable at runtime.
		const source = readFileSync(
			join(dirname(fileURLToPath(import.meta.url)), "..", "taskplane", "supervisor.ts"),
			"utf-8",
		);
		const sigMatch = source.match(
			/export function triggerSupervisorIntegration\([^)]+integrationMode:\s*"([^"]+)"\s*\|\s*"([^"]+)"/,
		);
		expect(sigMatch).not.toBeNull();
		const modes = [sigMatch![1], sigMatch![2]].sort();
		expect(modes).toEqual(["auto", "supervised"]);
		// "manual" is NOT in the type — verified
	});

	it("19.2: manual mode — extension gates on supervised|auto before calling integration", () => {
		const source = readFileSync(
			join(dirname(fileURLToPath(import.meta.url)), "..", "taskplane", "extension.ts"),
			"utf-8",
		);
		// The extension checks mode === "supervised" || mode === "auto" before calling
		// triggerSupervisorIntegration, meaning manual mode falls through to the
		// deactivation path with summary presentation
		expect(source).toContain('mode === "supervised" || mode === "auto"');
		expect(source).toContain("triggerSupervisorIntegration");

		// In manual mode, extension calls presentBatchSummary + deactivateSupervisor directly
		// (the else branch after the supervised/auto gate)
		expect(source).toContain("presentBatchSummary");
		expect(source).toContain("deactivateSupervisor");
	});

	it("19.3: manual mode — operator gets batch summary and supervisor deactivates without integration", () => {
		// Manual mode path: presentBatchSummary → deactivateSupervisor
		// We can test this directly since these are the functions called in manual mode
		const pi = makeMockPi();
		const state = freshSupervisorState();
		state.active = true;
		state.stateRoot = tmpDir;
		const batchState = makeIntegrationBatchState();

		// This is what the extension does in manual mode:
		presentBatchSummary(pi as any, batchState, tmpDir, "op1");
		deactivateSupervisor(pi as any, state);

		// Summary message sent
		const summaryMsg = pi.messages.find(
			(m: any) => m.opts.customType === "supervisor-batch-summary",
		);
		expect(summaryMsg).toBeDefined();
		expect(summaryMsg!.opts.content[0].text).toContain("📊 **Batch Summary**");
		expect(summaryMsg!.opts.content[0].text).toContain("4/5 tasks succeeded");

		// Supervisor deactivated
		expect(state.active).toBe(false);

		// No integration-related messages (no /orch-integrate execution)
		const integrationMsgs = pi.messages.filter(
			(m: any) => m.opts.customType === "supervisor-integration-result" ||
				m.opts.customType === "supervisor-integration-progress",
		);
		expect(integrationMsgs).toHaveLength(0);
	});

	it("19.4: branch protection detected → defaults to PR mode in buildIntegrationPlan", () => {
		configureMockExecFileSync("protected");
		const batchState = makeIntegrationBatchState();

		const plan = buildIntegrationPlan(batchState, "/fake/cwd");

		expect(plan).not.toBeNull();
		expect(plan!.mode).toBe("pr");
		expect(plan!.branchProtection).toBe("protected");
		// formatIntegrationPlan shows protection info
		const text = formatIntegrationPlan(plan!);
		expect(text).toContain("pull request");
		expect(text).toContain("protection detected");
	});

	it("19.5: branch protection detected → supervised mode presents PR plan for confirmation", () => {
		configureMockExecFileSync("protected");
		const pi = makeMockPi();
		const state = freshSupervisorState();
		state.active = true;
		state.stateRoot = tmpDir;
		const batchState = makeIntegrationBatchState();

		const executor = makeMockExecutor({
			success: true,
			integratedLocally: false,
			commitCount: "0",
			message: "PR created",
		});

		triggerSupervisorIntegration(pi as any, state, batchState, "supervised", "/fake/cwd", executor);

		// Supervised mode: plan presented with triggerTurn: true
		const planMsg = pi.messages.find(
			(m: any) => m.opts.customType === "supervisor-integration" && m.sendOpts?.triggerTurn === true,
		);
		expect(planMsg).toBeDefined();
		expect(planMsg!.opts.content[0].text).toContain("pull request");
		expect(planMsg!.opts.content[0].text).toContain("--pr");
		expect(planMsg!.opts.content[0].text).toContain("confirmation");

		// Executor NOT called (supervised mode waits for confirmation)
		expect(executor.calls).toHaveLength(0);

		// Supervisor stays active (awaiting operator response)
		expect(state.active).toBe(true);
	});

	it("19.6: branch protection detected → auto mode executes PR without confirmation", () => {
		configureMockExecFileSync("protected");
		const pi = makeMockPi();
		const state = freshSupervisorState();
		state.active = true;
		state.stateRoot = tmpDir;
		const batchState = makeIntegrationBatchState();

		const executor = makeMockExecutor({
			success: true,
			integratedLocally: false,
			commitCount: "0",
			message: "PR #42 created",
		});

		triggerSupervisorIntegration(pi as any, state, batchState, "auto", "/fake/cwd", executor);

		// Auto mode: executor called with pr mode
		expect(executor.calls).toHaveLength(1);
		expect(executor.calls[0].mode).toBe("pr");

		// No confirmation prompt (triggerTurn: true)
		const confirmMsgs = pi.messages.filter(
			(m: any) => m.sendOpts && m.sendOpts.triggerTurn === true,
		);
		expect(confirmMsgs).toHaveLength(0);
	});
});

// ═════════════════════════════════════════════════════════════════════
// 20.x — detectBranchProtection deterministic tests
// ═════════════════════════════════════════════════════════════════════

describe("20.x — detectBranchProtection deterministic tests", () => {
	afterEach(() => {
		mockExecFileSync.mockReset();
	});

	it("20.1: returns 'protected' when gh api returns 200", () => {
		configureMockExecFileSync("protected");
		const result = detectBranchProtection("main", "/fake/cwd");
		expect(result).toBe("protected");
	});

	it("20.2: returns 'unprotected' when gh api returns 404", () => {
		configureMockExecFileSync("unprotected");
		const result = detectBranchProtection("main", "/fake/cwd");
		expect(result).toBe("unprotected");
	});

	it("20.3: returns 'unknown' when gh is unavailable", () => {
		mockExecFileSync.mockImplementation((cmd: string, args: string[], _opts: any) => {
			throw new Error("gh not found");
		});
		const result = detectBranchProtection("main", "/fake/cwd");
		expect(result).toBe("unknown");
	});

	it("20.4: returns 'unknown' when repo info is empty", () => {
		mockExecFileSync.mockImplementation((cmd: string, args: string[], _opts: any) => {
			if (cmd === "gh" && args[0] === "repo") {
				return ""; // empty repo info
			}
			throw new Error("unexpected");
		});
		const result = detectBranchProtection("main", "/fake/cwd");
		expect(result).toBe("unknown");
	});
});
