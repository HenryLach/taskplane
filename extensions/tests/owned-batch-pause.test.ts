/**
 * Owned-batch pause must never convert a task to `skipped` (penster batch
 * 20260906T194514): orch_pause on an owned single-wave batch with an idle held
 * lane marked the task skipped, completed the batch 0/1, removed the worktree.
 *
 * Root causes: (1) lane-runner returned "skipped" for a pause seen at the loop
 * top; (2) execution.ts skipped the remaining lane tasks on pause; (3) the engine
 * only honoured pause BEFORE the next wave, so a single-wave batch "completed".
 *
 * Also covers the recovery from that state (orch_retry_task accepts skipped;
 * completed → stopped reopen), the interim hold-iteration budget, and the truthful
 * completion wording (#610 recurrence: "Merged … Ready for integration" on 0/1).
 */

import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "./expect.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
function readSrc(file: string): string {
	return readFileSync(join(HERE, "..", "taskplane", file), "utf-8");
}

let spawnCount = 0;
const realAgentHost = await import("../taskplane/agent-host.ts");
const mockSpawnAgent = mock.fn(() => {
	spawnCount++;
	const result = {
		exitCode: 0,
		signal: null,
		durationMs: 500,
		killed: false,
		inputTokens: 1,
		outputTokens: 1,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		costUsd: 0.01,
		toolCalls: 0,
		lastTool: "",
		retries: 0,
		compactions: 0,
		contextUsage: null,
		error: null,
		agentEnded: true,
		stderrTail: "",
	};
	return { promise: Promise.resolve(result), kill: () => {} } as unknown as ReturnType<
		typeof realAgentHost.spawnAgent
	>;
});
mock.module("../taskplane/agent-host.ts", {
	namedExports: { ...realAgentHost, spawnAgent: mockSpawnAgent },
});

const { executeTaskV2, mapLaneTaskStatusToTerminalSnapshotStatus } = await import(
	"../taskplane/lane-runner.ts"
);
const { resolvePacketPaths } = await import("../taskplane/types.ts");
const { describeOrchBranchState } = await import("../taskplane/git.ts");
const { resetTaskSegmentsForRetry } = await import("../taskplane/segment-recovery.ts");

const PROMPT_MD = `# TP-P: Pause fixture

**Created:** 2026-09-06
**Size:** S

## Review Level: 0

## Mission

Pause me.

## Steps

### Step 1: Work

- [ ] Do a thing
- [ ] Do another

---
`;
const STATUS_MD = `# TP-P — Status

**Current Step:** Not Started
**Status:** 🔵 Ready
**Iteration:** 0
**Review Level:** 0
**Review Counter:** 0

---

### Step 1: Work
**Status:** ⬜ Not Started

- [ ] Do a thing
- [ ] Do another

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|

---
`;

describe("owned-batch pause → pending, never skipped (behavioural)", () => {
	let tmpRoot: string;
	let taskFolder: string;
	let worktreePath: string;

	beforeEach(() => {
		spawnCount = 0;
		tmpRoot = mkdtempSync(join(tmpdir(), "tp-pause-"));
		worktreePath = join(tmpRoot, "worktree");
		taskFolder = join(worktreePath, "taskplane-tasks", "TP-P");
		mkdirSync(taskFolder, { recursive: true });
		writeFileSync(join(taskFolder, "PROMPT.md"), PROMPT_MD);
		writeFileSync(join(taskFolder, "STATUS.md"), STATUS_MD);
		mkdirSync(join(tmpRoot, ".pi"), { recursive: true });
	});
	afterEach(() => {
		try {
			rmSync(tmpRoot, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("a pause seen at the loop top returns status 'pending' (not 'skipped'), no spawn, no .DONE", async () => {
		const packet = resolvePacketPaths(taskFolder);
		const unit = {
			id: "TP-P",
			taskId: "TP-P",
			segmentId: null,
			executionRepoId: "default",
			packetHomeRepoId: "default",
			worktreePath,
			packet,
			task: {
				taskId: "TP-P",
				taskName: "Pause fixture",
				reviewLevel: 0,
				size: "S",
				dependencies: [],
				fileScope: [],
				taskFolder,
				promptPath: packet.promptPath,
				areaName: "test",
				status: "pending" as const,
			},
		};
		const config = {
			batchId: "tp-pause",
			agentIdPrefix: "orch-test",
			laneNumber: 1,
			worktreePath,
			branch: "b",
			repoId: "default",
			stateRoot: tmpRoot,
			workerModel: "",
			workerTools: "",
			workerThinking: "",
			workerSystemPrompt: "",
			workerSegmentPrompt: "",
			reviewerModel: "",
			reviewerThinking: "",
			reviewerTools: "",
			maxIterations: 5,
			noProgressLimit: 3,
			maxWorkerMinutes: 5,
			warnPercent: 80,
			killPercent: 95,
		};
		const result = await executeTaskV2(
			unit as Parameters<typeof executeTaskV2>[0],
			config as unknown as Parameters<typeof executeTaskV2>[1],
			{ paused: true, cause: "operator" },
		);
		expect(result.outcome.status).toBe("pending");
		expect(result.outcome.exitReason).toBe("Paused by user");
		expect(spawnCount).toBe(0);
		expect(mapLaneTaskStatusToTerminalSnapshotStatus("pending")).toBe("idle");
	});
});

describe("owned-batch pause — wiring (tally, engine/resume finalizers, cause-aware Tier-0)", () => {
	it("execution.ts: pause leaves remaining lane tasks pending; tally exposes pausedTaskIds; all-pending wave is not 'succeeded'", () => {
		const flat = readSrc("execution.ts").replace(/\s+/g, " ");
		expect(flat).toContain(
			'status: (pauseSignal.paused || laneHeld) && !shouldSkipRemaining ? "pending" : "skipped"',
		);
		expect(flat).toContain('} else if (t.status === "pending") { pausedTaskIds.push(t.taskId); }');
		expect(flat).toContain(
			"} else if ((pausedTaskIds.length > 0 || heldTaskIds.length > 0) && failedTaskIds.length === 0) {",
		);
		expect(flat).toContain('pauseSignal.cause = "abort";');
	});

	it("engine.ts + resume.ts: a paused wave finalizes as 'paused' BEFORE merge, preserves worktrees, and stops", () => {
		for (const f of ["engine.ts", "resume.ts"]) {
			const src = readSrc(f);
			const flat = src.replace(/\s+/g, " ");
			expect(flat).toContain("Pause finalizer");
			expect(flat).toContain('batchState.phase = "paused"; preserveWorktreesForResume = true;');
			expect(flat).toContain('"pause-during-wave"');
			// The finalizer precedes the wave-execution-complete persist (and thus the merge).
			expect(src.indexOf("Pause finalizer")).toBeLessThan(src.indexOf('"wave-execution-complete"'));
			// A stop-all abort keeps its own path.
			expect(flat).toContain(
				'batchState.pauseSignal.cause !== "abort" && waveResult.overallStatus !== "aborted"',
			);
		}
	});

	it("engine.ts: Tier-0 may clear ONLY a policy pause, never an operator/abort pause", () => {
		const flat = readSrc("engine.ts").replace(/\s+/g, " ");
		expect(flat).toContain(
			'(batchState.pauseSignal.cause === undefined || batchState.pauseSignal.cause === "stop-wave") && waveResult.policyApplied === "stop-wave"',
		);
		const worker = readSrc("engine-worker.ts").replace(/\s+/g, " ");
		expect(worker).toContain(
			'case "pause": batchState.pauseSignal.paused = true; batchState.pauseSignal.cause = "operator";',
		);
		expect(worker).toContain(
			'case "abort": batchState.pauseSignal.paused = true; batchState.pauseSignal.cause = "abort";',
		);
	});
});

describe("recovery from the incident state", () => {
	it("orch_retry_task accepts 'skipped', decrements skippedTasks, reopens a completed batch as stopped, keeps provenance", () => {
		const flat = readSrc("extension.ts").replace(/\s+/g, " ");
		expect(flat).toContain(
			'taskRecord.status !== "failed" && taskRecord.status !== "stalled" && taskRecord.status !== "skipped"',
		);
		expect(flat).toContain(
			'} else if (prevStatus === "skipped") { state.skippedTasks = Math.max(0, (state.skippedTasks ?? 0) - 1); }',
		);
		expect(flat).toContain('if (state.phase === "completed") {');
		expect(flat).toContain("has already been integrated. Start a new batch for follow-up work.");
		expect(flat).toContain(
			'state.phase = "stopped"; state.endedAt = null; reopenedCompleted = true;',
		);
		// Provenance is reported, not cleared.
		expect(/Preserved progress: branch \$\{preservedBranch\}/.test(flat)).toBe(true);
		expect(flat).not.toContain("taskRecord.partialProgressBranch = undefined;");
	});

	it("resume 8d catch-up merge: succeeded-but-unmerged lanes are merged before the wave loop; failure halts as a resumable pause; repeated tasks map to their LAST wave", () => {
		const src = readSrc("resume.ts");
		const flat = src.replace(/\s+/g, " ");
		expect(flat).toContain("8d. Catch-up merge: succeeded-but-unmerged lane work");
		// Runs after 8c and before step 9 / the wave loop.
		expect(src.indexOf("8d. Catch-up merge")).toBeGreaterThan(
			src.indexOf("re-executed lane branch(es)..."),
		);
		expect(src.indexOf("8d. Catch-up merge")).toBeLessThan(
			src.indexOf("9. Persist state after reconciliation"),
		);
		// Eligibility lives in the pure, tested selectCatchUpLanes helper; 8d uses it.
		expect(flat).toContain(
			"for (const laneRecord of selectCatchUpLanes( persistedState, runtimeWavePlan, new Set(reExecuteFinalStatus.keys()), ))",
		);
		// 8d is skipped entirely after an 8c merge failure (no subset certification of the wave).
		expect(flat).toContain('if (batchState.pauseSignal.cause !== "merge-failure") {');
		// Last occurrence mapping (multi-segment tasks) inside the helper.
		expect(flat).toContain("for (const id of wave) waveOfTask.set(id, i);");
		expect(flat).not.toContain("if (!waveOfTask.has(id)) waveOfTask.set(id, i);");
		// Failure → paused (cause merge-failure), worktrees preserved, alert; never proceeds as complete.
		expect(flat).toContain(
			'batchState.pauseSignal.paused = true; batchState.pauseSignal.cause = "merge-failure"; preserveWorktreesForResume = true;',
		);
		expect(flat).toContain('category: "merge-failure"');
		// 8c (re-executed branch merge) fails closed the same way.
		expect(
			flat.split('batchState.pauseSignal.cause = "merge-failure"; preserveWorktreesForResume = true;')
				.length - 1,
		).toBe(2);
		expect(
			/Merge of re-executed task\(s\) \$\{succeededReExecTaskIds\.join\(", "\)\} failed on resume/.test(
				flat,
			),
		).toBe(true);
		// Recorded against the ORIGINAL wave(s) (runtime 1-indexed).
		expect(flat).toContain("batchState.mergeResults.push({ ...catchUp, waveIndex: w + 1 });");
	});

	it("segment frontier advances after a non-final re-executed segment succeeds (persisted + parsed task)", async () => {
		const { advanceActiveSegment } = await import("../taskplane/segment-recovery.ts");
		const state = {
			tasks: [{ taskId: "T", segmentIds: ["T::a", "T::b", "T::c"], activeSegmentId: "T::a" }],
			segments: [
				{ segmentId: "T::a", taskId: "T", status: "succeeded" },
				{ segmentId: "T::b", taskId: "T", status: "pending" },
				{ segmentId: "T::c", taskId: "T", status: "pending" },
			],
		} as never;
		expect(advanceActiveSegment(state, "T")).toBe("T::b");
		(state as { segments: Array<{ status: string }> }).segments[1].status = "succeeded";
		expect(advanceActiveSegment(state, "T")).toBe("T::c");
		(state as { segments: Array<{ status: string }> }).segments[2].status = "succeeded";
		expect(advanceActiveSegment(state, "T")).toBe(null);
		const flat = readSrc("resume.ts").replace(/\s+/g, " ");
		expect(flat).toContain("const nextSeg = advanceActiveSegment(");
		expect(flat).toContain("if (parsedForFrontier) parsedForFrontier.activeSegmentId = nextSeg;");
	});

	it("in-process writers stamp the pause cause (fallback engine has no IPC handler to do it)", () => {
		const flat = readSrc("extension.ts").replace(/\s+/g, " ");
		// doOrchPause (live) + administrative pause + takeover → operator; abort → abort.
		expect(flat.split('orchBatchState.pauseSignal.cause = "operator";').length - 1).toBe(3);
		expect(flat).toContain('orchBatchState.pauseSignal.cause = "abort";');
		expect(flat).toContain(
			'orchBatchState.pauseSignal.paused = true; orchBatchState.pauseSignal.cause = "operator"; // in-process (fallback) engine reads this directly',
		);
		// Catch-up stub is enriched from the persisted record (task folder for artifact staging).
		expect(readSrc("resume.ts").replace(/\s+/g, " ")).toContain(
			'taskFolder: rec?.taskFolder ?? "", promptPath: rec?.taskFolder ? join(rec.taskFolder, "PROMPT.md") : "",',
		);
	});

	it("Tier-0 clear (pure predicate): an operator pause survives a successful stop-wave recovery; a policy pause does not", () => {
		// Mirrors engine.ts's guard exactly so the contract is exercised, not just grepped.
		const tier0MayClear = (
			sig: { paused: boolean; cause?: string },
			policy: string,
			failed: number,
		) =>
			failed === 0 &&
			sig.paused &&
			(sig.cause === undefined || sig.cause === "stop-wave") &&
			policy === "stop-wave";
		expect(tier0MayClear({ paused: true, cause: "operator" }, "stop-wave", 0)).toBe(false);
		expect(tier0MayClear({ paused: true, cause: "merge-failure" }, "stop-wave", 0)).toBe(false);
		expect(tier0MayClear({ paused: true, cause: "abort" }, "stop-wave", 0)).toBe(false);
		expect(tier0MayClear({ paused: true, cause: "stop-wave" }, "stop-wave", 0)).toBe(true);
		expect(tier0MayClear({ paused: true }, "stop-wave", 0)).toBe(true);
		expect(tier0MayClear({ paused: true }, "stop-wave", 1)).toBe(false);
	});

	it("TWO-RESUME REGRESSION (pure state): A succeeded + B paused → resume 1: B re-executes, 8c merge FAILS → nothing certifies the wave → resume 2: catch-up selects BOTH lanes", async () => {
		const { computeResumePoint, selectCatchUpLanes } = await import("../taskplane/resume.ts");
		const { defaultBatchDiagnostics, defaultResilienceState } = await import("../taskplane/types.ts");
		const mk = (
			aStatus: string,
			bStatus: string,
			mergeResults: Array<{ waveIndex: number; status: string }>,
		) =>
			({
				schemaVersion: 4,
				phase: "paused",
				batchId: "b",
				baseBranch: "main",
				orchBranch: "orch/b",
				mode: "repo",
				startedAt: 1,
				updatedAt: 2,
				endedAt: null,
				currentWaveIndex: 0,
				totalWaves: 1,
				wavePlan: [["A", "B"]],
				lanes: [
					{
						laneNumber: 1,
						laneId: "lane-1",
						laneSessionId: "s1",
						worktreePath: "/w1",
						branch: "task/l1",
						taskIds: ["A"],
					},
					{
						laneNumber: 2,
						laneId: "lane-2",
						laneSessionId: "s2",
						worktreePath: "/w2",
						branch: "task/l2",
						taskIds: ["B"],
					},
				],
				tasks: [
					{
						taskId: "A",
						laneNumber: 1,
						sessionName: "s1",
						status: aStatus,
						taskFolder: "/t/A",
						startedAt: 1,
						endedAt: 2,
						doneFileFound: aStatus === "succeeded",
						exitReason: "",
					},
					{
						taskId: "B",
						laneNumber: 2,
						sessionName: "s2",
						status: bStatus,
						taskFolder: "/t/B",
						startedAt: null,
						endedAt: null,
						doneFileFound: false,
						exitReason: "Paused by user",
					},
				],
				mergeResults,
				totalTasks: 2,
				succeededTasks: aStatus === "succeeded" ? 1 : 0,
				failedTasks: 0,
				skippedTasks: 0,
				blockedTasks: 0,
				blockedTaskIds: [],
				lastError: null,
				errors: [],
				resilience: defaultResilienceState(),
				diagnostics: defaultBatchDiagnostics(),
				segments: [],
			}) as never;

		// ── Resume 1: after the pause. A succeeded (unmerged: no merge record); B pending.
		const s1 = mk("succeeded", "pending", []);
		// computeResumePoint: wave 0 is NOT done (B pending) and has NO merge-retry index —
		// the reason the plain wave loop would never merge A (Sage's finding).
		const rp1 = computeResumePoint(s1, [
			{
				taskId: "A",
				persistedStatus: "succeeded",
				liveStatus: "succeeded",
				sessionAlive: false,
				doneFileFound: true,
				worktreeExists: true,
				action: "skip",
			},
			{
				taskId: "B",
				persistedStatus: "pending",
				liveStatus: "pending",
				sessionAlive: false,
				doneFileFound: false,
				worktreeExists: true,
				action: "re-execute",
			},
		] as never);
		expect(rp1.resumeWaveIndex).toBe(0);
		expect(rp1.mergeRetryWaveIndexes).toEqual([]);
		// 8d selects A's lane (succeeded, unmerged), not B's (re-executing).
		expect(selectCatchUpLanes(s1, [["A", "B"]], new Set(["B"])).map((l) => l.laneId)).toEqual([
			"lane-1",
		]);

		// ── 8c: B re-executes and succeeds but its merge FAILS → paused (merge-failure);
		// 8d is skipped, so the wave is NOT certified by A's subset merge. Persisted:
		// both succeeded, one FAILED merge record (sentinel → wave 0), no succeeded record.
		const s2 = mk("succeeded", "succeeded", [{ waveIndex: 0, status: "failed" }]);

		// ── Resume 2: both lanes are succeeded-but-unmerged → catch-up selects BOTH.
		const rp2 = computeResumePoint(s2, [
			{
				taskId: "A",
				persistedStatus: "succeeded",
				liveStatus: "succeeded",
				sessionAlive: false,
				doneFileFound: true,
				worktreeExists: true,
				action: "skip",
			},
			{
				taskId: "B",
				persistedStatus: "succeeded",
				liveStatus: "succeeded",
				sessionAlive: false,
				doneFileFound: true,
				worktreeExists: true,
				action: "skip",
			},
		] as never);
		// All tasks terminal + a FAILED merge record → the wave is flagged for merge retry
		// (resume index stays at 0, not past the end), and 8d's catch-up also selects both.
		expect(rp2.resumeWaveIndex).toBe(0);
		expect(rp2.mergeRetryWaveIndexes).toEqual([0]);
		expect(selectCatchUpLanes(s2, [["A", "B"]], new Set()).map((l) => l.laneId)).toEqual([
			"lane-1",
			"lane-2",
		]);

		// Once a SUCCEEDED merge record exists for wave 0, nothing is selected (idempotent stop).
		const s3 = mk("succeeded", "succeeded", [
			{ waveIndex: 0, status: "failed" },
			{ waveIndex: 0, status: "succeeded" },
		]);
		expect(selectCatchUpLanes(s3, [["A", "B"]], new Set())).toEqual([]);
	});

	it("selectCatchUpLanes maps a repeated (multi-segment) task to its LAST wave", async () => {
		const { selectCatchUpLanes } = await import("../taskplane/resume.ts");
		const state = {
			lanes: [
				{
					laneNumber: 1,
					laneId: "lane-1",
					laneSessionId: "s",
					worktreePath: "/w",
					branch: "task/l1",
					taskIds: ["T"],
				},
			],
			tasks: [{ taskId: "T", status: "succeeded" }],
			// W1 (index 0) merged; W2 (index 1) — the lane's latest work — not merged.
			mergeResults: [{ waveIndex: 0, status: "succeeded" }],
		} as never;
		expect(selectCatchUpLanes(state, [["T"], ["T"]], new Set()).map((l) => l.laneId)).toEqual([
			"lane-1",
		]);
		// If W2 had merged too → nothing.
		(state as { mergeResults: Array<{ waveIndex: number; status: string }> }).mergeResults.push({
			waveIndex: 1,
			status: "succeeded",
		});
		expect(selectCatchUpLanes(state, [["T"], ["T"]], new Set())).toEqual([]);
	});

	it("selectCatchUpLanes uses the LATEST merge status per wave: success → later failure (with a third task still pending) still selects the unmerged lane", async () => {
		const { selectCatchUpLanes, computeResumePoint } = await import("../taskplane/resume.ts");
		const state = {
			lanes: [
				{
					laneNumber: 1,
					laneId: "lane-1",
					laneSessionId: "s1",
					worktreePath: "/w1",
					branch: "task/l1",
					taskIds: ["A"],
				},
				{
					laneNumber: 2,
					laneId: "lane-2",
					laneSessionId: "s2",
					worktreePath: "/w2",
					branch: "task/l2",
					taskIds: ["B"],
				},
				{
					laneNumber: 3,
					laneId: "lane-3",
					laneSessionId: "s3",
					worktreePath: "/w3",
					branch: "task/l3",
					taskIds: ["C"],
				},
			],
			tasks: [
				{ taskId: "A", status: "succeeded" },
				{ taskId: "B", status: "succeeded" },
				{ taskId: "C", status: "pending" },
			],
			// 8c merged B (recorded as wave-0 success), then 8d's A merge FAILED (later record).
			mergeResults: [
				{ waveIndex: 0, status: "succeeded" },
				{ waveIndex: 0, status: "failed" },
			],
		} as never;
		// C pending → no merge-retry index from computeResumePoint…
		const rp = computeResumePoint(
			{ ...(state as object), wavePlan: [["A", "B", "C"]], segments: [] } as never,
			[
				{
					taskId: "A",
					persistedStatus: "succeeded",
					liveStatus: "succeeded",
					sessionAlive: false,
					doneFileFound: true,
					worktreeExists: true,
					action: "skip",
				},
				{
					taskId: "B",
					persistedStatus: "succeeded",
					liveStatus: "succeeded",
					sessionAlive: false,
					doneFileFound: true,
					worktreeExists: true,
					action: "skip",
				},
				{
					taskId: "C",
					persistedStatus: "pending",
					liveStatus: "pending",
					sessionAlive: false,
					doneFileFound: false,
					worktreeExists: true,
					action: "re-execute",
				},
			] as never,
		);
		expect(rp.mergeRetryWaveIndexes).toEqual([]);
		// …so the catch-up MUST still select the succeeded lanes (latest status is failed, not the older success).
		expect(selectCatchUpLanes(state, [["A", "B", "C"]], new Set(["C"])).map((l) => l.laneId)).toEqual(
			["lane-1", "lane-2"],
		);
	});

	it("SECOND-WAVE regression: an 8c merge failure is attributed to the task's real wave, so the next resume selects its unmerged lane", async () => {
		const { selectCatchUpLanes, computeResumePoint } = await import("../taskplane/resume.ts");
		// Wave 0: X (merged long ago). Wave 1: A (succeeded, subset-merged earlier), C (re-executed → succeeded, merge FAILED).
		// With the old -1 sentinel the failure was clamped to wave 0; wave 1 kept its older success and C was never selected.
		const state = {
			lanes: [
				{
					laneNumber: 1,
					laneId: "lane-1",
					laneSessionId: "s1",
					worktreePath: "/w1",
					branch: "task/l1",
					taskIds: ["A"],
				},
				{
					laneNumber: 2,
					laneId: "lane-2",
					laneSessionId: "s2",
					worktreePath: "/w2",
					branch: "task/l2",
					taskIds: ["C"],
				},
				{
					laneNumber: 3,
					laneId: "lane-3",
					laneSessionId: "s3",
					worktreePath: "/w3",
					branch: "task/l3",
					taskIds: ["X"],
				},
			],
			tasks: [
				{ taskId: "X", status: "succeeded" },
				{ taskId: "A", status: "succeeded" },
				{ taskId: "C", status: "succeeded" },
			],
			// persisted (0-based): wave 0 succeeded; wave 1: earlier subset success, then the 8c failure NOW attributed to wave 1.
			mergeResults: [
				{ waveIndex: 0, status: "succeeded" },
				{ waveIndex: 1, status: "succeeded" },
				{ waveIndex: 1, status: "failed" },
			],
		} as never;
		const plan = [["X"], ["A", "C"]];
		const rp = computeResumePoint(
			{ ...(state as object), wavePlan: plan, segments: [] } as never,
			[
				{
					taskId: "X",
					persistedStatus: "succeeded",
					liveStatus: "succeeded",
					sessionAlive: false,
					doneFileFound: true,
					worktreeExists: true,
					action: "skip",
				},
				{
					taskId: "A",
					persistedStatus: "succeeded",
					liveStatus: "succeeded",
					sessionAlive: false,
					doneFileFound: true,
					worktreeExists: true,
					action: "skip",
				},
				{
					taskId: "C",
					persistedStatus: "succeeded",
					liveStatus: "succeeded",
					sessionAlive: false,
					doneFileFound: true,
					worktreeExists: true,
					action: "skip",
				},
			] as never,
		);
		expect(rp.mergeRetryWaveIndexes).toEqual([1]); // the RIGHT wave
		// Wave 0 is merged (X excluded); wave 1's latest record is failed → A and C selected.
		expect(selectCatchUpLanes(state, plan, new Set()).map((l) => l.laneId)).toEqual([
			"lane-1",
			"lane-2",
		]);
		// 8c attribution wiring: results pushed per real (last) wave, not the sentinel.
		const flat = readSrc("resume.ts").replace(/\s+/g, " ");
		expect(flat).toContain(
			"batchState.mergeResults.push({ ...reExecMergeResult, waveIndex: w + 1 });",
		);
	});

	it("MERGE-HISTORY ROUND TRIP: fresh runtime → restored history → 8c append → serialize → reload → correct retry index and catch-up selection", async () => {
		const { selectCatchUpLanes, computeResumePoint } = await import("../taskplane/resume.ts");
		const { serializeBatchState } = await import("../taskplane/persistence.ts");
		const { freshOrchBatchState } = await import("../taskplane/types.ts");
		// Persisted history before this resume (0-based): wave 0 succeeded; wave 1 earlier subset success.
		const persistedMerges = [
			{ waveIndex: 0, status: "succeeded", failedLane: null, failureReason: null },
			{ waveIndex: 1, status: "succeeded", failedLane: null, failureReason: null },
		];
		// Mirror resume.ts's restoration (0-based → runtime 1-based) into a FRESH runtime state.
		const bs = freshOrchBatchState();
		bs.batchId = "b";
		bs.mergeResults = persistedMerges.map(
			(mr) =>
				({
					waveIndex: mr.waveIndex + 1,
					status: mr.status,
					laneResults: [],
					failedLane: mr.failedLane,
					failureReason: mr.failureReason,
					totalDurationMs: 0,
				}) as never,
		);
		// 8c: C (wave 1, runtime index 2) re-executed; its merge FAILED → attributed to wave 1 (runtime 2).
		bs.mergeResults.push({
			waveIndex: 2,
			status: "failed",
			laneResults: [],
			failedLane: 2,
			failureReason: "conflict",
			totalDurationMs: 0,
		} as never);
		// Serialize (runtime → persisted, -1 once) and reload.
		const plan = [["X"], ["A", "C"]];
		const json = JSON.parse(serializeBatchState(bs, plan, [], [])) as {
			mergeResults: Array<{ waveIndex: number; status: string }>;
		};
		expect(json.mergeResults.map((m) => [m.waveIndex, m.status])).toEqual([
			[0, "succeeded"],
			[1, "succeeded"],
			[1, "failed"],
		]);
		// Next resume: wave 0 history SURVIVED → retry only [1]; catch-up excludes X, selects A + C.
		const reloaded = {
			lanes: [
				{
					laneNumber: 3,
					laneId: "lane-3",
					laneSessionId: "s3",
					worktreePath: "/w3",
					branch: "task/l3",
					taskIds: ["X"],
				},
				{
					laneNumber: 1,
					laneId: "lane-1",
					laneSessionId: "s1",
					worktreePath: "/w1",
					branch: "task/l1",
					taskIds: ["A"],
				},
				{
					laneNumber: 2,
					laneId: "lane-2",
					laneSessionId: "s2",
					worktreePath: "/w2",
					branch: "task/l2",
					taskIds: ["C"],
				},
			],
			tasks: [
				{ taskId: "X", status: "succeeded" },
				{ taskId: "A", status: "succeeded" },
				{ taskId: "C", status: "succeeded" },
			],
			mergeResults: json.mergeResults,
			wavePlan: plan,
			segments: [],
		} as never;
		const skip = (id: string) => ({
			taskId: id,
			persistedStatus: "succeeded",
			liveStatus: "succeeded",
			sessionAlive: false,
			doneFileFound: true,
			worktreeExists: true,
			action: "skip",
		});
		const rp = computeResumePoint(reloaded, [skip("X"), skip("A"), skip("C")] as never);
		expect(rp.mergeRetryWaveIndexes).toEqual([1]);
		expect(selectCatchUpLanes(reloaded, plan, new Set()).map((l) => l.laneId)).toEqual([
			"lane-1",
			"lane-2",
		]);
		// And the restoration wiring exists in resume.ts.
		expect(readSrc("resume.ts").replace(/\s+/g, " ")).toContain(
			"batchState.mergeResults = (persistedState.mergeResults ?? []).map(",
		);
	});

	it("segment reset reopens skipped segments too", () => {
		const state = {
			tasks: [{ taskId: "T", segmentIds: ["T::default"], activeSegmentId: null }],
			segments: [
				{
					segmentId: "T::default",
					taskId: "T",
					repoId: "default",
					status: "skipped",
					laneId: "lane-1",
					sessionName: "s",
					worktreePath: "/w",
					branch: "b",
					startedAt: null,
					endedAt: 1,
					retries: 0,
					exitReason: "Skipped due to pause signal",
					dependsOnSegmentIds: [],
				},
			],
		} as never;
		const r = resetTaskSegmentsForRetry(state, "T");
		expect(r.resetSegmentIds).toEqual(["T::default"]);
	});

	it("held units do not consume the productive-iteration budget (#627: no worker exists while held)", () => {
		const flat = readSrc("lane-runner.ts").replace(/\s+/g, " ");
		expect(flat).toContain(
			"for (; productiveIterations < config.maxIterations; productiveIterations++) {",
		);
		expect(flat).toContain("not counted toward stall or iteration budget");
		expect(flat).toContain("productiveIterations--; continue; }");
	});
});

describe("truthful completion wording (#610 recurrence)", () => {
	let repo: string;
	beforeEach(() => {
		repo = mkdtempSync(join(tmpdir(), "tp-branchstate-"));
		execSync("git init -q -b main", { cwd: repo });
		execSync("git config user.email t@t && git config user.name t", { cwd: repo });
		writeFileSync(join(repo, "a.txt"), "a\n");
		execSync("git add -A && git commit -q -m init", { cwd: repo });
	});
	afterEach(() => {
		try {
			rmSync(repo, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("describeOrchBranchState: missing / empty / ahead / unknown", () => {
		expect(describeOrchBranchState("orch/x", "main", repo).kind).toBe("missing");
		execSync("git branch orch/x", { cwd: repo });
		const empty = describeOrchBranchState("orch/x", "main", repo);
		expect(empty.kind).toBe("empty");
		expect(empty.detail).toContain("nothing was merged");
		execSync("git checkout -q orch/x", { cwd: repo });
		writeFileSync(join(repo, "b.txt"), "b\n");
		execSync("git add -A && git commit -q -m work", { cwd: repo });
		const ahead = describeOrchBranchState("orch/x", "main", repo);
		expect(ahead.kind).toBe("ahead");
		expect(ahead.aheadBy).toBe(1);
		expect(describeOrchBranchState("orch/x", "does-not-exist", repo).kind).toBe("unknown");
		expect(describeOrchBranchState("", "main", repo).kind).toBe("missing");
	});

	it("describeOrchBranchStateAcrossRepos: a secondary repo ahead wins over an empty primary", async () => {
		const { describeOrchBranchStateAcrossRepos } = await import("../taskplane/git.ts");
		const second = mkdtempSync(join(tmpdir(), "tp-branchstate2-"));
		try {
			execSync("git init -q -b main", { cwd: second });
			execSync("git config user.email t@t && git config user.name t", { cwd: second });
			writeFileSync(join(second, "a.txt"), "a\n");
			execSync("git add -A && git commit -q -m init", { cwd: second });
			execSync("git checkout -q -b orch/x && echo b > b.txt && git add -A && git commit -q -m w", {
				cwd: second,
			});
			execSync("git branch orch/x", { cwd: repo }); // primary: empty orch branch
			const agg = describeOrchBranchStateAcrossRepos("orch/x", "main", [repo, second]);
			expect(agg.kind).toBe("ahead");
			expect(agg.detail).toContain("1 commit(s) ahead");
			expect(describeOrchBranchStateAcrossRepos("orch/x", "main", [repo]).kind).toBe("empty");
		} finally {
			rmSync(second, { recursive: true, force: true });
		}
	});

	it("engine + resume completion alerts report outcomes and branch state separately; never 'Merged' unconditionally", () => {
		for (const f of ["engine.ts", "resume.ts"]) {
			const src = readSrc(f);
			const flat = src.replace(/\s+/g, " ");
			expect(/Merged to orch branch: \$\{batchState\.orchBranch\}/.test(src)).toBe(false);
			// Workspace-aware: aggregated across every repo root the batch touched.
			expect(flat).toContain(
				"const branchState = describeOrchBranchStateAcrossRepos( batchState.orchBranch, batchState.baseBranch, encounteredRepoRoots.keys(), );",
			);
			expect(flat).toContain('hasSuccess && branchState.kind === "ahead" ? `Ready for integration.');
			expect(/Nothing to integrate: \$\{branchState\.detail\}\./.test(flat)).toBe(true);
			expect(flat).toContain("Could not verify the orch branch");
		}
	});
});
