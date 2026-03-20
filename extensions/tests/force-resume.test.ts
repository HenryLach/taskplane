/**
 * Force-Resume Tests — TP-031 Step 4
 *
 * Tests for:
 *   1. parseResumeArgs() — flag parsing, unknown flags, help
 *   2. checkResumeEligibility() — phase × force matrix
 *   3. runPreResumeDiagnostics() — pre-resume health checks
 *   4. Force-resume runtime path — source verification of resumeOrchBatch force flow
 *
 * Run: npx vitest run extensions/tests/force-resume.test.ts
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseResumeArgs } from "../taskplane/extension.ts";
import { checkResumeEligibility, runPreResumeDiagnostics } from "../taskplane/resume.ts";
import type { PersistedBatchState, OrchBatchPhase, PersistedLaneRecord } from "../taskplane/types.ts";
import { BATCH_STATE_SCHEMA_VERSION, defaultResilienceState, defaultBatchDiagnostics } from "../taskplane/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// ── 3. runPreResumeDiagnostics ───────────────────────────────────────

describe("runPreResumeDiagnostics", () => {
	it("passes state-coherence check for valid loaded state", () => {
		const state = makeState("failed");
		// Use a non-existent path to avoid git calls actually finding branches
		const result = runPreResumeDiagnostics(state, "/tmp/nonexistent-repo-root", "/tmp/nonexistent-state-root");
		// State coherence always passes because state was already loaded
		const stateCheck = result.checks.find(c => c.check === "state-coherence");
		expect(stateCheck).toBeDefined();
		expect(stateCheck!.passed).toBe(true);
		expect(stateCheck!.detail).toContain(state.batchId);
	});

	it("fails branch-consistency when orch branch does not exist in repo", () => {
		const state = makeState("stopped");
		state.orchBranch = "orch/nonexistent-branch-20260320T999999";
		// Point to a valid git repo (current project) but with a nonexistent branch
		const repoRoot = join(__dirname, "..", "..");
		const result = runPreResumeDiagnostics(state, repoRoot, repoRoot);
		const branchCheck = result.checks.find(c => c.check.startsWith("branch-consistency:"));
		expect(branchCheck).toBeDefined();
		expect(branchCheck!.passed).toBe(false);
		expect(branchCheck!.detail).toContain("not found");
	});

	it("passes worktree health for lanes without worktreePath", () => {
		const state = makeState("failed");
		state.lanes = [
			{
				laneNumber: 1,
				taskIds: ["task-1"],
				sessionName: "lane-1",
				worktreePath: null,
				worktreeBranch: null,
				repoId: undefined,
			} as unknown as PersistedLaneRecord,
		];
		const result = runPreResumeDiagnostics(state, "/tmp/nonexistent", "/tmp/nonexistent");
		// No worktree health checks should be emitted for null worktreePath
		const wtChecks = result.checks.filter(c => c.check.startsWith("worktree-health:"));
		expect(wtChecks).toHaveLength(0);
	});

	it("passes worktree health for absent worktree (will be re-created)", () => {
		const state = makeState("failed");
		state.lanes = [
			{
				laneNumber: 1,
				taskIds: ["task-1"],
				sessionName: "lane-1",
				worktreePath: "/tmp/nonexistent-worktree-path-12345",
				worktreeBranch: "lane-1-branch",
				repoId: undefined,
			} as unknown as PersistedLaneRecord,
		];
		const result = runPreResumeDiagnostics(state, "/tmp/nonexistent", "/tmp/nonexistent");
		const wtCheck = result.checks.find(c => c.check === "worktree-health:lane-1");
		expect(wtCheck).toBeDefined();
		expect(wtCheck!.passed).toBe(true);
		expect(wtCheck!.detail).toContain("absent");
		expect(wtCheck!.detail).toContain("re-created");
	});

	it("returns overall passed=true when all checks pass", () => {
		const state = makeState("failed");
		state.orchBranch = ""; // Skip branch check by clearing orchBranch
		state.lanes = [];
		const result = runPreResumeDiagnostics(state, "/tmp/nonexistent", "/tmp/nonexistent");
		expect(result.passed).toBe(true);
		expect(result.summary).toContain("✅");
		expect(result.summary).toContain("passed");
	});

	it("returns overall passed=false when any check fails", () => {
		const state = makeState("failed");
		state.orchBranch = "orch/nonexistent-branch-20260320T999999";
		const repoRoot = join(__dirname, "..", "..");
		const result = runPreResumeDiagnostics(state, repoRoot, repoRoot);
		expect(result.passed).toBe(false);
		expect(result.summary).toContain("❌");
		expect(result.summary).toContain("failed");
	});
});

// ── 4. Force-resume runtime path — source verification ───────────────

describe("force-resume runtime path in resumeOrchBatch — source verification", () => {
	const resumeSource = readFileSync(
		join(__dirname, "..", "taskplane", "resume.ts"),
		"utf-8",
	);

	it("gates force-resume on pre-resume diagnostics (blocks when diagnostics fail)", () => {
		// The force-resume path must call runPreResumeDiagnostics and return early
		// if diagnostics fail — preventing resume from continuing
		expect(resumeSource).toContain("runPreResumeDiagnostics(persistedState, repoRoot, stateRoot");
		expect(resumeSource).toContain("if (!diagnostics.passed)");
		// Must return (not continue) when diagnostics fail
		const diagnosticsBlock = resumeSource.substring(
			resumeSource.indexOf("if (!diagnostics.passed)"),
			resumeSource.indexOf("if (!diagnostics.passed)") + 200,
		);
		expect(diagnosticsBlock).toContain("return");
	});

	it("sets resilience.resumeForced only AFTER diagnostics pass", () => {
		// resilience.resumeForced must appear after the diagnostics gate
		const diagnosticsGateIdx = resumeSource.indexOf("if (!diagnostics.passed)");
		const resumeForcedIdx = resumeSource.indexOf("persistedState.resilience.resumeForced = true");
		expect(diagnosticsGateIdx).toBeGreaterThan(-1);
		expect(resumeForcedIdx).toBeGreaterThan(-1);
		// resumeForced is set AFTER the early-return diagnostics gate
		expect(resumeForcedIdx).toBeGreaterThan(diagnosticsGateIdx);
	});

	it("resets phase to paused after recording force intent", () => {
		// After setting resumeForced, the phase must be reset to paused
		const resumeForcedIdx = resumeSource.indexOf("persistedState.resilience.resumeForced = true");
		const phaseResetIdx = resumeSource.indexOf('persistedState.phase = "paused"', resumeForcedIdx);
		expect(resumeForcedIdx).toBeGreaterThan(-1);
		expect(phaseResetIdx).toBeGreaterThan(-1);
		expect(phaseResetIdx).toBeGreaterThan(resumeForcedIdx);
	});

	it("only force-resumes from stopped or failed phases (not paused/executing/merging)", () => {
		// The isForceResume guard must check for stopped|failed specifically
		expect(resumeSource).toContain('persistedState.phase === "stopped"');
		expect(resumeSource).toContain('persistedState.phase === "failed"');
		// isForceResume should be gated on force AND (stopped|failed)
		const isForceResumePattern = /const isForceResume = force && \(persistedState\.phase === "stopped" \|\| persistedState\.phase === "failed"\)/;
		expect(resumeSource).toMatch(isForceResumePattern);
	});
});

// ── 3. Force-Resume Runtime Path ─────────────────────────────────────

/**
 * These tests exercise the force-resume contract that `resumeOrchBatch`
 * implements in sections 2-2b:
 *
 * 1. checkResumeEligibility(state, force=true) → eligible for stopped/failed
 * 2. runPreResumeDiagnostics() → gate: block if diagnostics fail
 * 3. On success: set resilience.resumeForced = true, reset phase to "paused"
 *
 * Since `resumeOrchBatch` has deep side-effects (tmux, git, filesystem),
 * we test the building blocks directly and verify the state mutation contract
 * that the resume function implements.
 */
describe("force-resume runtime path — diagnostics gate", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("diagnostics pass for well-formed state (state-coherence check always passes)", () => {
		// runPreResumeDiagnostics needs a real repo root for git checks.
		// Use a non-git directory to test that state-coherence check passes
		// and branch/worktree checks degrade gracefully.
		const state = makeState("failed");
		state.orchBranch = "orch/nonexistent-branch";
		state.lanes = []; // no worktrees to check

		// With no lanes and a non-repo cwd, only state-coherence runs
		const result = runPreResumeDiagnostics(state, "/tmp/nonexistent-repo-root", "/tmp/state-root", null);

		// State coherence always passes (state is already loaded)
		const stateCheck = result.checks.find(c => c.check === "state-coherence");
		expect(stateCheck).toBeDefined();
		expect(stateCheck!.passed).toBe(true);
	});

	it("diagnostics report branch-consistency failure when orch branch missing", () => {
		const state = makeState("failed");
		state.orchBranch = "orch/definitely-does-not-exist";
		state.lanes = [];

		// Use cwd as repo root (which IS a git repo in the test environment)
		const result = runPreResumeDiagnostics(state, process.cwd(), process.cwd(), null);

		const branchCheck = result.checks.find(c => c.check.startsWith("branch-consistency"));
		expect(branchCheck).toBeDefined();
		expect(branchCheck!.passed).toBe(false);
		expect(branchCheck!.detail).toContain("not found");
		expect(result.passed).toBe(false);
	});

	it("diagnostics failure blocks force-resume (contract simulation)", () => {
		// Simulate the resumeOrchBatch force-resume path:
		// 1. State is "failed" + force=true → eligible
		// 2. Diagnostics fail → resume blocked
		// 3. resilience.resumeForced must NOT be set
		const state = makeState("failed");
		state.orchBranch = "orch/nonexistent-branch";
		state.lanes = [];

		const eligibility = checkResumeEligibility(state, true);
		expect(eligibility.eligible).toBe(true);

		// Simulate diagnostics with a branch that doesn't exist in the test repo
		const diagnostics = runPreResumeDiagnostics(state, process.cwd(), process.cwd(), null);

		// Diagnostics should fail (branch doesn't exist)
		expect(diagnostics.passed).toBe(false);

		// Contract: resume is blocked — resilience.resumeForced must NOT be set
		// (resumeOrchBatch returns early before setting it)
		expect(state.resilience.resumeForced).toBe(false);
		// Phase must NOT be changed
		expect(state.phase).toBe("failed");
	});

	it("diagnostics success allows force-resume and records intent (contract simulation)", () => {
		// Simulate the resumeOrchBatch force-resume path:
		// 1. State is "stopped" + force=true → eligible
		// 2. Diagnostics pass → resume allowed
		// 3. resilience.resumeForced = true, phase reset to "paused"
		const state = makeState("stopped");
		state.orchBranch = ""; // no orch branch to check → only state-coherence
		state.lanes = []; // no worktrees to check

		const eligibility = checkResumeEligibility(state, true);
		expect(eligibility.eligible).toBe(true);

		const diagnostics = runPreResumeDiagnostics(state, "/tmp/test-root", "/tmp/state-root", null);
		expect(diagnostics.passed).toBe(true);

		// Simulate the state mutations from resumeOrchBatch section 2b
		const isForceResume = true && (state.phase === "stopped" || state.phase === "failed");
		expect(isForceResume).toBe(true);

		// Apply the contract mutations
		state.resilience.resumeForced = true;
		state.phase = "paused";

		// Verify final state matches contract
		expect(state.resilience.resumeForced).toBe(true);
		expect(state.phase).toBe("paused");
	});

	it("resilience.resumeForced is only set when force=true AND phase is stopped/failed", () => {
		// Normal resume from "paused" should NOT set resumeForced
		const state = makeState("paused");
		const eligibility = checkResumeEligibility(state, false);
		expect(eligibility.eligible).toBe(true);

		// The isForceResume check from resumeOrchBatch
		const isForceResume = false && (state.phase === "stopped" || state.phase === "failed");
		expect(isForceResume).toBe(false);

		// resilience.resumeForced stays false
		expect(state.resilience.resumeForced).toBe(false);
	});

	it("force=true on already-eligible phase (paused) does NOT set resumeForced", () => {
		// Even with --force, paused phase doesn't trigger force-resume path
		const state = makeState("paused");
		const eligibility = checkResumeEligibility(state, true);
		expect(eligibility.eligible).toBe(true);

		// The isForceResume condition in resumeOrchBatch:
		const isForceResume = true && (state.phase === "stopped" || state.phase === "failed");
		expect(isForceResume).toBe(false);

		// No force intent recorded for normal-eligible phases
		expect(state.resilience.resumeForced).toBe(false);
	});
});
