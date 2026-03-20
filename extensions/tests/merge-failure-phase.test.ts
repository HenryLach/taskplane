/**
 * Merge Failure Phase Tests — TP-031 Step 4
 *
 * Verifies the TP-031 contract:
 *   - failedTasks > 0 at batch end → phase = "paused" (not "failed")
 *   - failedTasks === 0 at batch end → phase = "completed"
 *   - Engine/resume parity: same logic in both code paths
 *
 * Since the phase transition logic is embedded in the engine/resume
 * batch finalization flow (not an extractable pure function), these tests
 * verify the contract by examining the source code patterns directly
 * and testing the eligibility implications.
 *
 * Run: npx vitest run extensions/tests/merge-failure-phase.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { checkResumeEligibility } from "../taskplane/resume.ts";
import type { OrchBatchPhase, PersistedBatchState } from "../taskplane/types.ts";
import { BATCH_STATE_SCHEMA_VERSION, defaultResilienceState, defaultBatchDiagnostics } from "../taskplane/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers ──────────────────────────────────────────────────────────

/** Build minimal state for eligibility testing */
function makeState(phase: OrchBatchPhase): PersistedBatchState {
	return {
		schemaVersion: BATCH_STATE_SCHEMA_VERSION,
		phase,
		batchId: "test-batch",
		baseBranch: "main",
		orchBranch: "orch/test",
		mode: "repo",
		startedAt: Date.now() - 60000,
		updatedAt: Date.now(),
		endedAt: Date.now(),
		currentWaveIndex: 0,
		totalWaves: 1,
		wavePlan: [["task-1"]],
		lanes: [],
		tasks: [],
		mergeResults: [],
		totalTasks: 1,
		succeededTasks: 0,
		failedTasks: 1,
		skippedTasks: 0,
		blockedTasks: 0,
		blockedTaskIds: [],
		lastError: null,
		errors: [],
		resilience: defaultResilienceState(),
		diagnostics: defaultBatchDiagnostics(),
	};
}

// ── 1. Source Verification: Engine & Resume Parity ────────────────────

describe("merge failure → paused: source verification", () => {
	it("engine.ts contains failedTasks > 0 → paused transition", () => {
		const engineSource = readFileSync(
			join(__dirname, "..", "taskplane", "engine.ts"),
			"utf-8",
		);

		// Verify the TP-031 pattern: failedTasks > 0 → "paused" (not "failed")
		expect(engineSource).toContain('batchState.phase = "paused"');
		expect(engineSource).toContain("batchState.failedTasks > 0");
		// Verify the TP-031 comment documenting intent
		expect(engineSource).toContain("TP-031");
		expect(engineSource).toContain('"failed" is reserved for unrecoverable invariant violations');
	});

	it("resume.ts contains failedTasks > 0 → paused transition (parity)", () => {
		const resumeSource = readFileSync(
			join(__dirname, "..", "taskplane", "resume.ts"),
			"utf-8",
		);

		// Same pattern must exist in resume.ts for parity
		expect(resumeSource).toContain('batchState.phase = "paused"');
		expect(resumeSource).toContain("batchState.failedTasks > 0");
		expect(resumeSource).toContain("TP-031");
		// Parity comment
		expect(resumeSource).toContain("Parity with engine.ts");
	});

	it("engine.ts preserves worktrees before cleanup when failedTasks > 0", () => {
		const engineSource = readFileSync(
			join(__dirname, "..", "taskplane", "engine.ts"),
			"utf-8",
		);

		// Pre-cleanup preservation must appear BEFORE the cleanup section
		const preserveIdx = engineSource.indexOf("preserveWorktreesForResume = true");
		const cleanupIdx = engineSource.indexOf("Phase 3: Cleanup");

		// Both patterns must exist
		expect(preserveIdx).toBeGreaterThan(-1);
		expect(cleanupIdx).toBeGreaterThan(-1);

		// Find the FIRST occurrence of the pre-cleanup preservation (the one before cleanup)
		// The pattern includes failedTasks > 0 check
		const preCleanupPattern = "pre-cleanup: failedTasks > 0 detected, preserving worktrees for resume";
		const preCleanupIdx = engineSource.indexOf(preCleanupPattern);
		expect(preCleanupIdx).toBeGreaterThan(-1);
		expect(preCleanupIdx).toBeLessThan(cleanupIdx);
	});

	it("resume.ts preserves worktrees before cleanup when failedTasks > 0 (parity)", () => {
		const resumeSource = readFileSync(
			join(__dirname, "..", "taskplane", "resume.ts"),
			"utf-8",
		);

		// Same pre-cleanup preservation must exist in resume.ts
		const preCleanupPattern = "pre-cleanup: failedTasks > 0 detected, preserving worktrees for resume";
		const preCleanupIdx = resumeSource.indexOf(preCleanupPattern);
		expect(preCleanupIdx).toBeGreaterThan(-1);

		// Must appear before the cleanup section
		const cleanupIdx = resumeSource.indexOf("11. Cleanup and terminal state");
		expect(cleanupIdx).toBeGreaterThan(-1);

		// The preservation determination MUST come before cleanup (R010 fix)
		expect(preCleanupIdx).toBeLessThan(cleanupIdx);
	});

	it("engine.ts transitions to 'completed' when failedTasks === 0 (success path)", () => {
		const engineSource = readFileSync(
			join(__dirname, "..", "taskplane", "engine.ts"),
			"utf-8",
		);

		// Use "Normal completion" as the unique anchor for the finalization block
		const anchorMarker = "Normal completion (not stopped, paused, or aborted)";
		const anchorIdx = engineSource.indexOf(anchorMarker);
		expect(anchorIdx).toBeGreaterThan(-1);

		// Extract a generous window around the finalization block
		const finalizationBlock = engineSource.substring(anchorIdx, anchorIdx + 1000);
		expect(finalizationBlock).toContain("batchState.failedTasks > 0");
		expect(finalizationBlock).toContain('batchState.phase = "paused"');
		expect(finalizationBlock).toContain('batchState.phase = "completed"');

		// Verify structure: paused is in the if-branch, completed is in the else-branch
		const pausedIdx = finalizationBlock.indexOf('batchState.phase = "paused"');
		const completedIdx = finalizationBlock.indexOf('batchState.phase = "completed"');
		expect(completedIdx).toBeGreaterThan(pausedIdx);
	});

	it("resume.ts transitions to 'completed' when failedTasks === 0 (success path parity)", () => {
		const resumeSource = readFileSync(
			join(__dirname, "..", "taskplane", "resume.ts"),
			"utf-8",
		);

		// Use the TP-031 parity comment as unique anchor for the finalization block
		const anchorMarker = "TP-031: Parity with engine.ts";
		const anchorIdx = resumeSource.indexOf(anchorMarker);
		expect(anchorIdx).toBeGreaterThan(-1);

		// Extract a generous window around the finalization block
		const finalizationBlock = resumeSource.substring(anchorIdx - 50, anchorIdx + 500);
		expect(finalizationBlock).toContain("batchState.failedTasks > 0");
		expect(finalizationBlock).toContain('batchState.phase = "paused"');
		expect(finalizationBlock).toContain('batchState.phase = "completed"');

		// Verify structure: paused is in the if-branch, completed is in the else-branch
		const pausedIdx = finalizationBlock.indexOf('batchState.phase = "paused"');
		const completedIdx = finalizationBlock.indexOf('batchState.phase = "completed"');
		expect(completedIdx).toBeGreaterThan(pausedIdx);
	});
});

// ── 2. Behavioral Implications ───────────────────────────────────────

describe("merge failure → paused: behavioral implications", () => {
	it("paused batch is resumable without --force (the whole point of TP-031)", () => {
		// After merge failure with failedTasks > 0, batch is now "paused" (not "failed")
		// This means normal resume works — no --force needed
		const state = makeState("paused");
		state.failedTasks = 1;

		const result = checkResumeEligibility(state, false);
		expect(result.eligible).toBe(true);
	});

	it("if batch somehow ends up 'failed' (future invariant violation), --force is required", () => {
		// "failed" is reserved for future unrecoverable invariant violations
		const state = makeState("failed");

		// Normal resume rejected
		const normalResult = checkResumeEligibility(state, false);
		expect(normalResult.eligible).toBe(false);

		// Force resume accepted
		const forceResult = checkResumeEligibility(state, true);
		expect(forceResult.eligible).toBe(true);
	});

	it("completed batch cannot be resumed even with --force", () => {
		const state = makeState("completed");
		state.failedTasks = 0;
		state.succeededTasks = 1;

		const result = checkResumeEligibility(state, true);
		expect(result.eligible).toBe(false);
	});

	it("stopped batch (from on_merge_failure: abort) requires --force", () => {
		// When on_merge_failure is "abort", the batch ends in "stopped"
		const state = makeState("stopped");

		const normalResult = checkResumeEligibility(state, false);
		expect(normalResult.eligible).toBe(false);

		const forceResult = checkResumeEligibility(state, true);
		expect(forceResult.eligible).toBe(true);
	});
});
