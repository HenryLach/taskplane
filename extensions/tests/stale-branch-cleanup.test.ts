/**
 * Stale Branch Cleanup Tests — TP-051
 *
 * Tests for:
 * - deleteStaleBranches() — deletes task/* and saved/* branches after integrate
 * - syncTaskOutcomesFromMonitor() — task startedAt uses observedAt, not mtime
 *
 * Run: npx vitest run extensions/tests/stale-branch-cleanup.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { deleteStaleBranches } from "../taskplane/worktree.ts";
import type { StaleBranchCleanupResult } from "../taskplane/worktree.ts";
import { runGit } from "../taskplane/git.ts";
import { syncTaskOutcomesFromMonitor } from "../taskplane/persistence.ts";
import type { LaneTaskOutcome, MonitorState, TaskMonitorSnapshot, LaneMonitorSnapshot } from "../taskplane/types.ts";

// ── Helpers ───────────────────────────────────────────────────────────

function createTempGitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "tp051-"));
	execSync("git init", { cwd: dir, stdio: "pipe" });
	execSync("git commit --allow-empty -m init", { cwd: dir, stdio: "pipe" });
	return dir;
}

function createBranch(repoRoot: string, branchName: string): void {
	execSync(`git branch "${branchName}"`, { cwd: repoRoot, stdio: "pipe" });
}

function branchExists(repoRoot: string, branchName: string): boolean {
	const result = runGit(["rev-parse", "--verify", `refs/heads/${branchName}`], repoRoot);
	return result.ok;
}

function listBranches(repoRoot: string, pattern: string): string[] {
	const result = runGit(["branch", "--list", pattern], repoRoot);
	if (!result.ok || !result.stdout.trim()) return [];
	return result.stdout.split("\n").map(b => b.replace(/^\*?\s+/, "").trim()).filter(Boolean);
}

// ── deleteStaleBranches Tests ────────────────────────────────────────

describe("deleteStaleBranches — TP-051", () => {
	let repoRoot: string;

	beforeEach(() => {
		repoRoot = createTempGitRepo();
	});

	afterEach(() => {
		try { rmSync(repoRoot, { recursive: true, force: true }); } catch { /* best effort */ }
	});

	it("deletes task/{opId}-lane-* branches for the operator", () => {
		createBranch(repoRoot, "task/henrylach-lane-1-20260308T111750");
		createBranch(repoRoot, "task/henrylach-lane-2-20260308T111750");

		const result = deleteStaleBranches(repoRoot, "henrylach", "20260308T111750");

		expect(result.deletedTaskBranches).toHaveLength(2);
		expect(result.deletedTaskBranches).toContain("task/henrylach-lane-1-20260308T111750");
		expect(result.deletedTaskBranches).toContain("task/henrylach-lane-2-20260308T111750");
		expect(result.failedDeletes).toHaveLength(0);

		// Verify branches are actually gone
		expect(branchExists(repoRoot, "task/henrylach-lane-1-20260308T111750")).toBe(false);
		expect(branchExists(repoRoot, "task/henrylach-lane-2-20260308T111750")).toBe(false);
	});

	it("deletes saved/task/{opId}-lane-* branches", () => {
		createBranch(repoRoot, "saved/task/henrylach-lane-1-20260308T111750");

		const result = deleteStaleBranches(repoRoot, "henrylach", "20260308T111750");

		expect(result.deletedSavedBranches).toHaveLength(1);
		expect(result.deletedSavedBranches).toContain("saved/task/henrylach-lane-1-20260308T111750");
		expect(branchExists(repoRoot, "saved/task/henrylach-lane-1-20260308T111750")).toBe(false);
	});

	it("deletes saved/{opId}-* partial-progress branches", () => {
		createBranch(repoRoot, "saved/henrylach-TP-001-20260308T111750");
		createBranch(repoRoot, "saved/henrylach-frontend-TP-002-20260308T111750");

		const result = deleteStaleBranches(repoRoot, "henrylach", "20260308T111750");

		expect(result.deletedSavedBranches).toHaveLength(2);
		expect(result.deletedSavedBranches).toContain("saved/henrylach-TP-001-20260308T111750");
		expect(result.deletedSavedBranches).toContain("saved/henrylach-frontend-TP-002-20260308T111750");
	});

	it("also deletes orphaned branches from previous batches", () => {
		// Current batch
		createBranch(repoRoot, "task/henrylach-lane-1-20260308T111750");
		// Orphan from previous batch
		createBranch(repoRoot, "task/henrylach-lane-1-20260301T090000");

		const result = deleteStaleBranches(repoRoot, "henrylach", "20260308T111750");

		// Both should be deleted (same operator prefix)
		expect(result.deletedTaskBranches).toHaveLength(2);
		expect(branchExists(repoRoot, "task/henrylach-lane-1-20260301T090000")).toBe(false);
	});

	it("does NOT delete branches belonging to a different operator", () => {
		createBranch(repoRoot, "task/henrylach-lane-1-20260308T111750");
		createBranch(repoRoot, "task/otherop-lane-1-20260308T111750");

		const result = deleteStaleBranches(repoRoot, "henrylach", "20260308T111750");

		expect(result.deletedTaskBranches).toHaveLength(1);
		expect(result.deletedTaskBranches).toContain("task/henrylach-lane-1-20260308T111750");
		// Other operator's branch should still exist
		expect(branchExists(repoRoot, "task/otherop-lane-1-20260308T111750")).toBe(true);
	});

	it("does NOT delete orch/* branches", () => {
		createBranch(repoRoot, "orch/henrylach-20260308T111750");
		createBranch(repoRoot, "task/henrylach-lane-1-20260308T111750");

		const result = deleteStaleBranches(repoRoot, "henrylach", "20260308T111750");

		expect(result.deletedTaskBranches).toHaveLength(1);
		// Orch branch is untouched
		expect(branchExists(repoRoot, "orch/henrylach-20260308T111750")).toBe(true);
	});

	it("returns empty results when no matching branches exist", () => {
		const result = deleteStaleBranches(repoRoot, "henrylach", "20260308T111750");

		expect(result.deletedTaskBranches).toHaveLength(0);
		expect(result.deletedSavedBranches).toHaveLength(0);
		expect(result.failedDeletes).toHaveLength(0);
	});

	it("handles mixed task/* and saved/* branches together", () => {
		createBranch(repoRoot, "task/henrylach-lane-1-20260308T111750");
		createBranch(repoRoot, "saved/task/henrylach-lane-1-20260308T111750");
		createBranch(repoRoot, "saved/henrylach-TP-003-20260308T111750");

		const result = deleteStaleBranches(repoRoot, "henrylach", "20260308T111750");

		expect(result.deletedTaskBranches).toHaveLength(1);
		expect(result.deletedSavedBranches).toHaveLength(2);
		expect(result.failedDeletes).toHaveLength(0);
	});
});

// ── Task startedAt Timing Tests ──────────────────────────────────────

describe("syncTaskOutcomesFromMonitor — TP-051 task startedAt fix", () => {
	/** Build a minimal MonitorState with one lane and a current task snapshot. */
	function makeMonitorWithCurrentTask(opts: {
		taskId: string;
		status: TaskMonitorSnapshot["status"];
		lastHeartbeat: number | null;
		observedAt: number;
	}): MonitorState {
		const snap: TaskMonitorSnapshot = {
			taskId: opts.taskId,
			status: opts.status,
			currentStepName: null,
			currentStepNumber: null,
			totalSteps: 0,
			totalChecked: 0,
			totalItems: 0,
			sessionAlive: true,
			doneFileFound: false,
			stallReason: null,
			lastHeartbeat: opts.lastHeartbeat,
			observedAt: opts.observedAt,
			parseError: null,
			iteration: 1,
			reviewCounter: 0,
		};

		const lane: LaneMonitorSnapshot = {
			laneId: "lane-1",
			laneNumber: 1,
			sessionName: "orch-lane-1",
			sessionAlive: true,
			currentTaskId: opts.taskId,
			currentTaskSnapshot: snap,
			completedTasks: [],
			failedTasks: [],
			remainingTasks: [],
		};

		return {
			lanes: [lane],
			tasksDone: 0,
			tasksFailed: 0,
			tasksTotal: 1,
			waveNumber: 1,
			pollCount: 1,
			lastPollTime: opts.observedAt,
			allTerminal: false,
		};
	}

	it("uses observedAt (not mtime/lastHeartbeat) for first-seen running task startTime", () => {
		const now = Date.now();
		const staleStatusMtime = now - 3_600_000; // STATUS.md was modified 1 hour ago (during staging)

		const outcomes: LaneTaskOutcome[] = [];
		const monitor = makeMonitorWithCurrentTask({
			taskId: "TP-001",
			status: "running",
			lastHeartbeat: staleStatusMtime, // STATUS.md mtime — stale
			observedAt: now,                 // actual poll time
		});

		syncTaskOutcomesFromMonitor(monitor, outcomes);

		expect(outcomes).toHaveLength(1);
		expect(outcomes[0].taskId).toBe("TP-001");
		expect(outcomes[0].status).toBe("running");
		// startTime should be observedAt (now), NOT lastHeartbeat (stale mtime)
		expect(outcomes[0].startTime).toBe(now);
	});

	it("preserves existing startTime on subsequent monitor syncs", () => {
		const firstPoll = 1000000;
		const secondPoll = 1005000;
		const staleHeartbeat = 900000;

		// First sync — task first seen running
		const outcomes: LaneTaskOutcome[] = [];
		const monitor1 = makeMonitorWithCurrentTask({
			taskId: "TP-001",
			status: "running",
			lastHeartbeat: staleHeartbeat,
			observedAt: firstPoll,
		});
		syncTaskOutcomesFromMonitor(monitor1, outcomes);
		expect(outcomes[0].startTime).toBe(firstPoll);

		// Second sync — startTime should be preserved from first observation
		const monitor2 = makeMonitorWithCurrentTask({
			taskId: "TP-001",
			status: "running",
			lastHeartbeat: secondPoll - 1000,
			observedAt: secondPoll,
		});
		syncTaskOutcomesFromMonitor(monitor2, outcomes);
		expect(outcomes[0].startTime).toBe(firstPoll); // Preserved, not updated to secondPoll
	});

	it("uses existing startTime from executeLane over monitor observedAt", () => {
		const executionStartTime = 500000; // From executeLane's Date.now()
		const monitorObserved = 510000;

		// Pre-populated outcome from executeLane (has a real startTime)
		const outcomes: LaneTaskOutcome[] = [{
			taskId: "TP-001",
			status: "running",
			startTime: executionStartTime,
			endTime: null,
			exitReason: "Task in progress",
			sessionName: "orch-lane-1",
			doneFileFound: false,
		}];

		const monitor = makeMonitorWithCurrentTask({
			taskId: "TP-001",
			status: "running",
			lastHeartbeat: monitorObserved - 1000,
			observedAt: monitorObserved,
		});

		syncTaskOutcomesFromMonitor(monitor, outcomes);

		// Should keep the original executeLane startTime
		expect(outcomes[0].startTime).toBe(executionStartTime);
	});
});
