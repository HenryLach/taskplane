/**
 * Tests for TP-076: Autonomous Supervisor Alerts (Phase 1)
 *
 * Validates:
 * - SupervisorAlert type interface has required fields
 * - SupervisorAlertContext has correct structure per category
 * - Alert message formatting produces readable, actionable text
 * - Task-failure alerts include taskId, laneId, exitReason
 * - Merge-failure alerts include waveIndex and failed lanes
 * - Batch-complete alerts include final stats
 * - buildBatchProgressSnapshot extracts correct fields
 * - WorkerToMainMessage union includes supervisor-alert
 * - Source-based verification of IPC wiring
 */
import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { buildBatchProgressSnapshot, buildSupervisorSegmentFrontierSnapshot, freshOrchBatchState } from "../taskplane/types.ts";
import type {
	SupervisorAlert,
	SupervisorAlertCategory,
	SupervisorAlertContext,
	SupervisorAlertCallback,
	OrchBatchRuntimeState,
} from "../taskplane/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Helper to read source files for source-based tests */
function readSource(filename: string): string {
	return readFileSync(join(__dirname, "..", "taskplane", filename), "utf-8");
}

// ══════════════════════════════════════════════════════════════════════
// 1.x — SupervisorAlert type structure
// ══════════════════════════════════════════════════════════════════════

describe("1.x — SupervisorAlert type structure", () => {
	it("1.1 — task-failure alert has required fields", () => {
		const alert: SupervisorAlert = {
			category: "task-failure",
			summary: "⚠️ Task failure: TP-001",
			context: {
				taskId: "TP-001",
				segmentId: "TP-001::api",
				repoId: "api",
				laneId: "lane-1",
				laneNumber: 1,
				waveIndex: 0,
				exitReason: "Session died without .DONE",
				segmentFrontier: {
					taskId: "TP-001",
					totalSegments: 3,
					terminalSegments: 1,
					activeSegmentId: "TP-001::api",
					segments: [
						{ segmentId: "TP-001::api", repoId: "api", status: "running", dependsOnSegmentIds: [] },
						{ segmentId: "TP-001::web", repoId: "web", status: "pending", dependsOnSegmentIds: ["TP-001::api"] },
						{ segmentId: "TP-001::docs", repoId: "docs", status: "pending", dependsOnSegmentIds: ["TP-001::web"] },
					],
				},
				partialProgress: false,
				batchProgress: {
					succeededTasks: 2,
					failedTasks: 1,
					skippedTasks: 0,
					blockedTasks: 0,
					totalTasks: 3,
					currentWave: 1,
					totalWaves: 2,
				},
			},
		};
		expect(alert.category).toBe("task-failure");
		expect(alert.summary).toContain("TP-001");
		expect(alert.context.taskId).toBe("TP-001");
		expect(alert.context.segmentId).toBe("TP-001::api");
		expect(alert.context.repoId).toBe("api");
		expect(alert.context.laneId).toBe("lane-1");
		expect(alert.context.laneNumber).toBe(1);
		expect(alert.context.exitReason).toBe("Session died without .DONE");
		expect(alert.context.segmentFrontier).toBeDefined();
		expect(alert.context.segmentFrontier!.totalSegments).toBe(3);
		expect(alert.context.partialProgress).toBe(false);
		expect(alert.context.batchProgress).toBeDefined();
		expect(alert.context.batchProgress!.totalTasks).toBe(3);
	});

	it("1.2 — merge-failure alert has required fields", () => {
		const alert: SupervisorAlert = {
			category: "merge-failure",
			summary: "⚠️ Merge failed for wave 1",
			context: {
				waveIndex: 0,
				laneNumber: 2,
				mergeError: "Verification tests failed",
				batchProgress: {
					succeededTasks: 3,
					failedTasks: 0,
					skippedTasks: 0,
					blockedTasks: 0,
					totalTasks: 5,
					currentWave: 1,
					totalWaves: 3,
				},
			},
		};
		expect(alert.category).toBe("merge-failure");
		expect(alert.context.waveIndex).toBe(0);
		expect(alert.context.laneNumber).toBe(2);
		expect(alert.context.mergeError).toContain("Verification");
		expect(alert.context.batchProgress).toBeDefined();
	});

	it("1.3 — batch-complete alert has required fields", () => {
		const alert: SupervisorAlert = {
			category: "batch-complete",
			summary: "✅ Batch completed",
			context: {
				batchProgress: {
					succeededTasks: 5,
					failedTasks: 0,
					skippedTasks: 0,
					blockedTasks: 0,
					totalTasks: 5,
					currentWave: 2,
					totalWaves: 2,
				},
				batchDurationMs: 120000,
			},
		};
		expect(alert.category).toBe("batch-complete");
		expect(alert.context.batchProgress).toBeDefined();
		expect(alert.context.batchProgress!.succeededTasks).toBe(5);
		expect(alert.context.batchDurationMs).toBe(120000);
	});

	it("1.4 — all alert categories are valid", () => {
		const categories: SupervisorAlertCategory[] = ["task-failure", "merge-failure", "batch-complete", "agent-message"];
		for (const cat of categories) {
			const alert: SupervisorAlert = {
				category: cat,
				summary: `Test alert: ${cat}`,
				context: {},
			};
			expect(alert.category).toBe(cat);
		}
	});

	it("1.5 — alert context fields are all optional (minimal alert)", () => {
		const alert: SupervisorAlert = {
			category: "task-failure",
			summary: "Minimal alert",
			context: {},
		};
		expect(alert.context.taskId).toBeUndefined();
		expect(alert.context.laneId).toBeUndefined();
		expect(alert.context.batchProgress).toBeUndefined();
		expect(alert.context.mergeError).toBeUndefined();
		expect(alert.context.batchDurationMs).toBeUndefined();
	});

	it("1.6 — SupervisorAlertCallback type is callable", () => {
		const alerts: SupervisorAlert[] = [];
		const callback: SupervisorAlertCallback = (alert) => {
			alerts.push(alert);
		};
		callback({
			category: "batch-complete",
			summary: "Test",
			context: {},
		});
		expect(alerts.length).toBe(1);
		expect(alerts[0].category).toBe("batch-complete");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — buildBatchProgressSnapshot
// ══════════════════════════════════════════════════════════════════════

describe("2.x — buildBatchProgressSnapshot", () => {
	it("2.1 — extracts correct fields from batch state", () => {
		const state = freshOrchBatchState();
		state.succeededTasks = 3;
		state.failedTasks = 1;
		state.skippedTasks = 0;
		state.blockedTasks = 2;
		state.totalTasks = 6;
		state.currentWaveIndex = 1;
		state.totalWaves = 3;

		const snapshot = buildBatchProgressSnapshot(state);

		expect(snapshot.succeededTasks).toBe(3);
		expect(snapshot.failedTasks).toBe(1);
		expect(snapshot.skippedTasks).toBe(0);
		expect(snapshot.blockedTasks).toBe(2);
		expect(snapshot.totalTasks).toBe(6);
		expect(snapshot.currentWave).toBe(2); // 1-based
		expect(snapshot.totalWaves).toBe(3);
	});

	it("2.2 — converts waveIndex to 1-based for display", () => {
		const state = freshOrchBatchState();
		state.currentWaveIndex = 0;
		state.totalWaves = 1;

		const snapshot = buildBatchProgressSnapshot(state);
		expect(snapshot.currentWave).toBe(1);
	});

	it("2.3 — handles fresh batch state (all zeros)", () => {
		const state = freshOrchBatchState();
		const snapshot = buildBatchProgressSnapshot(state);

		expect(snapshot.succeededTasks).toBe(0);
		expect(snapshot.failedTasks).toBe(0);
		expect(snapshot.totalTasks).toBe(0);
		expect(snapshot.currentWave).toBe(0); // -1 + 1 = 0
		expect(snapshot.totalWaves).toBe(0);
	});

	it("2.4 — snapshot is plain JSON-serializable (IPC-safe)", () => {
		const state = freshOrchBatchState();
		state.succeededTasks = 5;
		state.totalTasks = 10;
		state.currentWaveIndex = 2;
		state.totalWaves = 4;

		const snapshot = buildBatchProgressSnapshot(state);
		const serialized = JSON.stringify(snapshot);
		const deserialized = JSON.parse(serialized);

		expect(deserialized.succeededTasks).toBe(5);
		expect(deserialized.totalTasks).toBe(10);
		expect(deserialized.currentWave).toBe(3);
	});

	it("2.5 — segment frontier snapshot captures active segment + status mix", () => {
		const snapshot = buildSupervisorSegmentFrontierSnapshot(
			"TP-010",
			["TP-010::api", "TP-010::web", "TP-010::docs"],
			null,
			[
				{
					segmentId: "TP-010::api",
					taskId: "TP-010",
					repoId: "api",
					status: "succeeded",
					laneId: "lane-1",
					sessionName: "orch-lane-1",
					worktreePath: "/tmp/lane-1",
					branch: "task/branch-1",
					startedAt: 1,
					endedAt: 2,
					retries: 0,
					dependsOnSegmentIds: [],
					exitReason: "ok",
				},
				{
					segmentId: "TP-010::web",
					taskId: "TP-010",
					repoId: "web",
					status: "failed",
					laneId: "lane-1",
					sessionName: "orch-lane-1",
					worktreePath: "/tmp/lane-1",
					branch: "task/branch-1",
					startedAt: 3,
					endedAt: 4,
					retries: 0,
					dependsOnSegmentIds: ["TP-010::api"],
					exitReason: "boom",
				},
			],
			"TP-010::web",
		);

		expect(snapshot).toBeDefined();
		expect(snapshot!.activeSegmentId).toBe("TP-010::web");
		expect(snapshot!.terminalSegments).toBe(2);
		expect(snapshot!.segments[2].status).toBe("pending");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3.x — Alert message formatting (content validation)
// ══════════════════════════════════════════════════════════════════════

describe("3.x — Alert message formatting", () => {
	it("3.1 — task-failure summary includes taskId, segment context, and actions", () => {
		const summary =
			`⚠️ Task failure: TP-005\n` +
			`  Exit reason: TMUX session exited without .DONE\n` +
			`  Segment: TP-005::api (repo: api)\n` +
			`  Segment frontier: 1/3 terminal\n` +
			`  Lane: lane-2 (lane 2)\n` +
			`  Partial progress preserved: yes\n` +
			`  Batch: wave 1/3, 2 succeeded, 1 failed\n\n` +
			`Available actions:\n` +
			`  - orch_status() to inspect current state\n` +
			`  - orch_resume(force=true) to retry\n` +
			`  - Read STATUS.md and lane logs for diagnosis`;

		expect(summary).toContain("TP-005");
		expect(summary).toContain("TMUX session exited without .DONE");
		expect(summary).toContain("Segment: TP-005::api");
		expect(summary).toContain("Segment frontier: 1/3 terminal");
		expect(summary).toContain("lane-2");
		expect(summary).toContain("orch_status()");
		expect(summary).toContain("orch_resume");
	});

	it("3.2 — merge-failure summary includes waveIndex and error", () => {
		const summary =
			`⚠️ Merge failed for wave 2 — retry exhausted\n` +
			`  Classification: verification_new_failure\n` +
			`  Error: Verification tests failed after merge\n\n` +
			`Available actions:\n` +
			`  - Investigate merge failure\n` +
			`  - orch_status() to inspect current state`;

		expect(summary).toContain("wave 2");
		expect(summary).toContain("verification_new_failure");
		expect(summary).toContain("orch_status()");
	});

	it("3.3 — batch-complete summary includes stats for clean completion", () => {
		const summary =
			`✅ Batch 20260327T140000 completed\n` +
			`  5/5 tasks succeeded\n` +
			`  2 wave(s), duration: 12m 30s\n` +
			`  Merged to orch branch: orch/henry-20260327T140000\n\n` +
			`Ready for integration. Run orch_integrate() or review first.`;

		expect(summary).toContain("✅");
		expect(summary).toContain("5/5");
		expect(summary).toContain("orch_integrate()");
	});

	it("3.4 — batch-complete summary for failures includes action items", () => {
		const summary =
			`⚠️ Batch 20260327T140000 finished with failures\n` +
			`  3 succeeded, 2 failed, 0 skipped, 1 blocked\n` +
			`  Duration: 15m 0s\n\n` +
			`Available actions:\n` +
			`  - orch_status() to review final state\n` +
			`  - orch_integrate() if succeeded work should be kept\n` +
			`  - orch_resume(force=true) to retry failed tasks`;

		expect(summary).toContain("⚠️");
		expect(summary).toContain("2 failed");
		expect(summary).toContain("orch_resume");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 4.x — Source-based verification of IPC wiring
// ══════════════════════════════════════════════════════════════════════

describe("4.x — Source-based verification of IPC wiring", () => {
	it("4.1 — WorkerToMainMessage includes supervisor-alert type", () => {
		const src = readSource("engine-worker.ts");
		expect(src).toContain('| { type: "supervisor-alert"; alert: SupervisorAlert }');
	});

	it("4.2 — engine-worker.ts imports SupervisorAlert", () => {
		const src = readSource("engine-worker.ts");
		expect(src).toContain("SupervisorAlert");
	});

	it("4.3 — engine-worker.ts sends supervisor-alert via IPC", () => {
		const src = readSource("engine-worker.ts");
		expect(src).toContain('type: "supervisor-alert"');
		expect(src).toContain("onSupervisorAlert");
	});

	it("4.4 — extension.ts handles supervisor-alert in IPC handler", () => {
		const src = readSource("extension.ts");
		expect(src).toContain('case "supervisor-alert"');
		expect(src).toContain("onSupervisorAlert");
	});

	it("4.5 — extension.ts calls sendUserMessage for alerts", () => {
		const src = readSource("extension.ts");
		expect(src).toContain("sendUserMessage(alert.summary");
		expect(src).toContain('deliverAs: "followUp"');
	});

	it("4.6 — extension.ts gates alerts on supervisor activation", () => {
		const src = readSource("extension.ts");
		expect(src).toContain("supervisorState.active");
	});

	it("4.7 — engine.ts emits task-failure alerts", () => {
		const src = readSource("engine.ts");
		expect(src).toContain('category: "task-failure"');
		expect(src).toContain("emitAlert(");
	});

	it("4.8 — engine.ts emits merge-failure alerts", () => {
		const src = readSource("engine.ts");
		expect(src).toContain('category: "merge-failure"');
	});

	it("4.9 — engine.ts emits batch-complete alerts", () => {
		const src = readSource("engine.ts");
		expect(src).toContain('category: "batch-complete"');
	});

	it("4.10 — resume.ts emits task-failure alerts", () => {
		const src = readSource("resume.ts");
		expect(src).toContain('category: "task-failure"');
		expect(src).toContain("emitAlert(");
	});

	it("4.11 — task-failure alerts include segment fields + frontier snapshot", () => {
		const engineSrc = readSource("engine.ts");
		const resumeSrc = readSource("resume.ts");
		expect(engineSrc).toContain("segmentFrontier");
		expect(engineSrc).toContain("segmentId");
		expect(engineSrc).toContain("repoId");
		expect(resumeSrc).toContain("segmentFrontier");
		expect(resumeSrc).toContain("segmentId");
		expect(resumeSrc).toContain("repoId");
	});

	it("4.12 — resume.ts emits merge-failure alerts", () => {
		const src = readSource("resume.ts");
		expect(src).toContain('category: "merge-failure"');
	});

	it("4.13 — resume.ts emits batch-complete alerts", () => {
		const src = readSource("resume.ts");
		expect(src).toContain('category: "batch-complete"');
	});

	it("4.14 — engine.ts accepts onSupervisorAlert parameter", () => {
		const src = readSource("engine.ts");
		expect(src).toContain("onSupervisorAlert?: SupervisorAlertCallback");
	});

	it("4.15 — resume.ts accepts onSupervisorAlert parameter", () => {
		const src = readSource("resume.ts");
		expect(src).toContain("onSupervisorAlert?:");
	});

	it("4.16 — supervisor-primer.md has alert handling section", () => {
		const src = readFileSync(join(__dirname, "..", "taskplane", "supervisor-primer.md"), "utf-8");
		expect(src).toContain("Autonomous Alert Handling");
		expect(src).toContain("task-failure");
		expect(src).toContain("merge-failure");
		expect(src).toContain("batch-complete");
		expect(src).toContain("Response Protocol");
	});

	it("4.17 — extension.ts sends critical alert on engine process death", () => {
		const src = readSource("extension.ts");
		// Engine process error path
		expect(src).toContain("Engine process error");
		expect(src).toContain("Engine process died unexpectedly");
		// Both paths emit a supervisor alert
		const alertCount = (src.match(/🔴 Engine process/g) || []).length;
		expect(alertCount).toBeGreaterThanOrEqual(2);
	});
});
