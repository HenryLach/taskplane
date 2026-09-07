/**
 * #629 — orch_retry_task resets the task record but not the v2 segment record,
 * so orch_resume skips the wave.
 *
 * Covers:
 *   - segment-recovery writers (pure): retry reset, skip marking
 *   - the round-trip the issue asks for: task failed at the finalize gate →
 *     retry → resume point re-executes the wave (frontier pending, not done)
 *   - side-effect 3: dependency-scope for computeTransitiveDependents
 *   - side-effect 2: diagnostic report evidence preservation across passes
 *   - side-effect 1 + remediation spawn: wiring assertions
 */

import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { expect } from "./expect.ts";
import {
	hasExecutionEvidence,
	mergeDiagnosticEvents,
	parseEventsJsonl,
	buildMarkdownReport,
	type DiagnosticEvent,
} from "../taskplane/diagnostic-reports.ts";
import { EXIT_CLASSIFICATIONS } from "../taskplane/diagnostics.ts";
import { batchTaskScope, computeTransitiveDependents } from "../taskplane/execution.ts";
import { computeResumePoint, reconstructSegmentFrontier } from "../taskplane/resume.ts";
import {
	applyReExecutionOutcomeToSegments,
	markTaskSegmentsSkipped,
	resetTaskSegmentsForRetry,
	segmentsForTask,
	taskSegmentsAllSucceeded,
} from "../taskplane/segment-recovery.ts";
import { hasOutstandingNonApproveReview } from "../taskplane/agent-bridge-extension.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { defaultBatchDiagnostics, defaultResilienceState } from "../taskplane/types.ts";
import type {
	DependencyGraph,
	PersistedBatchState,
	PersistedSegmentRecord,
	ReconciledTaskState,
} from "../taskplane/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
function readSrc(file: string): string {
	return readFileSync(join(HERE, "..", "taskplane", file), "utf-8");
}

// ── Fixtures (mirrors the incident: single wave, single task TP-2048) ──

function makeSegment(overrides: Partial<PersistedSegmentRecord> = {}): PersistedSegmentRecord {
	return {
		segmentId: "TP-2048::default",
		taskId: "TP-2048",
		repoId: "default",
		status: "failed",
		laneId: "lane-1",
		sessionName: "orch-lane-1",
		worktreePath: "/tmp/wt-1",
		branch: "task/lane-1",
		startedAt: 1788647000000,
		endedAt: 1788647834198,
		retries: 0,
		exitReason: "Review gate: cannot finalize — latest review verdict is not APPROVE",
		dependsOnSegmentIds: [],
		exitDiagnostic: {
			classification: "review_gate_refusal",
			exitCode: 0,
			errorMessage: "finalize refused",
			tokensUsed: null,
			contextPct: null,
			partialProgressCommits: 0,
			partialProgressBranch: null,
			durationSec: 800,
			lastKnownStep: null,
			lastKnownCheckbox: null,
			repoId: "default",
		},
		...overrides,
	};
}

function makeIncidentState(overrides: Partial<PersistedBatchState> = {}): PersistedBatchState {
	return {
		schemaVersion: 4,
		phase: "paused",
		batchId: "henrylach-20260905T165645",
		baseBranch: "main",
		orchBranch: "orch/test",
		mode: "repo",
		startedAt: 1788640000000,
		updatedAt: 1788647837242,
		endedAt: 1788647837242,
		currentWaveIndex: 0,
		totalWaves: 1,
		wavePlan: [["TP-2048"]],
		lanes: [
			{
				laneNumber: 1,
				laneId: "lane-1",
				laneSessionId: "orch-lane-1",
				worktreePath: "/tmp/wt-1",
				branch: "task/lane-1",
				taskIds: ["TP-2048"],
			},
		],
		tasks: [
			{
				taskId: "TP-2048",
				laneNumber: 1,
				sessionName: "orch-lane-1",
				// What doOrchRetryTask leaves on the TASK record:
				status: "pending",
				taskFolder: "/tmp/tasks/TP-2048",
				startedAt: null,
				endedAt: null,
				doneFileFound: false,
				exitReason: "",
				segmentIds: ["TP-2048::default"],
				activeSegmentId: null,
			},
		],
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
		segments: [makeSegment()],
		holds: [],
		...overrides,
	};
}

function pendingReconciled(taskId: string): ReconciledTaskState {
	return {
		taskId,
		persistedStatus: "pending",
		liveStatus: "pending",
		sessionAlive: false,
		doneFileFound: false,
		worktreeExists: true,
		action: "pending",
	} as ReconciledTaskState;
}

// ── 1. The defect, reproduced, then fixed ─────────────────────────────

describe("#629 — segment record must follow the task record on retry", () => {
	it("REPRODUCES the incident: task pending + segment failed → wave counted done, frontier has no pending segment", () => {
		const state = makeIncidentState();
		const frontier = reconstructSegmentFrontier(state);
		const f = frontier.get("TP-2048")!;
		expect(f.pendingSegmentIds.length).toBe(0);
		expect(f.failedSegmentIds).toEqual(["TP-2048::default"]);
		// The frontier normalizes the task back to failed (segment authority)…
		expect(state.tasks[0].status).toBe("failed");
		// …and computeResumePoint puts the resume index past the end → no-op resume.
		const rp = computeResumePoint(state, [pendingReconciled("TP-2048")]);
		expect(rp.resumeWaveIndex).toBe(1);
	});

	it("resetTaskSegmentsForRetry: failed segment → pending, exit data cleared, worktree identity kept, retries+1", () => {
		const state = makeIncidentState();
		const summary = resetTaskSegmentsForRetry(state, "TP-2048");
		expect(summary.resetSegmentIds).toEqual(["TP-2048::default"]);
		expect(summary.preservedSegmentIds).toEqual([]);
		const seg = segmentsForTask(state, "TP-2048")[0];
		expect(seg.status).toBe("pending");
		expect(seg.startedAt).toBe(null);
		expect(seg.endedAt).toBe(null);
		expect(seg.exitDiagnostic).toBe(undefined);
		expect(seg.exitReason).toBe("");
		expect(seg.retries).toBe(1);
		// Preserved so resume's re-execute path reuses the worktree (work survives).
		expect(seg.laneId).toBe("lane-1");
		expect(seg.worktreePath).toBe("/tmp/wt-1");
		expect(seg.branch).toBe("task/lane-1");
		expect(state.tasks[0].activeSegmentId).toBe(null);
	});

	it("ROUND-TRIP (the issue's requested test): retry → frontier pending → resume point re-executes wave 0", () => {
		const state = makeIncidentState();
		resetTaskSegmentsForRetry(state, "TP-2048");

		const frontier = reconstructSegmentFrontier(state);
		const f = frontier.get("TP-2048")!;
		expect(f.pendingSegmentIds).toEqual(["TP-2048::default"]);
		expect(f.failedSegmentIds.length).toBe(0);
		expect(state.tasks[0].status).toBe("pending");
		expect(state.tasks[0].activeSegmentId).toBe("TP-2048::default");

		const rp = computeResumePoint(state, [pendingReconciled("TP-2048")]);
		expect(rp.resumeWaveIndex).toBe(0); // NOT past the end — the lane re-executes
		expect(rp.failedTaskIds).toEqual([]); // no longer a skip-dependents source
	});

	it("PRODUCTION PATH: reset task with existing worktree reconciles as re-execute → wave 0 re-runs → outcome transitions the segment → second frontier reads succeeded", () => {
		const state = makeIncidentState();
		resetTaskSegmentsForRetry(state, "TP-2048");
		reconstructSegmentFrontier(state);

		// reconcileTaskStates returns `re-execute` (not `pending`) for a task whose
		// worktree still exists with no live session and no .DONE (resume.ts ~L697).
		const reExec: ReconciledTaskState = {
			...pendingReconciled("TP-2048"),
			persistedStatus: "pending",
			liveStatus: "pending",
			action: "re-execute",
		};
		const rp = computeResumePoint(state, [reExec]);
		expect(rp.resumeWaveIndex).toBe(0);
		expect(rp.reExecuteTaskIds).toEqual(["TP-2048"]);
		expect(rp.failedTaskIds).toEqual([]);

		// The re-execute path (resume.ts) now applies the REAL outcome to segments.
		const touched = applyReExecutionOutcomeToSegments(state.segments, "TP-2048", "succeeded", {
			startTime: 1788648000000,
			endTime: 1788648600000,
			exitReason: "Task complete",
		});
		expect(touched).toEqual(["TP-2048::default"]);
		const seg = segmentsForTask(state, "TP-2048")[0];
		expect(seg.status).toBe("succeeded");
		expect(seg.startedAt).toBe(1788648000000);
		expect(seg.endedAt).toBe(1788648600000);
		expect(seg.exitDiagnostic).toBe(undefined);

		// Serialize → reload → frontier: the task is succeeded, NOT normalized back to pending.
		const reloaded = JSON.parse(JSON.stringify(state)) as PersistedBatchState;
		reloaded.tasks[0].status = "succeeded"; // what resume persists for the task record
		const frontier = reconstructSegmentFrontier(reloaded);
		expect(frontier.get("TP-2048")!.allSucceeded).toBe(true);
		expect(reloaded.tasks[0].status).toBe("succeeded");
		const rp2 = computeResumePoint(reloaded, [
			{
				...pendingReconciled("TP-2048"),
				persistedStatus: "succeeded",
				liveStatus: "succeeded",
				action: "skip",
			},
		]);
		expect(rp2.completedTaskIds).toEqual(["TP-2048"]);
	});

	it("applyReExecutionOutcomeToSegments: failed outcome carries the diagnostic; terminal segments untouched", () => {
		const state = makeIncidentState({
			segments: [
				makeSegment({ segmentId: "TP-2048::api", status: "succeeded", exitDiagnostic: undefined }),
				makeSegment({
					segmentId: "TP-2048::web",
					status: "pending",
					startedAt: null,
					endedAt: null,
					exitDiagnostic: undefined,
				}),
			],
		});
		const diag = makeSegment().exitDiagnostic;
		const touched = applyReExecutionOutcomeToSegments(
			state.segments,
			"TP-2048",
			"failed",
			{ exitReason: "boom", exitDiagnostic: diag },
			null,
			1788649000000,
		);
		expect(touched).toEqual(["TP-2048::web"]);
		const [api, web] = segmentsForTask(state, "TP-2048");
		expect(api.status).toBe("succeeded");
		expect(web.status).toBe("failed");
		expect(web.startedAt).toBe(1788649000000);
		expect(web.exitReason).toBe("boom");
		expect(web.exitDiagnostic?.classification).toBe("review_gate_refusal");
	});

	it("SAGE P1: re-execution of a NON-final segment marks only that segment; downstream stays pending; task not complete", () => {
		const state = makeIncidentState({
			tasks: [
				{
					...makeIncidentState().tasks[0],
					segmentIds: ["TP-2048::api", "TP-2048::web"],
					activeSegmentId: "TP-2048::api",
				},
			],
			segments: [
				makeSegment({
					segmentId: "TP-2048::api",
					repoId: "api",
					status: "pending",
					exitDiagnostic: undefined,
				}),
				makeSegment({
					segmentId: "TP-2048::web",
					repoId: "web",
					status: "pending",
					dependsOnSegmentIds: ["TP-2048::api"],
					exitDiagnostic: undefined,
				}),
			],
		});
		const touched = applyReExecutionOutcomeToSegments(
			state.segments,
			"TP-2048",
			"succeeded",
			{ exitReason: "segment done" },
			"TP-2048::api",
		);
		expect(touched).toEqual(["TP-2048::api"]);
		const [api, web] = segmentsForTask(state, "TP-2048");
		expect(api.status).toBe("succeeded");
		expect(web.status).toBe("pending"); // downstream work NOT silently skipped
		expect(taskSegmentsAllSucceeded(state.segments, "TP-2048")).toBe(false);
		const f = reconstructSegmentFrontier(state).get("TP-2048")!;
		expect(f.allSucceeded).toBe(false);
		expect(f.nextSegmentId).toBe("TP-2048::web");
		expect(state.tasks[0].status).toBe("pending");
		// Final segment later → task complete.
		applyReExecutionOutcomeToSegments(state.segments, "TP-2048", "succeeded", {}, "TP-2048::web");
		expect(taskSegmentsAllSucceeded(state.segments, "TP-2048")).toBe(true);
		// No segment records → null (caller decides from the outcome).
		expect(taskSegmentsAllSucceeded([], "TP-2048")).toBe(null);
	});

	it("SAGE P2: resume treats a paused re-execution (`skipped`) as still pending — never failed/skipped", () => {
		const flat = readSrc("resume.ts").replace(/\s+/g, " ");
		// A pause now surfaces as "pending" (legacy "skipped"-with-paused-reason still tolerated).
		expect(flat).toContain(
			'pollResult.status === "pending" || (pollResult.status === "skipped" && /paused/i.test(pollResult.exitReason))',
		);
		// The real outcome is only adopted for terminal succeeded/failed results.
		expect(flat).toContain(
			'realOutcome && (realOutcome.status === "succeeded" || realOutcome.status === "failed")',
		);
		// Non-final segment success does not complete the task.
		expect(flat).toContain('pollResult.status === "succeeded" && frontierComplete === false');
		// Partial-progress recovery metadata is preserved from persisted state.
		expect(flat).toContain(
			"realOutcome.partialProgressCommits ?? persistedTask?.partialProgressCommits",
		);
	});

	it("resume.ts wires the writer into BOTH re-execute outcomes (normal + error) and uses the real outcome", () => {
		const src = readSrc("resume.ts");
		expect(src.split("applyReExecutionOutcomeToSegments(").length - 1).toBe(2);
		expect(src).toContain("reExecuteOutcome.set(task.taskId, taskResult)");
		expect(src.replace(/\s+/g, " ")).toContain("allTaskOutcomes.push({ ...realOutcome");
	});

	it("multi-segment task: only the failed segment is reset; succeeded predecessors are preserved", () => {
		const state = makeIncidentState({
			tasks: [
				{
					...makeIncidentState().tasks[0],
					segmentIds: ["TP-2048::api", "TP-2048::web"],
				},
			],
			segments: [
				makeSegment({
					segmentId: "TP-2048::api",
					repoId: "api",
					status: "succeeded",
					exitDiagnostic: undefined,
					exitReason: "",
				}),
				makeSegment({
					segmentId: "TP-2048::web",
					repoId: "web",
					status: "failed",
					dependsOnSegmentIds: ["TP-2048::api"],
				}),
			],
		});
		const summary = resetTaskSegmentsForRetry(state, "TP-2048");
		expect(summary.resetSegmentIds).toEqual(["TP-2048::web"]);
		expect(summary.preservedSegmentIds).toEqual(["TP-2048::api"]);
		const f = reconstructSegmentFrontier(state).get("TP-2048")!;
		expect(f.completedSegmentIds).toEqual(["TP-2048::api"]);
		expect(f.pendingSegmentIds).toEqual(["TP-2048::web"]);
		expect(f.nextSegmentId).toBe("TP-2048::web");
	});

	it("a segment left `running` by a dead engine is also reset (defensive)", () => {
		const state = makeIncidentState({
			segments: [makeSegment({ status: "running", endedAt: null })],
		});
		const summary = resetTaskSegmentsForRetry(state, "TP-2048");
		expect(summary.resetSegmentIds).toEqual(["TP-2048::default"]);
	});

	it("does not touch segments of other tasks", () => {
		const state = makeIncidentState({
			segments: [makeSegment(), makeSegment({ segmentId: "TP-2047::default", taskId: "TP-2047" })],
		});
		resetTaskSegmentsForRetry(state, "TP-2048");
		expect(segmentsForTask(state, "TP-2047")[0].status).toBe("failed");
	});

	it("markTaskSegmentsSkipped: non-succeeded segments → skipped (succeeded preserved), frontier agrees", () => {
		const state = makeIncidentState({
			tasks: [
				{
					...makeIncidentState().tasks[0],
					status: "skipped",
					segmentIds: ["TP-2048::api", "TP-2048::web"],
				},
			],
			segments: [
				makeSegment({ segmentId: "TP-2048::api", status: "succeeded", exitDiagnostic: undefined }),
				makeSegment({ segmentId: "TP-2048::web", status: "failed" }),
			],
		});
		const skipped = markTaskSegmentsSkipped(state, "TP-2048", 1788648000000);
		expect(skipped).toEqual(["TP-2048::web"]);
		const segs = segmentsForTask(state, "TP-2048");
		expect(segs[0].status).toBe("succeeded");
		expect(segs[1].status).toBe("skipped");
		expect(segs[1].endedAt).toBe(1788647834198); // existing endedAt kept
		reconstructSegmentFrontier(state);
		expect(state.tasks[0].status).toBe("skipped");
	});

	it("extension.ts wires both writers into orch_retry_task / orch_skip_task", () => {
		const flat = readSrc("extension.ts").replace(/\s+/g, " ");
		expect(flat).toContain("resetTaskSegmentsForRetry(state, taskId)");
		expect(flat).toContain("markTaskSegmentsSkipped(state, taskId, taskRecord.endedAt)");
	});
});

// ── 2. Side-effect 3: repo-wide dependency graph leaks out-of-batch IDs ──

describe("#629 side-effect 3 — computeTransitiveDependents batch scope", () => {
	function graph(edges: Array<[string, string]>): DependencyGraph {
		// edges: [dependency, dependent]
		const dependents = new Map<string, string[]>();
		const dependencies = new Map<string, string[]>();
		for (const [dep, dependent] of edges) {
			dependents.set(dep, [...(dependents.get(dep) ?? []), dependent]);
			dependencies.set(dependent, [...(dependencies.get(dependent) ?? []), dep]);
		}
		return { dependents, dependencies } as unknown as DependencyGraph;
	}

	it("incident: single-task batch must not report the out-of-batch dependent TP-2047", () => {
		const g = graph([["TP-2048", "TP-2047"]]);
		const unscoped = computeTransitiveDependents(new Set(["TP-2048"]), g);
		expect([...unscoped]).toEqual(["TP-2047"]); // legacy behaviour (still available)
		const scoped = computeTransitiveDependents(
			new Set(["TP-2048"]),
			g,
			batchTaskScope([["TP-2048"]]),
		);
		expect([...scoped]).toEqual([]);
	});

	it("traverses THROUGH out-of-scope nodes but reports only in-scope IDs", () => {
		// A(failed) → B(out of batch) → C(in batch)
		const g = graph([
			["A", "B"],
			["B", "C"],
		]);
		const scoped = computeTransitiveDependents(new Set(["A"]), g, batchTaskScope([["A"], ["C"]]));
		expect([...scoped]).toEqual(["C"]);
	});

	it("visited set is distinct from the result set (no infinite loop through out-of-scope cycles)", () => {
		const g = graph([
			["A", "X"],
			["X", "Y"],
			["Y", "X"],
			["Y", "C"],
		]);
		const scoped = computeTransitiveDependents(new Set(["A"]), g, new Set(["A", "C"]));
		expect([...scoped]).toEqual(["C"]);
	});

	it("all merge/recompute sites pass a batch scope", () => {
		for (const f of ["engine.ts", "resume.ts", "extension.ts"]) {
			const src = readSrc(f);
			expect(src).toContain("batchTaskScope(");
		}
		// Engine + resume merge points filter by scope.
		expect(readSrc("engine.ts")).toContain(
			"if (scope.has(blocked)) batchState.blockedTaskIds.add(blocked);",
		);
		expect(readSrc("resume.ts")).toContain(
			"if (scope.has(blocked)) batchState.blockedTaskIds.add(blocked);",
		);
	});
});

// ── 3. Side-effect 2: no-op resume pass clobbered the diagnostic report ──

describe("#629 side-effect 2 — diagnostic report evidence preservation", () => {
	const rich: DiagnosticEvent = {
		batchId: "b",
		phase: "paused",
		mode: "repo",
		taskId: "TP-2048",
		status: "failed",
		classification: "review_gate_refusal",
		cost: 55.64,
		durationSec: 6120,
		retries: 0,
		repoId: null,
		exitReason: "Review gate: cannot finalize",
		startedAt: 1788640000000,
		endedAt: 1788647834198,
	};
	const empty: DiagnosticEvent = {
		...rich,
		status: "pending",
		classification: "unknown",
		cost: 0,
		durationSec: 0,
		retries: 0,
		exitReason: "",
		startedAt: null,
		endedAt: null,
	};

	it("hasExecutionEvidence distinguishes an executed record from a no-op placeholder", () => {
		expect(hasExecutionEvidence(rich)).toBe(true);
		expect(hasExecutionEvidence(empty)).toBe(false);
		expect(hasExecutionEvidence({ ...empty, cost: 0.01 })).toBe(true);
		expect(hasExecutionEvidence({ ...empty, startedAt: 1 })).toBe(true);
	});

	it("no-op pass keeps prior evidence but takes CURRENT state (status/phase) from the new pass", () => {
		const merged = mergeDiagnosticEvents([rich], [{ ...empty, phase: "paused", status: "pending" }]);
		expect(merged.length).toBe(1);
		expect(merged[0].status).toBe("pending"); // current state wins (retry happened)
		expect(merged[0].cost).toBe(55.64); // evidence preserved
		expect(merged[0].durationSec).toBe(6120);
		expect(merged[0].classification).toBe("review_gate_refusal");
		expect(merged[0].startedAt).toBe(1788640000000);
	});

	it("reconciliation placeholder (classification + fresh endedAt, but $0) cannot erase prior cost (Sage repro)", () => {
		const placeholder = {
			...rich,
			cost: 0,
			durationSec: 0,
			endedAt: 1788650000000,
			status: "failed",
		};
		const merged = mergeDiagnosticEvents([rich], [placeholder]);
		expect(merged[0].cost).toBe(55.64);
		expect(merged[0].durationSec).toBe(6120);
		expect(merged[0].endedAt).toBe(1788650000000); // new pass value present → taken
	});

	it("a pass WITH evidence overrides the prior record entirely", () => {
		const fresh = {
			...rich,
			cost: 3,
			durationSec: 60,
			status: "succeeded",
			classification: "completed",
		};
		const merged = mergeDiagnosticEvents([rich], [fresh]);
		expect(merged[0]).toEqual(fresh);
	});

	it("tasks absent from the new plan are dropped; prior-empty records do not resurrect", () => {
		const merged = mergeDiagnosticEvents([rich, { ...empty, taskId: "GONE" }], [empty]);
		expect(merged.map((e) => e.taskId)).toEqual(["TP-2048"]);
		expect(mergeDiagnosticEvents([empty], [empty])[0]).toEqual(empty);
	});

	it("parseEventsJsonl is tolerant of malformed lines", () => {
		const parsed = parseEventsJsonl(`${JSON.stringify(rich)}\nnot json\n\n{"noTaskId":1}\n`);
		expect(parsed.length).toBe(1);
		expect(parsed[0].taskId).toBe("TP-2048");
	});

	it("markdown header cost falls back to the sum of per-task evidence (no more $0.00 for a $55 run)", () => {
		const report = buildMarkdownReport(
			{
				orchConfig: {} as never,
				batchId: "b",
				phase: "paused",
				mode: "repo",
				startedAt: 1788640000000,
				endedAt: 1788647837242,
				tasks: [],
				diagnostics: defaultBatchDiagnostics(),
				succeededTasks: 0,
				failedTasks: 1,
				skippedTasks: 0,
				blockedTasks: 0,
				totalTasks: 1,
				stateRoot: "/tmp",
			},
			[rich],
		);
		expect(report).toContain("$55.64");
	});

	it("emitDiagnosticReports merges with the existing JSONL before writing; assembleDiagnosticInput carries telemetry cost", () => {
		const src = readSrc("diagnostic-reports.ts");
		expect(src).toContain("events = mergeDiagnosticEvents(previous, events);");
		expect(src).toContain("taskCostUsd");
		expect(src).toContain("outcome.telemetry?.costUsd");
	});
});

// ── 4. Side-effect 1 + remediation spawn ─────────────────────────────

describe("#629 side-effect 1 — finalize refusal is a governance outcome, not a crash", () => {
	it("review_gate_refusal is a registered exit classification", () => {
		expect(EXIT_CLASSIFICATIONS.includes("review_gate_refusal")).toBe(true);
	});

	it("the finalize gate attaches a review_gate_refusal diagnostic (exitCode 0) to the failed outcome", () => {
		const flat = readSrc("lane-runner.ts").replace(/\s+/g, " ");
		expect(flat).toContain('classification: "review_gate_refusal"');
		expect(flat).toContain("refusal.outcome.exitDiagnostic = refusalDiagnostic;");
	});

	it("tier-0 auto-retry explicitly never retries a review_gate_refusal", () => {
		const flat = readSrc("engine.ts").replace(/\s+/g, " ");
		expect(flat).toContain('if (classification === "review_gate_refusal")');
		expect(flat).toContain("NOT auto-retrying (#629)");
	});
});

describe("#629 — review_step TP-186 complete-step guard exemption for remediation re-reviews", () => {
	it("hasOutstandingNonApproveReview: true only when the LATEST file for that gate is REVISE/RETHINK", () => {
		const dir = mkdtempSync(join(tmpdir(), "tp629-guard-"));
		try {
			expect(hasOutstandingNonApproveReview(dir, "code", 1)).toBe(false); // no files
			writeFileSync(join(dir, "R001-code-step1.md"), "## Verdict: REVISE\n");
			expect(hasOutstandingNonApproveReview(dir, "code", 1)).toBe(true);
			expect(hasOutstandingNonApproveReview(dir, "test", 1)).toBe(false); // other type
			expect(hasOutstandingNonApproveReview(dir, "code", 2)).toBe(false); // other step
			writeFileSync(join(dir, "R002-code-step1.md"), "## Verdict: APPROVE\n");
			expect(hasOutstandingNonApproveReview(dir, "code", 1)).toBe(false); // latest is APPROVE
			expect(hasOutstandingNonApproveReview(join(dir, "nope"), "code", 1)).toBe(false); // fail-closed
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("the guard is conjoined with the exemption; plan reviews unaffected", () => {
		const flat = readSrc("agent-bridge-extension.ts").replace(/\s+/g, " ");
		expect(flat).toContain(
			'reviewType !== "plan" && isStepMarkedComplete(statusPath, stepNum) && !hasOutstandingNonApproveReview(reviewsDir, reviewType, stepNum)',
		);
	});
});

describe("#629 — review-gate remediation spawn (the retry+resume remedy must be reachable)", () => {
	it("all-checkboxes-complete no longer breaks before spawning when a gate is outstanding", () => {
		const src = readSrc("lane-runner.ts");
		const flat = src.replace(/\s+/g, " ");
		// The bare `break` on no remaining steps is gone; the gate scan precedes it.
		expect(src).not.toContain("if (remainingSteps.length === 0) break; // All done");
		expect(flat).toContain(
			"if (remainingSteps.length === 0) { const isFinalizingIteration = !isNonFinalSegment;",
		);
		expect(flat).toContain("findBlockingReviewGates(unit.packet.reviewsDir)");
		expect(flat).toContain("if (blocking.length === 0) break; // All done");
		// Bounded.
		expect(flat).toContain("remediationIterations >= MAX_REVIEW_REMEDIATION_ITERATIONS");
		expect(src).toContain("const MAX_REVIEW_REMEDIATION_ITERATIONS = 2;");
	});

	it("remediation prompt tells the worker to address findings + re-run review_step, never self-approve or write .DONE", () => {
		const flat = readSrc("lane-runner.ts").replace(/\s+/g, " ");
		expect(flat).toContain("REVIEW GATE OUTSTANDING");
		expect(flat).toContain("call review_step for that step again");
		expect(flat).toContain("Do NOT write .DONE");
		expect(flat).toContain("Do NOT un-check or re-check");
	});

	it("remediation iterations do not count toward the no-progress stall limit", () => {
		const flat = readSrc("lane-runner.ts").replace(/\s+/g, " ");
		expect(flat).toContain("} else if (remediationGates.length > 0) {");
		expect(flat).toContain("not counted toward stall");
	});

	it("the finalize gate and the pre-spawn check share one scanner (no drift)", () => {
		const src = readSrc("lane-runner.ts");
		const occurrences = src.split("findBlockingReviewGates(").length - 1;
		expect(occurrences).toBe(5); // definition + finalize + pre-spawn + post-iteration re-check + step-completion gate
	});
});
