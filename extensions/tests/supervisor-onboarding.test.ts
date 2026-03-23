/**
 * Supervisor Onboarding Tests — TP-042 Step 4
 *
 * Tests for the /orch no-args routing and onboarding flow:
 *
 *   10.x — detectOrchState: all 5 states + edge cases
 *   11.x — buildRoutingSystemPrompt: script guidance per state
 *   12.x — /orch with args: existing behavior preserved
 *
 * Run: npx vitest run tests/supervisor-onboarding.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import {
	detectOrchState,
	type OrchProjectState,
	type OrchStateDetection,
	type OrchStateDetectionDeps,
} from "../taskplane/extension.ts";

import {
	buildRoutingSystemPrompt,
	type SupervisorRoutingContext,
} from "../taskplane/supervisor.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readSource(file: string): string {
	return readFileSync(join(__dirname, "..", "taskplane", file), "utf-8").replace(/\r\n/g, "\n");
}

// ═════════════════════════════════════════════════════════════════════
// Test helpers
// ═════════════════════════════════════════════════════════════════════

/** Create mock deps for detectOrchState with sensible defaults */
function makeDeps(overrides?: Partial<OrchStateDetectionDeps>): OrchStateDetectionDeps {
	return {
		hasConfig: () => false,
		loadBatchState: () => null,
		listOrchBranches: () => [],
		countPendingTasks: () => 0,
		...overrides,
	};
}

/** Minimal batch state for testing */
function makeBatchState(overrides?: Record<string, unknown>) {
	return {
		schemaVersion: 3,
		phase: "executing",
		batchId: "20260322T120000",
		baseBranch: "main",
		orchBranch: "orch/test-20260322T120000",
		mode: "repo",
		startedAt: Date.now() - 60_000,
		updatedAt: Date.now(),
		endedAt: null,
		currentWaveIndex: 1,
		totalWaves: 3,
		wavePlan: [["T-001", "T-002"], ["T-003"], ["T-004"]],
		lanes: [],
		tasks: [],
		mergeResults: [],
		totalTasks: 10,
		succeededTasks: 4,
		failedTasks: 1,
		skippedTasks: 0,
		blockedTasks: 0,
		blockedTaskIds: [],
		lastError: null,
		errors: [],
		resilience: { retryBudgets: {}, waveRetryBudgets: {} },
		diagnostics: {},
		...overrides,
	} as any;
}

// ═════════════════════════════════════════════════════════════════════
// 10.x — detectOrchState
// ═════════════════════════════════════════════════════════════════════

describe("10.x — detectOrchState: state detection with strict precedence", () => {
	// ── Basic state detection ────────────────────────────────────────

	it("10.1: no config, no batch, no branches, no tasks → no-config", () => {
		const result = detectOrchState(makeDeps({
			hasConfig: () => false,
			loadBatchState: () => null,
			listOrchBranches: () => [],
			countPendingTasks: () => 0,
		}));
		expect(result.state).toBe("no-config");
		expect(result.contextMessage).toContain("Welcome to Taskplane");
		expect(result.contextMessage).toContain("configuration");
	});

	it("10.2: active batch (executing) → active-batch", () => {
		const result = detectOrchState(makeDeps({
			hasConfig: () => true,
			loadBatchState: () => makeBatchState({ phase: "executing" }),
		}));
		expect(result.state).toBe("active-batch");
		expect(result.batchId).toBe("20260322T120000");
		expect(result.batchPhase).toBe("executing");
		expect(result.contextMessage).toContain("currently executing");
		expect(result.contextMessage).toContain("Wave 2/3");
	});

	it("10.3: active batch (merging) → active-batch", () => {
		const result = detectOrchState(makeDeps({
			hasConfig: () => true,
			loadBatchState: () => makeBatchState({ phase: "merging" }),
		}));
		expect(result.state).toBe("active-batch");
		expect(result.batchPhase).toBe("merging");
	});

	it("10.4: active batch (launching) → active-batch", () => {
		const result = detectOrchState(makeDeps({
			hasConfig: () => true,
			loadBatchState: () => makeBatchState({ phase: "launching" }),
		}));
		expect(result.state).toBe("active-batch");
		expect(result.batchPhase).toBe("launching");
	});

	it("10.5: completed batch + orch branch exists → completed-batch", () => {
		const result = detectOrchState(makeDeps({
			hasConfig: () => true,
			loadBatchState: () => makeBatchState({
				phase: "completed",
				orchBranch: "orch/test-20260322T120000",
				succeededTasks: 8,
				totalTasks: 10,
			}),
			listOrchBranches: () => ["orch/test-20260322T120000"],
		}));
		expect(result.state).toBe("completed-batch");
		expect(result.batchId).toBe("20260322T120000");
		expect(result.orchBranch).toBe("orch/test-20260322T120000");
		expect(result.contextMessage).toContain("ready to integrate");
	});

	it("10.6: config exists + pending tasks → pending-tasks", () => {
		const result = detectOrchState(makeDeps({
			hasConfig: () => true,
			loadBatchState: () => null,
			listOrchBranches: () => [],
			countPendingTasks: () => 5,
		}));
		expect(result.state).toBe("pending-tasks");
		expect(result.pendingTaskCount).toBe(5);
		expect(result.contextMessage).toContain("5 pending tasks");
	});

	it("10.7: config exists + no pending tasks → no-tasks", () => {
		const result = detectOrchState(makeDeps({
			hasConfig: () => true,
			loadBatchState: () => null,
			listOrchBranches: () => [],
			countPendingTasks: () => 0,
		}));
		expect(result.state).toBe("no-tasks");
		expect(result.contextMessage).toContain("No pending tasks");
		expect(result.contextMessage).toContain("GitHub Issues");
	});

	// ── Precedence order ─────────────────────────────────────────────

	it("10.8: active batch takes precedence over no-config", () => {
		// Even if config is missing, an active batch is surfaced first
		const result = detectOrchState(makeDeps({
			hasConfig: () => false,
			loadBatchState: () => makeBatchState({ phase: "executing" }),
		}));
		expect(result.state).toBe("active-batch");
	});

	it("10.9: active batch takes precedence over pending tasks", () => {
		const result = detectOrchState(makeDeps({
			hasConfig: () => true,
			loadBatchState: () => makeBatchState({ phase: "executing" }),
			countPendingTasks: () => 10,
		}));
		expect(result.state).toBe("active-batch");
	});

	it("10.10: completed batch + branch takes precedence over no-config", () => {
		const result = detectOrchState(makeDeps({
			hasConfig: () => false,
			loadBatchState: () => makeBatchState({
				phase: "completed",
				orchBranch: "orch/test",
			}),
			listOrchBranches: () => ["orch/test"],
		}));
		expect(result.state).toBe("completed-batch");
	});

	it("10.11: completed batch + branch takes precedence over pending tasks", () => {
		const result = detectOrchState(makeDeps({
			hasConfig: () => true,
			loadBatchState: () => makeBatchState({
				phase: "completed",
				orchBranch: "orch/test",
			}),
			listOrchBranches: () => ["orch/test"],
			countPendingTasks: () => 5,
		}));
		expect(result.state).toBe("completed-batch");
	});

	it("10.12: no-config takes precedence over pending tasks", () => {
		// If there's no config, we can't even know about tasks properly
		// But the precedence order puts no-config after batch states
		const result = detectOrchState(makeDeps({
			hasConfig: () => false,
			loadBatchState: () => null,
			listOrchBranches: () => [],
			countPendingTasks: () => 3,
		}));
		expect(result.state).toBe("no-config");
	});

	// ── Edge cases ───────────────────────────────────────────────────

	it("10.13: stale orch branch — completed batch but branch deleted → falls through", () => {
		// R002-2: If batch says "completed" with an orchBranch, but that branch
		// no longer exists in git, it should NOT detect as completed-batch.
		const result = detectOrchState(makeDeps({
			hasConfig: () => true,
			loadBatchState: () => makeBatchState({
				phase: "completed",
				orchBranch: "orch/deleted-branch",
			}),
			listOrchBranches: () => [], // branch was deleted
			countPendingTasks: () => 0,
		}));
		// Falls through to no-tasks since config exists and no pending tasks
		expect(result.state).toBe("no-tasks");
	});

	it("10.14: corrupt batch state (loadBatchState throws) → falls through gracefully", () => {
		const result = detectOrchState(makeDeps({
			hasConfig: () => true,
			loadBatchState: () => { throw new Error("corrupt JSON"); },
			listOrchBranches: () => [],
			countPendingTasks: () => 0,
		}));
		// Error is caught, falls through to no-config check
		expect(result.state).toBe("no-tasks");
	});

	it("10.15: terminal batch states (failed, stopped, idle) are NOT active-batch", () => {
		for (const phase of ["failed", "stopped", "idle", "completed"]) {
			const result = detectOrchState(makeDeps({
				hasConfig: () => true,
				loadBatchState: () => makeBatchState({
					phase,
					orchBranch: "", // no orch branch → no completed-batch
				}),
				listOrchBranches: () => [],
				countPendingTasks: () => 0,
			}));
			expect(result.state, `phase "${phase}" should NOT be active-batch`).not.toBe("active-batch");
		}
	});

	it("10.16: orch branches exist but no batch state → completed-batch", () => {
		// Covers the "orphaned orch branch" case (batch-state.json deleted)
		const result = detectOrchState(makeDeps({
			hasConfig: () => true,
			loadBatchState: () => null,
			listOrchBranches: () => ["orch/orphan-branch"],
		}));
		expect(result.state).toBe("completed-batch");
		expect(result.orchBranch).toBe("orch/orphan-branch");
		expect(result.contextMessage).toContain("orch branch");
	});

	it("10.17: multiple orphaned orch branches → completed-batch with count", () => {
		const result = detectOrchState(makeDeps({
			hasConfig: () => true,
			loadBatchState: () => null,
			listOrchBranches: () => ["orch/branch-1", "orch/branch-2"],
		}));
		expect(result.state).toBe("completed-batch");
		expect(result.contextMessage).toContain("2 orch branches");
	});

	it("10.18: single pending task uses singular form", () => {
		const result = detectOrchState(makeDeps({
			hasConfig: () => true,
			loadBatchState: () => null,
			listOrchBranches: () => [],
			countPendingTasks: () => 1,
		}));
		expect(result.state).toBe("pending-tasks");
		expect(result.pendingTaskCount).toBe(1);
		expect(result.contextMessage).toContain("1 pending task ");
		expect(result.contextMessage).not.toContain("1 pending tasks");
	});

	it("10.19: active-batch context includes task counters", () => {
		const result = detectOrchState(makeDeps({
			loadBatchState: () => makeBatchState({
				phase: "executing",
				succeededTasks: 4,
				failedTasks: 1,
				skippedTasks: 2,
				totalTasks: 10,
			}),
		}));
		expect(result.state).toBe("active-batch");
		expect(result.contextMessage).toContain("4 succeeded");
		expect(result.contextMessage).toContain("1 failed");
		expect(result.contextMessage).toContain("2 skipped");
		expect(result.contextMessage).toContain("10 total");
	});

	it("10.20: completed-batch context mentions integration", () => {
		const result = detectOrchState(makeDeps({
			loadBatchState: () => makeBatchState({
				phase: "completed",
				orchBranch: "orch/test",
				baseBranch: "main",
			}),
			listOrchBranches: () => ["orch/test"],
		}));
		expect(result.state).toBe("completed-batch");
		expect(result.contextMessage).toContain("integrate");
		expect(result.contextMessage).toContain("main");
	});
});

// ═════════════════════════════════════════════════════════════════════
// 11.x — buildRoutingSystemPrompt
// ═════════════════════════════════════════════════════════════════════

describe("11.x — buildRoutingSystemPrompt: script guidance per routing state", () => {
	it("11.1: no-config state → references onboarding scripts (1-5)", () => {
		const prompt = buildRoutingSystemPrompt(
			{ routingState: "no-config", contextMessage: "No config found" },
			"/tmp/test",
		);
		expect(prompt).toContain("Onboarding");
		expect(prompt).toContain("Script 1");
		expect(prompt).toContain("Script 2");
		expect(prompt).toContain("Script 3");
		expect(prompt).toContain("Script 4");
		expect(prompt).toContain("Script 5");
		expect(prompt).toContain("taskplane-config.json");
		expect(prompt).toContain("CONTEXT.md");
	});

	it("11.2: pending-tasks state → references Script 6 (batch planning)", () => {
		const prompt = buildRoutingSystemPrompt(
			{ routingState: "pending-tasks", contextMessage: "5 pending tasks" },
			"/tmp/test",
		);
		expect(prompt).toContain("Batch Planning");
		expect(prompt).toContain("Script 6");
		expect(prompt).toContain("pending");
		expect(prompt).toContain("/orch-plan");
	});

	it("11.3: no-tasks state → references Script 6 (no-tasks path)", () => {
		const prompt = buildRoutingSystemPrompt(
			{ routingState: "no-tasks", contextMessage: "No pending tasks" },
			"/tmp/test",
		);
		expect(prompt).toContain("Task Creation");
		expect(prompt).toContain("Script 6");
		expect(prompt).toContain("no pending tasks");
		expect(prompt).toContain("GitHub Issues");
		expect(prompt).toContain("TODO");
	});

	it("11.4: completed-batch state → references Script 8 (retrospective) and integration", () => {
		const prompt = buildRoutingSystemPrompt(
			{ routingState: "completed-batch", contextMessage: "Batch completed" },
			"/tmp/test",
		);
		expect(prompt).toContain("Integration");
		expect(prompt).toContain("Retrospective");
		expect(prompt).toContain("Script 8");
		expect(prompt).toContain("/orch-integrate");
		expect(prompt).toContain("batch-state.json");
	});

	it("11.5: all routing prompts include identity and capabilities sections", () => {
		const states: string[] = ["no-config", "pending-tasks", "no-tasks", "completed-batch"];
		for (const state of states) {
			const prompt = buildRoutingSystemPrompt(
				{ routingState: state, contextMessage: "test" },
				"/tmp/test",
			);
			expect(prompt, `state=${state}`).toContain("Project Supervisor");
			expect(prompt, `state=${state}`).toContain("Detected State");
			expect(prompt, `state=${state}`).toContain("Capabilities");
			expect(prompt, `state=${state}`).toContain("read");
			expect(prompt, `state=${state}`).toContain("write");
		}
	});

	it("11.6: prompt includes routing state and context message", () => {
		const prompt = buildRoutingSystemPrompt(
			{ routingState: "pending-tasks", contextMessage: "You have 3 tasks ready" },
			"/tmp/test",
		);
		expect(prompt).toContain("pending-tasks");
		expect(prompt).toContain("You have 3 tasks ready");
	});

	it("11.7: no-config prompt lists all required onboarding artifacts", () => {
		const prompt = buildRoutingSystemPrompt(
			{ routingState: "no-config", contextMessage: "test" },
			"/tmp/test",
		);
		expect(prompt).toContain("taskplane-config.json");
		expect(prompt).toContain("CONTEXT.md");
		expect(prompt).toContain("task-worker.md");
		expect(prompt).toContain("task-reviewer.md");
		expect(prompt).toContain("task-merger.md");
		expect(prompt).toContain(".gitignore");
	});

	it("11.8: completed-batch prompt references audit trail for retrospective", () => {
		const prompt = buildRoutingSystemPrompt(
			{ routingState: "completed-batch", contextMessage: "test" },
			"/tmp/test",
		);
		expect(prompt).toContain("actions.jsonl");
		expect(prompt).toContain("batch-state.json");
	});

	it("11.9: pending-tasks and no-tasks prompts offer health check (Script 7)", () => {
		for (const state of ["pending-tasks", "no-tasks"]) {
			const prompt = buildRoutingSystemPrompt(
				{ routingState: state, contextMessage: "test" },
				"/tmp/test",
			);
			expect(prompt, `state=${state}`).toContain("health check");
			expect(prompt, `state=${state}`).toContain("Script 7");
		}
	});

	it("11.10: unknown routing state gets fallback guidance", () => {
		const prompt = buildRoutingSystemPrompt(
			{ routingState: "unknown-state" as any, contextMessage: "Something weird" },
			"/tmp/test",
		);
		expect(prompt).toContain("Project Assistance");
		expect(prompt).toContain("unknown-state");
		expect(prompt).toContain("primer");
	});

	it("11.11: prompt references the supervisor-primer.md file", () => {
		const prompt = buildRoutingSystemPrompt(
			{ routingState: "no-config", contextMessage: "test" },
			"/tmp/test",
		);
		expect(prompt).toContain("supervisor-primer.md");
	});
});

// ═════════════════════════════════════════════════════════════════════
// 12.x — /orch with args: existing behavior preserved
// ═════════════════════════════════════════════════════════════════════

describe("12.x — /orch with args: existing behavior preserved", () => {
	it("12.1: extension.ts /orch handler has separate path for args", () => {
		const extSource = readSource("extension.ts");

		// The handler should check if args is empty for routing
		const orchHandler = extSource.substring(
			extSource.indexOf('registerCommand("orch"'),
			extSource.indexOf('registerCommand("orch-plan"'),
		);

		// No-args path: routing
		expect(orchHandler).toContain("!args?.trim()");
		expect(orchHandler).toContain("detectOrchState");

		// With-args path: starts batch directly
		expect(orchHandler).toContain("startBatchAsync(");
	});

	it("12.2: /orch with args still calls startBatchAsync", () => {
		const extSource = readSource("extension.ts");
		const orchHandler = extSource.substring(
			extSource.indexOf('registerCommand("orch"'),
			extSource.indexOf('registerCommand("orch-plan"'),
		);

		// After the no-args block, the existing behavior calls startBatchAsync
		const noArgsEnd = orchHandler.indexOf("return;\n\t\t\t}\n\n\t\t\tif (!requireExecCtx");
		expect(noArgsEnd).not.toBe(-1);

		// startBatchAsync should appear after the no-args return
		const startBatchIdx = orchHandler.indexOf("startBatchAsync(", noArgsEnd);
		expect(startBatchIdx).toBeGreaterThan(noArgsEnd);
	});

	it("12.3: /orch with args activates supervisor AFTER batch start (not routing)", () => {
		const extSource = readSource("extension.ts");
		const orchHandler = extSource.substring(
			extSource.indexOf('registerCommand("orch"'),
			extSource.indexOf('registerCommand("orch-plan"'),
		);

		// The with-args path should activate supervisor after startBatchAsync
		const startBatchIdx = orchHandler.indexOf("startBatchAsync(");
		const activateAfterBatch = orchHandler.indexOf("activateSupervisor(", startBatchIdx);
		expect(activateAfterBatch).toBeGreaterThan(startBatchIdx);
	});

	it("12.4: /orch no-args routing activates supervisor with routingContext", () => {
		const extSource = readSource("extension.ts");
		const orchHandler = extSource.substring(
			extSource.indexOf('registerCommand("orch"'),
			extSource.indexOf('registerCommand("orch-plan"'),
		);

		// In the no-args path, activateSupervisor is called with routingState
		const noArgsBlock = orchHandler.substring(0, orchHandler.indexOf("return;\n\t\t\t}\n\n\t\t\tif (!requireExecCtx"));
		expect(noArgsBlock).toContain("activateSupervisor(");
		expect(noArgsBlock).toContain("routingState:");
		expect(noArgsBlock).toContain("contextMessage:");
	});

	it("12.5: /orch-plan and /orch-resume still exist as separate commands", () => {
		const extSource = readSource("extension.ts");
		expect(extSource).toContain('registerCommand("orch-plan"');
		expect(extSource).toContain('registerCommand("orch-resume"');
		expect(extSource).toContain('registerCommand("orch-status"');
		expect(extSource).toContain('registerCommand("orch-abort"');
		expect(extSource).toContain('registerCommand("orch-pause"');
	});

	it("12.6: active-batch state shows notification instead of activating supervisor", () => {
		const extSource = readSource("extension.ts");
		const orchHandler = extSource.substring(
			extSource.indexOf('registerCommand("orch"'),
			extSource.indexOf('registerCommand("orch-plan"'),
		);

		// active-batch should trigger a notify, not supervisor activation
		expect(orchHandler).toContain('detection.state === "active-batch"');
		expect(orchHandler).toContain("ctx.ui.notify(");
		expect(orchHandler).toContain("/orch-status");
	});
});
