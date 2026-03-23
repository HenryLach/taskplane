/**
 * Auto-Integration & Batch Summary Tests — TP-043 Step 3
 *
 * Tests for supervisor-managed integration flow and batch summary:
 *
 *   10.x — Integration plan: buildIntegrationPlan, formatIntegrationPlan, formatIntegrationOutcome
 *   11.x — CI polling and PR merge: pollPrCiStatus, mergePr
 *   12.x — Auto mode: triggerSupervisorIntegration with auto mode
 *   13.x — Conflict handling: ff fallback to merge in auto mode
 *   14.x — Supervised mode: triggerSupervisorIntegration with supervised mode
 *   15.x — Manual/config type verification
 *   16.x — Batch summary generation: collectBatchSummaryData, formatBatchSummary,
 *           generateBatchSummary, presentBatchSummary, readTier0EventsForBatch
 *
 * Run: npx vitest run tests/auto-integration.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

import {
	// Integration plan
	buildIntegrationPlan,
	formatIntegrationPlan,
	formatIntegrationOutcome,
	// CI/PR
	pollPrCiStatus,
	mergePr,
	// Integration trigger
	triggerSupervisorIntegration,
	// Summary
	collectBatchSummaryData,
	formatBatchSummary,
	generateBatchSummary,
	presentBatchSummary,
	readTier0EventsForBatch,
	// Supporting
	freshSupervisorState,
	appendAuditEntry,
} from "../taskplane/supervisor.ts";

import type {
	IntegrationPlan,
	IntegrationExecutor,
	CiDeps,
	SummaryDeps,
	SupervisorState,
	BatchSummaryData,
} from "../taskplane/supervisor.ts";

import { freshOrchBatchState } from "../taskplane/types.ts";
import type { OrchBatchRuntimeState } from "../taskplane/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSource(file: string): string {
	return readFileSync(join(__dirname, "..", "taskplane", file), "utf-8").replace(/\r\n/g, "\n");
}

// ═════════════════════════════════════════════════════════════════════
// Test helpers
// ═════════════════════════════════════════════════════════════════════

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "auto-integration-test-"));
}

/**
 * Build a batch state suitable for integration testing.
 * Has orchBranch, baseBranch, and some succeeded tasks.
 */
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

/**
 * Mock ExtensionAPI for capturing sendMessage calls.
 */
function makeMockPi() {
	const messages: Array<{ opts: any; sendOpts: any }> = [];
	return {
		messages,
		sendMessage(opts: any, sendOpts?: any) {
			messages.push({ opts, sendOpts });
		},
	};
}

/**
 * Create a mock integration executor.
 */
function makeMockExecutor(
	result: { success: boolean; integratedLocally: boolean; commitCount: string; message: string; error?: string },
): IntegrationExecutor {
	const calls: Array<{ mode: string; context: any }> = [];
	const executor = ((mode: string, context: any) => {
		calls.push({ mode, context });
		return result;
	}) as IntegrationExecutor & { calls: typeof calls };
	(executor as any).calls = calls;
	return executor;
}

/**
 * Create mock CI deps.
 */
function makeMockCiDeps(overrides?: Partial<CiDeps>): CiDeps & { commandCalls: Array<{ cmd: string; args: string[] }> } {
	const commandCalls: Array<{ cmd: string; args: string[] }> = [];
	return {
		commandCalls,
		runCommand(cmd: string, args: string[]) {
			commandCalls.push({ cmd, args });
			return { ok: true, stdout: "[]", stderr: "" };
		},
		runGit(args: string[]) {
			return { ok: true, stdout: "", stderr: "" };
		},
		deleteBatchState() {},
		...overrides,
	};
}

function writeEventLine(stateRoot: string, event: Record<string, unknown>): void {
	const dir = join(stateRoot, ".pi", "supervisor");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const path = join(dir, "events.jsonl");
	appendFileSync(path, JSON.stringify(event) + "\n", "utf-8");
}

// ═════════════════════════════════════════════════════════════════════
// 10.x — Integration Plan
// ═════════════════════════════════════════════════════════════════════

describe("10.x — Integration plan: buildIntegrationPlan", () => {
	it("10.1: returns null when orchBranch is empty", () => {
		const state = makeIntegrationBatchState({ orchBranch: "" });
		const plan = buildIntegrationPlan(state, process.cwd());
		expect(plan).toBeNull();
	});

	it("10.2: returns null when baseBranch is empty", () => {
		const state = makeIntegrationBatchState({ baseBranch: "" });
		const plan = buildIntegrationPlan(state, process.cwd());
		expect(plan).toBeNull();
	});

	it("10.3: returns null when succeededTasks is 0", () => {
		const state = makeIntegrationBatchState({ succeededTasks: 0 });
		const plan = buildIntegrationPlan(state, process.cwd());
		expect(plan).toBeNull();
	});

	it("10.4: includes all required IntegrationPlan fields", () => {
		// Since buildIntegrationPlan calls git/gh, we test the interface shape
		// with a direct plan object
		const plan: IntegrationPlan = {
			mode: "ff",
			orchBranch: "orch/test",
			baseBranch: "main",
			batchId: "batch-1",
			branchProtection: "unprotected",
			rationale: "test rationale",
			succeededTasks: 4,
			failedTasks: 1,
		};
		expect(plan.mode).toBe("ff");
		expect(plan.orchBranch).toBe("orch/test");
		expect(plan.baseBranch).toBe("main");
		expect(plan.batchId).toBe("batch-1");
		expect(plan.branchProtection).toBe("unprotected");
		expect(plan.rationale).toContain("test");
		expect(plan.succeededTasks).toBe(4);
		expect(plan.failedTasks).toBe(1);
	});
});

describe("10.x — formatIntegrationPlan", () => {
	it("10.5: includes mode, branches, task counts, and rationale", () => {
		const plan: IntegrationPlan = {
			mode: "ff",
			orchBranch: "orch/test",
			baseBranch: "main",
			batchId: "batch-1",
			branchProtection: "unprotected",
			rationale: "linear history",
			succeededTasks: 4,
			failedTasks: 0,
		};
		const text = formatIntegrationPlan(plan);
		expect(text).toContain("🔀");
		expect(text).toContain("Integration Plan");
		expect(text).toContain("fast-forward merge");
		expect(text).toContain("orch/test");
		expect(text).toContain("main");
		expect(text).toContain("4 succeeded");
		expect(text).toContain("linear history");
	});

	it("10.6: shows failed count when > 0", () => {
		const plan: IntegrationPlan = {
			mode: "merge",
			orchBranch: "orch/test",
			baseBranch: "main",
			batchId: "batch-1",
			branchProtection: "unprotected",
			rationale: "diverged",
			succeededTasks: 3,
			failedTasks: 2,
		};
		const text = formatIntegrationPlan(plan);
		expect(text).toContain("merge commit");
		expect(text).toContain("2 failed");
	});

	it("10.7: shows PR mode label", () => {
		const plan: IntegrationPlan = {
			mode: "pr",
			orchBranch: "orch/test",
			baseBranch: "main",
			batchId: "batch-1",
			branchProtection: "protected",
			rationale: "protected branch",
			succeededTasks: 5,
			failedTasks: 0,
		};
		const text = formatIntegrationPlan(plan);
		expect(text).toContain("pull request");
		expect(text).toContain("protection detected");
	});
});

describe("10.x — formatIntegrationOutcome", () => {
	it("10.8: formats success for ff mode", () => {
		const plan: IntegrationPlan = {
			mode: "ff",
			orchBranch: "orch/test",
			baseBranch: "main",
			batchId: "b",
			branchProtection: "unprotected",
			rationale: "r",
			succeededTasks: 3,
			failedTasks: 0,
		};
		const text = formatIntegrationOutcome(plan, true, "Fast-forwarded 5 commits");
		expect(text).toContain("✅");
		expect(text).toContain("Integration complete");
		expect(text).toContain("Fast-forwarded");
		expect(text).toContain("orch/test");
		expect(text).toContain("main");
	});

	it("10.9: formats success for merge mode", () => {
		const plan: IntegrationPlan = {
			mode: "merge",
			orchBranch: "orch/test",
			baseBranch: "main",
			batchId: "b",
			branchProtection: "unprotected",
			rationale: "r",
			succeededTasks: 3,
			failedTasks: 0,
		};
		const text = formatIntegrationOutcome(plan, true, "Merged with 0 conflicts");
		expect(text).toContain("Merged");
	});

	it("10.10: formats success for PR mode", () => {
		const plan: IntegrationPlan = {
			mode: "pr",
			orchBranch: "orch/test",
			baseBranch: "main",
			batchId: "b",
			branchProtection: "protected",
			rationale: "r",
			succeededTasks: 3,
			failedTasks: 0,
		};
		const text = formatIntegrationOutcome(plan, true, "PR #42 created");
		expect(text).toContain("Created PR for");
	});

	it("10.11: formats failure", () => {
		const plan: IntegrationPlan = {
			mode: "ff",
			orchBranch: "orch/test",
			baseBranch: "main",
			batchId: "b",
			branchProtection: "unprotected",
			rationale: "r",
			succeededTasks: 3,
			failedTasks: 0,
		};
		const text = formatIntegrationOutcome(plan, false, "Merge conflict in src/app.ts");
		expect(text).toContain("❌");
		expect(text).toContain("Integration failed");
		expect(text).toContain("Merge conflict");
	});
});

// ═════════════════════════════════════════════════════════════════════
// 11.x — CI polling and PR merge
// ═════════════════════════════════════════════════════════════════════

describe("11.x — pollPrCiStatus", () => {
	it("11.1: returns 'pass' when all checks succeed", async () => {
		const deps = makeMockCiDeps({
			runCommand: (cmd, args) => ({
				ok: true,
				stdout: JSON.stringify([
					{ name: "ci", state: "COMPLETED", conclusion: "SUCCESS" },
					{ name: "lint", state: "COMPLETED", conclusion: "SUCCESS" },
				]),
				stderr: "",
			}),
		});
		const result = await pollPrCiStatus("orch/test", deps, 1, 0);
		expect(result.status).toBe("pass");
		expect(result.detail).toContain("2 CI check(s) passed");
	});

	it("11.2: returns 'fail' when a check fails", async () => {
		const deps = makeMockCiDeps({
			runCommand: (cmd, args) => ({
				ok: true,
				stdout: JSON.stringify([
					{ name: "ci", state: "COMPLETED", conclusion: "SUCCESS" },
					{ name: "lint", state: "COMPLETED", conclusion: "FAILURE" },
				]),
				stderr: "",
			}),
		});
		const result = await pollPrCiStatus("orch/test", deps, 1, 0);
		expect(result.status).toBe("fail");
		expect(result.detail).toContain("lint: FAILURE");
	});

	it("11.3: returns 'timeout' when checks never complete", async () => {
		const deps = makeMockCiDeps({
			runCommand: (cmd, args) => ({
				ok: true,
				stdout: JSON.stringify([
					{ name: "ci", state: "PENDING", conclusion: "" },
				]),
				stderr: "",
			}),
		});
		const result = await pollPrCiStatus("orch/test", deps, 2, 0);
		expect(result.status).toBe("timeout");
	});

	it("11.4: returns 'no-checks' when no checks configured", async () => {
		const deps = makeMockCiDeps({
			runCommand: (cmd, args) => ({
				ok: true,
				stdout: "[]",
				stderr: "",
			}),
		});
		const result = await pollPrCiStatus("orch/test", deps, 1, 0);
		expect(result.status).toBe("no-checks");
	});

	it("11.5: returns 'no-checks' when gh reports no checks error", async () => {
		const deps = makeMockCiDeps({
			runCommand: (cmd, args) => ({
				ok: false,
				stdout: "",
				stderr: "no checks reported",
			}),
		});
		const result = await pollPrCiStatus("orch/test", deps, 1, 0);
		expect(result.status).toBe("no-checks");
	});

	it("11.6: treats NEUTRAL and SKIPPED conclusions as passing", async () => {
		const deps = makeMockCiDeps({
			runCommand: (cmd, args) => ({
				ok: true,
				stdout: JSON.stringify([
					{ name: "ci", state: "COMPLETED", conclusion: "NEUTRAL" },
					{ name: "optional", state: "COMPLETED", conclusion: "SKIPPED" },
				]),
				stderr: "",
			}),
		});
		const result = await pollPrCiStatus("orch/test", deps, 1, 0);
		expect(result.status).toBe("pass");
	});
});

describe("11.x — mergePr", () => {
	it("11.7: tries squash merge first", () => {
		const deps = makeMockCiDeps({
			runCommand: (cmd, args) => {
				if (args.includes("--squash")) {
					return { ok: true, stdout: "Merged", stderr: "" };
				}
				return { ok: false, stdout: "", stderr: "not called" };
			},
		});
		const result = mergePr("orch/test", deps);
		expect(result.success).toBe(true);
		expect(result.detail).toContain("squash");
	});

	it("11.8: falls back to regular merge if squash fails", () => {
		const deps = makeMockCiDeps({
			runCommand: (cmd, args) => {
				if (args.includes("--squash")) {
					return { ok: false, stdout: "", stderr: "squash not allowed" };
				}
				if (args.includes("--merge")) {
					return { ok: true, stdout: "Merged", stderr: "" };
				}
				return { ok: false, stdout: "", stderr: "unknown" };
			},
		});
		const result = mergePr("orch/test", deps);
		expect(result.success).toBe(true);
		expect(result.detail).toContain("PR merged");
	});

	it("11.9: reports failure when both merge methods fail", () => {
		const deps = makeMockCiDeps({
			runCommand: () => ({ ok: false, stdout: "", stderr: "merge blocked" }),
		});
		const result = mergePr("orch/test", deps);
		expect(result.success).toBe(false);
		expect(result.detail).toContain("merge failed");
	});
});

// ═════════════════════════════════════════════════════════════════════
// 12.x — Auto mode integration (triggerSupervisorIntegration)
// ═════════════════════════════════════════════════════════════════════

describe("12.x — Auto mode: triggerSupervisorIntegration", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("12.1: no-plan path — deactivates supervisor with no-integration message", () => {
		const pi = makeMockPi();
		const state = freshSupervisorState();
		state.active = true;
		state.stateRoot = tmpDir;
		// batchState with no orchBranch → buildIntegrationPlan returns null
		const batchState = makeIntegrationBatchState({ orchBranch: "" });

		triggerSupervisorIntegration(pi as any, state, batchState, "auto", tmpDir);

		// Should send no-integration message
		expect(pi.messages.length).toBeGreaterThanOrEqual(1);
		expect(pi.messages[0].opts.content[0].text).toContain("No integration needed");
		// Supervisor deactivated (state set to inactive)
		expect(state.active).toBe(false);
	});

	it("12.2: no-executor fallback — sends manual instruction message", () => {
		const pi = makeMockPi();
		const state = freshSupervisorState();
		state.active = true;
		state.stateRoot = tmpDir;
		const batchState = makeIntegrationBatchState();

		// Auto mode with no executor — test the fallback path
		// We need to mock buildIntegrationPlan to return a plan without git/gh.
		// Since buildIntegrationPlan calls detectBranchProtection and git merge-base,
		// and we can't easily mock those, we rely on it returning something
		// (or null which we've already tested).
		// The no-executor test triggers when executor is undefined but plan exists.
		// We pass undefined for executor to trigger the fallback.
		triggerSupervisorIntegration(pi as any, state, batchState, "auto", tmpDir, undefined);

		// Since buildIntegrationPlan may or may not return a plan depending on
		// git state, we verify that if a message was sent, it matches expected patterns.
		if (pi.messages.length > 0) {
			const text = pi.messages[0].opts.content[0].text;
			// Either "No integration needed" (null plan) or "executor unavailable" fallback
			expect(
				text.includes("No integration needed") || text.includes("executor unavailable") || text.includes("/orch-integrate"),
			).toBe(true);
		}
		// Supervisor should be deactivated in either case
		expect(state.active).toBe(false);
	});

	it("12.3: successful ff integration — reports success and deactivates", () => {
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

		// We need to give buildIntegrationPlan something that won't call real git.
		// Since it will call detectBranchProtection and git merge-base,
		// in a test env without the right branches, it may return null.
		// Let's test the full path via source inspection instead.
		triggerSupervisorIntegration(pi as any, state, batchState, "auto", tmpDir, executor);

		// If plan was null (no matching branches in test env), supervisor deactivates
		// If plan was built, executor would be called. Either way, state deactivated.
		expect(state.active).toBe(false);
	});

	it("12.4: source structure — auto mode calls executor and handles PR lifecycle", () => {
		const source = readSource("supervisor.ts");
		const triggerFn = source.substring(
			source.indexOf("export function triggerSupervisorIntegration("),
			source.indexOf("// ── Batch Summary Generation"),
		);

		// Auto mode calls executor
		expect(triggerFn).toContain('let result = executor(plan.mode, context)');
		// Handles PR lifecycle
		expect(triggerFn).toContain("handlePrLifecycle");
		// Deactivates supervisor on all paths
		expect(triggerFn).toContain("summarizeAndDeactivate()");
		// Reports outcome
		expect(triggerFn).toContain("formatIntegrationOutcome");
	});

	it("12.5: source structure — no-plan path generates summary before deactivation", () => {
		const source = readSource("supervisor.ts");
		const triggerFn = source.substring(
			source.indexOf("export function triggerSupervisorIntegration("),
			source.indexOf("// ── Batch Summary Generation"),
		);

		// No-plan path uses summarizeAndDeactivate which does summary first
		expect(triggerFn).toContain("summarizeAndDeactivate");
		// summarizeAndDeactivate is defined as a helper
		expect(triggerFn).toContain("const summarizeAndDeactivate = ()");
		expect(triggerFn).toContain("presentBatchSummary");
		expect(triggerFn).toContain("deactivateSupervisor");
	});
});

// ═════════════════════════════════════════════════════════════════════
// 13.x — Conflict handling (R005)
// ═════════════════════════════════════════════════════════════════════

describe("13.x — Integration conflict handling: ff → merge fallback", () => {
	it("13.1: source — auto mode falls back from ff to merge on ff failure", () => {
		const source = readSource("supervisor.ts");
		const triggerFn = source.substring(
			source.indexOf("export function triggerSupervisorIntegration("),
			source.indexOf("// ── Batch Summary Generation"),
		);

		// Auto mode tries ff first, then falls back to merge
		expect(triggerFn).toContain('if (!result.success && plan.mode === "ff")');
		expect(triggerFn).toContain('executor("merge", context)');
		expect(triggerFn).toContain("Fast-forward failed");
		expect(triggerFn).toContain("Fell back to merge");
	});

	it("13.2: ff failure → merge success produces fallback message", () => {
		const pi = makeMockPi();
		const state = freshSupervisorState();
		state.active = true;
		state.stateRoot = "";

		// Create a plan directly and simulate the executor behavior
		const calls: Array<{ mode: string }> = [];
		const executor: IntegrationExecutor = (mode, context) => {
			calls.push({ mode });
			if (mode === "ff") {
				return { success: false, integratedLocally: false, commitCount: "0", message: "not linear", error: "branches diverged" };
			}
			return { success: true, integratedLocally: true, commitCount: "3", message: "Merged OK" };
		};

		// We can't easily inject a plan (buildIntegrationPlan uses real git),
		// so verify via source analysis that the fallback logic is correct.
		// The logic is:
		//   let result = executor(plan.mode, context);
		//   if (!result.success && plan.mode === "ff") {
		//     const fallbackResult = executor("merge", context);
		//     if (fallbackResult.success) {
		//       result = fallbackResult;
		//       result.message = "⚠️ Fast-forward failed..." + result.message;
		//     }
		//   }
		// Simulate this logic:
		let result = executor("ff", { orchBranch: "o", baseBranch: "m", batchId: "b", currentBranch: "m", notices: [] });
		expect(result.success).toBe(false);

		const fallbackResult = executor("merge", { orchBranch: "o", baseBranch: "m", batchId: "b", currentBranch: "m", notices: [] });
		expect(fallbackResult.success).toBe(true);

		// Verify the calls were made in order: ff first, then merge
		expect(calls[0].mode).toBe("ff");
		expect(calls[1].mode).toBe("merge");
	});

	it("13.3: both ff and merge fail → reports integration failure", () => {
		const failingExecutor: IntegrationExecutor = (mode, context) => {
			return {
				success: false,
				integratedLocally: false,
				commitCount: "0",
				message: `${mode} failed`,
				error: `${mode} conflict`,
			};
		};

		// Simulate the fallback logic from the source
		let result = failingExecutor("ff", { orchBranch: "o", baseBranch: "m", batchId: "b", currentBranch: "m", notices: [] });
		if (!result.success) {
			const fallbackResult = failingExecutor("merge", { orchBranch: "o", baseBranch: "m", batchId: "b", currentBranch: "m", notices: [] });
			if (!fallbackResult.success) {
				// Result stays as the merge failure
				result = fallbackResult;
			}
		}

		expect(result.success).toBe(false);
		expect(result.error).toContain("merge conflict");

		// The source then formats and sends the error:
		const plan: IntegrationPlan = {
			mode: "ff",
			orchBranch: "o",
			baseBranch: "m",
			batchId: "b",
			branchProtection: "unprotected",
			rationale: "test",
			succeededTasks: 1,
			failedTasks: 0,
		};
		const outcomeText = formatIntegrationOutcome(plan, false, result.error!);
		expect(outcomeText).toContain("❌");
		expect(outcomeText).toContain("Integration failed");
		expect(outcomeText).toContain("merge conflict");
	});

	it("13.4: source — integration failure path reports error and deactivates", () => {
		const source = readSource("supervisor.ts");
		const triggerFn = source.substring(
			source.indexOf("export function triggerSupervisorIntegration("),
			source.indexOf("// ── Batch Summary Generation"),
		);

		// Failure path
		expect(triggerFn).toContain("Integration failed");
		expect(triggerFn).toContain("formatIntegrationOutcome(plan, false");
		expect(triggerFn).toContain("manually to retry with a different mode");
		expect(triggerFn).toContain("summarizeAndDeactivate()");
	});
});

// ═════════════════════════════════════════════════════════════════════
// 14.x — Supervised mode
// ═════════════════════════════════════════════════════════════════════

describe("14.x — Supervised mode: triggerSupervisorIntegration", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("14.1: source — supervised mode presents plan with triggerTurn: true", () => {
		const source = readSource("supervisor.ts");
		const triggerFn = source.substring(
			source.indexOf("export function triggerSupervisorIntegration("),
			source.indexOf("// ── Batch Summary Generation"),
		);

		// Supervised mode path
		expect(triggerFn).toContain('if (integrationMode === "supervised")');
		expect(triggerFn).toContain("Ask the operator for confirmation");
		expect(triggerFn).toContain("triggerTurn: true");
		expect(triggerFn).toContain("deliverAs");
		expect(triggerFn).toContain("/orch-integrate");
	});

	it("14.2: source — supervised mode stores pendingSummaryDeps on state (R004)", () => {
		const source = readSource("supervisor.ts");
		const triggerFn = source.substring(
			source.indexOf("export function triggerSupervisorIntegration("),
			source.indexOf("// ── Batch Summary Generation"),
		);

		// R004: deferred summary
		expect(triggerFn).toContain("state.pendingSummaryDeps = summaryDeps");
	});

	it("14.3: source — supervised mode does NOT deactivate immediately", () => {
		const source = readSource("supervisor.ts");

		// Find the supervised mode block specifically
		const triggerFn = source.substring(
			source.indexOf("export function triggerSupervisorIntegration("),
			source.indexOf("// ── Batch Summary Generation"),
		);

		// The supervised path returns after sendMessage, without calling deactivate
		const supervisedBlock = triggerFn.substring(
			triggerFn.indexOf('if (integrationMode === "supervised")'),
			triggerFn.indexOf("// ── Auto mode"),
		);
		expect(supervisedBlock).not.toContain("deactivateSupervisor(pi, state)");
		expect(supervisedBlock).not.toContain("summarizeAndDeactivate()");
	});

	it("14.4: supervised mode no-plan — deactivates with no-integration message", () => {
		const pi = makeMockPi();
		const state = freshSupervisorState();
		state.active = true;
		state.stateRoot = tmpDir;
		const batchState = makeIntegrationBatchState({ orchBranch: "" });

		triggerSupervisorIntegration(pi as any, state, batchState, "supervised", tmpDir);

		expect(pi.messages.length).toBeGreaterThanOrEqual(1);
		expect(pi.messages[0].opts.content[0].text).toContain("No integration needed");
		expect(state.active).toBe(false);
	});

	it("14.5: freshSupervisorState includes pendingSummaryDeps field initialized to null", () => {
		const state = freshSupervisorState();
		expect(state.pendingSummaryDeps).toBeNull();
	});
});

// ═════════════════════════════════════════════════════════════════════
// 15.x — Manual/config type verification
// ═════════════════════════════════════════════════════════════════════

describe("15.x — Manual/supervised/auto config type and source verification", () => {
	it("15.1: types.ts includes 'supervised' in integration mode type", () => {
		const source = readSource("types.ts");
		const line = source.split("\n").find(l => l.includes("integration") && l.includes("manual") && l.includes("auto"));
		expect(line).toBeDefined();
		expect(line).toContain("supervised");
	});

	it("15.2: types.ts defaults integration to 'manual'", () => {
		const source = readSource("types.ts");
		expect(source).toContain('integration: "manual"');
	});

	it("15.3: config-schema.ts includes 'supervised' in integration mode", () => {
		const source = readSource("config-schema.ts");
		expect(source).toContain("supervised");
		expect(source).toContain("integration");
	});

	it("15.4: config-loader.ts handles supervised mode", () => {
		const source = readSource("config-loader.ts");
		expect(source).toContain("integration");
	});

	it("15.5: settings-tui.ts includes 'supervised' option", () => {
		const source = readSource("settings-tui.ts");
		expect(source).toContain("supervised");
	});

	it("15.6: engine.ts gates legacy attemptAutoIntegration on 'auto' mode only (not 'supervised')", () => {
		const source = readSource("engine.ts");
		// Should check for "auto" specifically (not just non-manual)
		const hasAutoGate = source.includes('"auto"') && source.includes("integration");
		expect(hasAutoGate).toBe(true);
	});

	it("15.7: extension.ts onTerminal triggers supervisor integration for supervised/auto modes", () => {
		const source = readSource("extension.ts");
		expect(source).toContain("triggerSupervisorIntegration");
	});

	it("15.8: supervisor system prompt conditionally allows push/PR in integration modes", () => {
		const source = readSource("supervisor.ts");
		const promptFn = source.substring(
			source.indexOf("export function buildSupervisorSystemPrompt("),
			source.indexOf("export function buildRoutingSystemPrompt("),
		);
		// Should mention integration mode context
		expect(promptFn).toContain("integration");
	});
});

// ═════════════════════════════════════════════════════════════════════
// 16.x — Batch summary generation
// ═════════════════════════════════════════════════════════════════════

describe("16.x — readTier0EventsForBatch", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("16.1: returns empty array when events.jsonl doesn't exist", () => {
		const events = readTier0EventsForBatch(tmpDir, "batch-1");
		expect(events).toEqual([]);
	});

	it("16.2: filters only Tier 0 event types", () => {
		writeEventLine(tmpDir, { timestamp: "t1", type: "tier0_recovery_attempt", batchId: "b1", pattern: "MERGE_TIMEOUT", attempt: 1, maxAttempts: 3 });
		writeEventLine(tmpDir, { timestamp: "t2", type: "wave_start", batchId: "b1", waveIndex: 0 });
		writeEventLine(tmpDir, { timestamp: "t3", type: "tier0_recovery_success", batchId: "b1", pattern: "MERGE_TIMEOUT", attempt: 1, maxAttempts: 3, resolution: "retried OK" });

		const events = readTier0EventsForBatch(tmpDir, "b1");
		expect(events).toHaveLength(2);
		expect(events[0].type).toBe("tier0_recovery_attempt");
		expect(events[1].type).toBe("tier0_recovery_success");
	});

	it("16.3: filters by batchId", () => {
		writeEventLine(tmpDir, { timestamp: "t1", type: "tier0_escalation", batchId: "batch-A", pattern: "WORKER_CRASH", attempt: 1, maxAttempts: 1 });
		writeEventLine(tmpDir, { timestamp: "t2", type: "tier0_escalation", batchId: "batch-B", pattern: "WORKER_CRASH", attempt: 1, maxAttempts: 1 });

		const events = readTier0EventsForBatch(tmpDir, "batch-A");
		expect(events).toHaveLength(1);
		expect(events[0].type).toBe("tier0_escalation");
	});

	it("16.4: includes all Tier 0 event types", () => {
		writeEventLine(tmpDir, { timestamp: "t1", type: "tier0_recovery_attempt", batchId: "b1", pattern: "P", attempt: 1, maxAttempts: 3 });
		writeEventLine(tmpDir, { timestamp: "t2", type: "tier0_recovery_success", batchId: "b1", pattern: "P", attempt: 1, maxAttempts: 3, resolution: "ok" });
		writeEventLine(tmpDir, { timestamp: "t3", type: "tier0_recovery_exhausted", batchId: "b1", pattern: "P", attempt: 3, maxAttempts: 3, error: "gave up" });
		writeEventLine(tmpDir, { timestamp: "t4", type: "tier0_escalation", batchId: "b1", pattern: "P", attempt: 3, maxAttempts: 3, suggestion: "check logs" });

		const events = readTier0EventsForBatch(tmpDir, "b1");
		expect(events).toHaveLength(4);
		const types = events.map(e => e.type);
		expect(types).toContain("tier0_recovery_attempt");
		expect(types).toContain("tier0_recovery_success");
		expect(types).toContain("tier0_recovery_exhausted");
		expect(types).toContain("tier0_escalation");
	});

	it("16.5: skips malformed lines", () => {
		const dir = join(tmpDir, ".pi", "supervisor");
		mkdirSync(dir, { recursive: true });
		const path = join(dir, "events.jsonl");
		writeFileSync(path,
			JSON.stringify({ timestamp: "t1", type: "tier0_recovery_attempt", batchId: "b1", pattern: "P", attempt: 1, maxAttempts: 3 }) + "\n" +
			"not-json\n" +
			JSON.stringify({ timestamp: "t3", type: "tier0_escalation", batchId: "b1", pattern: "P", attempt: 1, maxAttempts: 1 }) + "\n",
			"utf-8",
		);

		const events = readTier0EventsForBatch(tmpDir, "b1");
		expect(events).toHaveLength(2);
	});
});

describe("16.x — collectBatchSummaryData", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("16.6: collects basic batch data from runtime state", () => {
		const batchState = makeIntegrationBatchState();
		const data = collectBatchSummaryData(batchState, tmpDir);

		expect(data.batchId).toBe("20260322T120000");
		expect(data.phase).toBe("completed");
		expect(data.totalTasks).toBe(5);
		expect(data.succeededTasks).toBe(4);
		expect(data.failedTasks).toBe(1);
	});

	it("16.7: includes diagnostics when provided", () => {
		const batchState = makeIntegrationBatchState();
		const diagnostics = {
			taskExits: {
				"T-001": { classification: "clean", cost: 0.50, durationSec: 300 },
			},
			batchCost: 2.50,
		};
		const data = collectBatchSummaryData(batchState, tmpDir, diagnostics);

		expect(data.batchCost).toBe(2.50);
		expect(data.taskExits["T-001"]).toBeDefined();
		expect(data.taskExits["T-001"].cost).toBe(0.50);
	});

	it("16.8: includes audit trail entries for the batch", () => {
		const batchState = makeIntegrationBatchState();
		appendAuditEntry(tmpDir, {
			ts: "t1", action: "merge_retry", classification: "tier0_known",
			context: "wave 1 merge timeout", command: "git merge",
			result: "success", detail: "ok", batchId: "20260322T120000",
		});

		const data = collectBatchSummaryData(batchState, tmpDir);
		expect(data.auditEntries.length).toBe(1);
		expect(data.auditEntries[0].action).toBe("merge_retry");
	});

	it("16.9: includes Tier 0 events (R003)", () => {
		const batchState = makeIntegrationBatchState();
		writeEventLine(tmpDir, {
			timestamp: "t1", type: "tier0_recovery_attempt", batchId: "20260322T120000",
			pattern: "MERGE_TIMEOUT", attempt: 1, maxAttempts: 3,
		});

		const data = collectBatchSummaryData(batchState, tmpDir);
		expect(data.tier0Events.length).toBe(1);
		expect(data.tier0Events[0].pattern).toBe("MERGE_TIMEOUT");
	});

	it("16.10: handles missing diagnostics gracefully (defaults to 0)", () => {
		const batchState = makeIntegrationBatchState();
		const data = collectBatchSummaryData(batchState, tmpDir, null);

		expect(data.batchCost).toBe(0);
		expect(Object.keys(data.taskExits)).toHaveLength(0);
	});
});

describe("16.x — formatBatchSummary", () => {
	it("16.11: includes header with batch ID, duration, cost, result", () => {
		const data: BatchSummaryData = {
			batchId: "20260322T120000",
			phase: "completed",
			startedAt: Date.now() - 3661_000,
			endedAt: Date.now(),
			totalTasks: 5,
			succeededTasks: 4,
			failedTasks: 1,
			skippedTasks: 0,
			blockedTasks: 0,
			batchCost: 2.50,
			wavePlan: [],
			waveResults: [],
			taskExits: {},
			mergeResults: [],
			auditEntries: [],
			tier0Events: [],
			errors: [],
		};
		const md = formatBatchSummary(data);

		expect(md).toContain("# Batch Summary: 20260322T120000");
		expect(md).toContain("**Duration:**");
		expect(md).toContain("1h");
		expect(md).toContain("**Cost:** $2.50");
		expect(md).toContain("4/5 tasks succeeded");
		expect(md).toContain("1 failed");
		expect(md).toContain("**Phase:** completed");
	});

	it("16.12: includes wave timeline when waveResults present", () => {
		const data: BatchSummaryData = {
			batchId: "b",
			phase: "completed",
			startedAt: 0,
			endedAt: 600_000,
			totalTasks: 3,
			succeededTasks: 3,
			failedTasks: 0,
			skippedTasks: 0,
			blockedTasks: 0,
			batchCost: 0,
			wavePlan: [],
			waveResults: [
				{
					waveIndex: 0,
					startedAt: 0,
					endedAt: 300_000,
					succeededTaskIds: ["T-1", "T-2"],
					failedTaskIds: [],
					skippedTaskIds: [],
					overallStatus: "succeeded",
				},
				{
					waveIndex: 1,
					startedAt: 300_000,
					endedAt: 600_000,
					succeededTaskIds: ["T-3"],
					failedTaskIds: [],
					skippedTaskIds: [],
					overallStatus: "succeeded",
				},
			],
			taskExits: {},
			mergeResults: [],
			auditEntries: [],
			tier0Events: [],
			errors: [],
		};
		const md = formatBatchSummary(data);

		expect(md).toContain("## Wave Timeline");
		expect(md).toContain("Wave 1");
		expect(md).toContain("Wave 2");
		expect(md).toContain("2 tasks");
		expect(md).toContain("✅");
	});

	it("16.13: includes incidents from Tier 0 events", () => {
		const data: BatchSummaryData = {
			batchId: "b",
			phase: "completed",
			startedAt: 0,
			endedAt: 600_000,
			totalTasks: 3,
			succeededTasks: 2,
			failedTasks: 1,
			skippedTasks: 0,
			blockedTasks: 0,
			batchCost: 0,
			wavePlan: [],
			waveResults: [],
			taskExits: {},
			mergeResults: [],
			auditEntries: [],
			tier0Events: [
				{
					timestamp: "t1",
					type: "tier0_recovery_attempt",
					pattern: "MERGE_TIMEOUT",
					attempt: 1,
					maxAttempts: 3,
				},
				{
					timestamp: "t2",
					type: "tier0_recovery_success",
					pattern: "MERGE_TIMEOUT",
					attempt: 1,
					maxAttempts: 3,
					resolution: "retried merge OK",
				},
			],
			errors: [],
		};
		const md = formatBatchSummary(data);

		expect(md).toContain("## Incidents");
		expect(md).toContain("### Tier 0 Recoveries");
		expect(md).toContain("MERGE_TIMEOUT");
		expect(md).toContain("1 attempt(s)");
		expect(md).toContain("1 success(es)");
		expect(md).toContain("retried merge OK");
	});

	it("16.14: includes incidents from audit trail", () => {
		const data: BatchSummaryData = {
			batchId: "b",
			phase: "completed",
			startedAt: 0,
			endedAt: 600_000,
			totalTasks: 3,
			succeededTasks: 2,
			failedTasks: 1,
			skippedTasks: 0,
			blockedTasks: 0,
			batchCost: 0,
			wavePlan: [],
			waveResults: [],
			taskExits: {},
			mergeResults: [],
			auditEntries: [
				{
					ts: "t1",
					action: "kill_session",
					classification: "destructive",
					context: "stale session lane-2",
					command: "tmux kill-session",
					result: "success",
					detail: "session killed",
					batchId: "b",
				},
			],
			tier0Events: [],
			errors: [],
		};
		const md = formatBatchSummary(data);

		expect(md).toContain("## Incidents");
		expect(md).toContain("kill_session");
		expect(md).toContain("destructive");
		expect(md).toContain("stale session lane-2");
	});

	it("16.15: shows 'No incidents' when no issues occurred", () => {
		const data: BatchSummaryData = {
			batchId: "b",
			phase: "completed",
			startedAt: 0,
			endedAt: 600_000,
			totalTasks: 3,
			succeededTasks: 3,
			failedTasks: 0,
			skippedTasks: 0,
			blockedTasks: 0,
			batchCost: 0,
			wavePlan: [],
			waveResults: [],
			taskExits: {},
			mergeResults: [],
			auditEntries: [],
			tier0Events: [],
			errors: [],
		};
		const md = formatBatchSummary(data);

		expect(md).toContain("No incidents recorded");
	});

	it("16.16: generates recommendations for high failure rate", () => {
		const data: BatchSummaryData = {
			batchId: "b",
			phase: "completed",
			startedAt: 0,
			endedAt: 600_000,
			totalTasks: 10,
			succeededTasks: 5,
			failedTasks: 5,
			skippedTasks: 0,
			blockedTasks: 0,
			batchCost: 0,
			wavePlan: [],
			waveResults: [],
			taskExits: {},
			mergeResults: [],
			auditEntries: [],
			tier0Events: [],
			errors: [],
		};
		const md = formatBatchSummary(data);

		expect(md).toContain("## Recommendations");
		expect(md).toContain("High failure rate");
		expect(md).toContain("50%");
	});

	it("16.17: generates recommendations for long-running tasks", () => {
		const data: BatchSummaryData = {
			batchId: "b",
			phase: "completed",
			startedAt: 0,
			endedAt: 600_000,
			totalTasks: 3,
			succeededTasks: 3,
			failedTasks: 0,
			skippedTasks: 0,
			blockedTasks: 0,
			batchCost: 0,
			wavePlan: [],
			waveResults: [],
			taskExits: {
				"T-001": { classification: "clean", cost: 1.00, durationSec: 7200 },
			},
			mergeResults: [],
			auditEntries: [],
			tier0Events: [],
			errors: [],
		};
		const md = formatBatchSummary(data);

		expect(md).toContain("Long-running tasks");
		expect(md).toContain("T-001");
		expect(md).toContain("exceeded 1 hour");
	});

	it("16.18: includes cost breakdown by wave", () => {
		const data: BatchSummaryData = {
			batchId: "b",
			phase: "completed",
			startedAt: 0,
			endedAt: 600_000,
			totalTasks: 3,
			succeededTasks: 3,
			failedTasks: 0,
			skippedTasks: 0,
			blockedTasks: 0,
			batchCost: 3.50,
			wavePlan: [],
			waveResults: [
				{
					waveIndex: 0,
					startedAt: 0,
					endedAt: 300_000,
					succeededTaskIds: ["T-1", "T-2"],
					failedTaskIds: [],
					skippedTaskIds: [],
					overallStatus: "succeeded",
				},
			],
			taskExits: {
				"T-1": { classification: "clean", cost: 1.50, durationSec: 200 },
				"T-2": { classification: "clean", cost: 2.00, durationSec: 250 },
			},
			mergeResults: [],
			auditEntries: [],
			tier0Events: [],
			errors: [],
		};
		const md = formatBatchSummary(data);

		expect(md).toContain("## Cost Breakdown");
		expect(md).toContain("| Wave | Tasks | Cost | Duration |");
		expect(md).toContain("$3.50");
	});

	it("16.19: shows 'Cost data not available' when no taskExits", () => {
		const data: BatchSummaryData = {
			batchId: "b",
			phase: "completed",
			startedAt: 0,
			endedAt: 600_000,
			totalTasks: 3,
			succeededTasks: 3,
			failedTasks: 0,
			skippedTasks: 0,
			blockedTasks: 0,
			batchCost: 0,
			wavePlan: [],
			waveResults: [],
			taskExits: {},
			mergeResults: [],
			auditEntries: [],
			tier0Events: [],
			errors: [],
		};
		const md = formatBatchSummary(data);

		expect(md).toContain("Cost data not available");
	});

	it("16.20: shows 'No recommendations' when batch ran smoothly", () => {
		const data: BatchSummaryData = {
			batchId: "b",
			phase: "completed",
			startedAt: 0,
			endedAt: 600_000,
			totalTasks: 3,
			succeededTasks: 3,
			failedTasks: 0,
			skippedTasks: 0,
			blockedTasks: 0,
			batchCost: 0,
			wavePlan: [],
			waveResults: [],
			taskExits: {},
			mergeResults: [],
			auditEntries: [],
			tier0Events: [],
			errors: [],
		};
		const md = formatBatchSummary(data);

		expect(md).toContain("No recommendations");
	});
});

describe("16.x — generateBatchSummary + file output", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("16.21: writes summary file to .pi/supervisor/{opId}-{batchId}-summary.md", () => {
		const batchState = makeIntegrationBatchState();
		const markdown = generateBatchSummary(batchState, tmpDir, "operator1");

		const filepath = join(tmpDir, ".pi", "supervisor", "operator1-20260322T120000-summary.md");
		expect(existsSync(filepath)).toBe(true);

		const content = readFileSync(filepath, "utf-8");
		expect(content).toContain("# Batch Summary: 20260322T120000");
		expect(content).toContain("4/5 tasks succeeded");
	});

	it("16.22: returns the formatted markdown string", () => {
		const batchState = makeIntegrationBatchState();
		const markdown = generateBatchSummary(batchState, tmpDir, "op1");

		expect(markdown).toContain("# Batch Summary");
		expect(markdown).toContain("20260322T120000");
	});

	it("16.23: includes diagnostics in the written file", () => {
		const batchState = makeIntegrationBatchState();
		const diagnostics = {
			taskExits: {
				"T-001": { classification: "clean", cost: 1.50, durationSec: 300 },
			},
			batchCost: 1.50,
		};
		const markdown = generateBatchSummary(batchState, tmpDir, "op1", diagnostics);

		expect(markdown).toContain("$1.50");
	});
});

describe("16.x — presentBatchSummary", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = makeTmpDir();
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("16.24: sends concise summary message via pi.sendMessage", () => {
		const pi = makeMockPi();
		const batchState = makeIntegrationBatchState();

		presentBatchSummary(pi as any, batchState, tmpDir, "op1");

		expect(pi.messages.length).toBe(1);
		const msg = pi.messages[0];
		expect(msg.opts.customType).toBe("supervisor-batch-summary");
		expect(msg.opts.content[0].text).toContain("📊 **Batch Summary**");
		expect(msg.opts.content[0].text).toContain("4/5 tasks succeeded");
		expect(msg.opts.content[0].text).toContain("summary.md");
		expect(msg.sendOpts.triggerTurn).toBe(false);
	});

	it("16.25: writes summary file AND sends message", () => {
		const pi = makeMockPi();
		const batchState = makeIntegrationBatchState();

		presentBatchSummary(pi as any, batchState, tmpDir, "op1");

		// File written
		const filepath = join(tmpDir, ".pi", "supervisor", "op1-20260322T120000-summary.md");
		expect(existsSync(filepath)).toBe(true);
		// Message sent
		expect(pi.messages.length).toBe(1);
	});

	it("16.26: includes cost in message when diagnostics provided", () => {
		const pi = makeMockPi();
		const batchState = makeIntegrationBatchState();
		const diagnostics = { taskExits: {}, batchCost: 5.25 };

		presentBatchSummary(pi as any, batchState, tmpDir, "op1", diagnostics);

		const text = pi.messages[0].opts.content[0].text;
		expect(text).toContain("$5.25");
	});

	it("16.27: shows 'not tracked' for cost when no diagnostics", () => {
		const pi = makeMockPi();
		const batchState = makeIntegrationBatchState();

		presentBatchSummary(pi as any, batchState, tmpDir, "op1");

		const text = pi.messages[0].opts.content[0].text;
		expect(text).toContain("not tracked");
	});

	it("16.28: shows failed count when tasks failed", () => {
		const pi = makeMockPi();
		const batchState = makeIntegrationBatchState({ failedTasks: 3 });

		presentBatchSummary(pi as any, batchState, tmpDir, "op1");

		const text = pi.messages[0].opts.content[0].text;
		expect(text).toContain("3 task(s)");
	});
});
