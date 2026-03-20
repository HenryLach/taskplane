/**
 * Force-Resume Tests — TP-031 Step 4
 *
 * Tests for:
 *   1. parseResumeArgs() — flag parsing, unknown flags, help
 *   2. checkResumeEligibility() — phase × force matrix
 *
 * Run: npx vitest run extensions/tests/force-resume.test.ts
 */

import { describe, it, expect } from "vitest";
import { parseResumeArgs } from "../taskplane/extension.ts";
import { checkResumeEligibility } from "../taskplane/resume.ts";
import type { PersistedBatchState, OrchBatchPhase } from "../taskplane/types.ts";
import { BATCH_STATE_SCHEMA_VERSION, defaultResilienceState, defaultBatchDiagnostics } from "../taskplane/types.ts";

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a minimal PersistedBatchState for eligibility testing. */
function makeState(phase: OrchBatchPhase, batchId: string = "test-batch-001"): PersistedBatchState {
	return {
		schemaVersion: BATCH_STATE_SCHEMA_VERSION,
		phase,
		batchId,
		baseBranch: "main",
		orchBranch: "orch/test-20260320T000000",
		mode: "repo",
		startedAt: Date.now() - 60000,
		updatedAt: Date.now(),
		endedAt: null,
		currentWaveIndex: 0,
		totalWaves: 1,
		wavePlan: [["task-1"]],
		lanes: [],
		tasks: [],
		mergeResults: [],
		totalTasks: 1,
		succeededTasks: 0,
		failedTasks: 0,
		skippedTasks: 0,
		blockedTasks: 0,
		blockedTaskIds: [],
		lastError: null,
		errors: [],
		resilience: defaultResilienceState(),
		diagnostics: defaultBatchDiagnostics(),
	};
}

// ── 1. parseResumeArgs ───────────────────────────────────────────────

describe("parseResumeArgs", () => {
	it("returns { force: false } for empty input", () => {
		expect(parseResumeArgs(undefined)).toEqual({ force: false });
		expect(parseResumeArgs("")).toEqual({ force: false });
		expect(parseResumeArgs("  ")).toEqual({ force: false });
	});

	it("parses --force flag", () => {
		expect(parseResumeArgs("--force")).toEqual({ force: true });
	});

	it("parses --force with extra whitespace", () => {
		expect(parseResumeArgs("  --force  ")).toEqual({ force: true });
	});

	it("returns error for --help", () => {
		const result = parseResumeArgs("--help");
		expect(result).toHaveProperty("error");
		expect((result as { error: string }).error).toContain("Usage");
		expect((result as { error: string }).error).toContain("--force");
	});

	it("returns error for unknown flags", () => {
		const result = parseResumeArgs("--unknown");
		expect(result).toHaveProperty("error");
		expect((result as { error: string }).error).toContain("Unknown flag: --unknown");
	});

	it("returns error for positional arguments", () => {
		const result = parseResumeArgs("batch-123");
		expect(result).toHaveProperty("error");
		expect((result as { error: string }).error).toContain("Unexpected argument");
	});

	it("returns error for unknown flag after --force", () => {
		const result = parseResumeArgs("--force --verbose");
		expect(result).toHaveProperty("error");
		expect((result as { error: string }).error).toContain("Unknown flag: --verbose");
	});
});

// ── 2. checkResumeEligibility — Phase × Force Matrix ─────────────────

describe("checkResumeEligibility — normal resume (force=false)", () => {
	const normalEligible: OrchBatchPhase[] = ["paused", "executing", "merging"];
	const normalIneligible: OrchBatchPhase[] = ["stopped", "failed", "completed", "idle", "planning"];

	for (const phase of normalEligible) {
		it(`${phase} → eligible without force`, () => {
			const state = makeState(phase);
			const result = checkResumeEligibility(state, false);
			expect(result.eligible).toBe(true);
			expect(result.phase).toBe(phase);
			expect(result.batchId).toBe("test-batch-001");
		});
	}

	for (const phase of normalIneligible) {
		it(`${phase} → rejected without force`, () => {
			const state = makeState(phase);
			const result = checkResumeEligibility(state, false);
			expect(result.eligible).toBe(false);
			expect(result.phase).toBe(phase);
		});
	}

	it("stopped rejection message mentions --force", () => {
		const state = makeState("stopped");
		const result = checkResumeEligibility(state, false);
		expect(result.reason).toContain("--force");
	});

	it("failed rejection message mentions --force", () => {
		const state = makeState("failed");
		const result = checkResumeEligibility(state, false);
		expect(result.reason).toContain("--force");
	});
});

describe("checkResumeEligibility — force resume (force=true)", () => {
	it("stopped → eligible with force", () => {
		const state = makeState("stopped");
		const result = checkResumeEligibility(state, true);
		expect(result.eligible).toBe(true);
		expect(result.reason).toContain("Force-resuming");
	});

	it("failed → eligible with force", () => {
		const state = makeState("failed");
		const result = checkResumeEligibility(state, true);
		expect(result.eligible).toBe(true);
		expect(result.reason).toContain("Force-resuming");
	});

	it("completed → ALWAYS rejected even with force", () => {
		const state = makeState("completed");
		const result = checkResumeEligibility(state, true);
		expect(result.eligible).toBe(false);
		expect(result.reason).toContain("already completed");
		expect(result.reason).toContain("--force cannot resume");
	});

	it("idle → rejected even with force", () => {
		const state = makeState("idle");
		const result = checkResumeEligibility(state, true);
		expect(result.eligible).toBe(false);
	});

	it("planning → rejected even with force", () => {
		const state = makeState("planning");
		const result = checkResumeEligibility(state, true);
		expect(result.eligible).toBe(false);
	});

	// Normal eligible phases should still work with force=true
	it("paused → eligible with force (no-op, already eligible normally)", () => {
		const state = makeState("paused");
		const result = checkResumeEligibility(state, true);
		expect(result.eligible).toBe(true);
	});

	it("executing → eligible with force", () => {
		const state = makeState("executing");
		const result = checkResumeEligibility(state, true);
		expect(result.eligible).toBe(true);
	});

	it("merging → eligible with force", () => {
		const state = makeState("merging");
		const result = checkResumeEligibility(state, true);
		expect(result.eligible).toBe(true);
	});
});

describe("checkResumeEligibility — default force parameter", () => {
	it("defaults to force=false when parameter omitted", () => {
		const state = makeState("stopped");
		const result = checkResumeEligibility(state);
		expect(result.eligible).toBe(false);
	});
});
