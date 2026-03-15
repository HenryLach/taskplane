import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
	serializeBatchState,
	freshOrchBatchState,
	computeResumePoint,
	selectAbortTargetSessions,
	hasTaskDoneMarker,
} from "../task-orchestrator.ts";

// Detect vitest: if present, wrap everything in a describe/it block
const isVitest = typeof globalThis.vi !== "undefined" || !!process.env.VITEST;

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
	if (!condition) {
		failed++;
		console.error(`✗ ${message}`);
		return;
	}
	passed++;
}

function runAllTests(): void {
	console.log("\n── direct implementation checks (TS-009 remediation) ──");

	// 1) serializeBatchState keeps full task registry from wave plan, even without outcomes.
	{
		const state = freshOrchBatchState();
		state.phase = "executing";
		state.batchId = "20260309T120000";
		state.startedAt = Date.now();
		state.currentWaveIndex = 0;
		state.totalWaves = 2;
		state.totalTasks = 3;

		const json = serializeBatchState(
			state,
			[["TS-100", "TS-101"], ["TS-102"]],
			[],
			[],
		);
		const parsed = JSON.parse(json);
		assert(parsed.tasks.length === 3, "serializeBatchState writes all 3 planned tasks into registry");
		assert(parsed.tasks.every((t: any) => t.status === "pending"), "tasks default to pending without outcomes");
	}

	// 2) computeResumePoint should NOT re-queue mark-failed tasks as pending.
	{
		const persistedState: any = {
			wavePlan: [["TS-200", "TS-201"]],
		};
		const reconciledTasks: any[] = [
			{ taskId: "TS-200", action: "mark-failed", liveStatus: "failed", persistedStatus: "running" },
			{ taskId: "TS-201", action: "mark-complete", liveStatus: "succeeded", persistedStatus: "running" },
		];
		const resumePoint = computeResumePoint(persistedState, reconciledTasks);
		assert(!resumePoint.pendingTaskIds.includes("TS-200"), "mark-failed task is not re-queued as pending");
		assert(resumePoint.failedTaskIds.includes("TS-200"), "mark-failed task remains in failed bucket");
	}

	// 3) selectAbortTargetSessions honors exact prefix (including hyphenated prefixes).
	{
		const sessions = [
			"orch-prod-lane-1",
			"orch-prod-merge-1",
			"orch-lane-1",
			"orch-prod-metrics",
		];
		const targets = selectAbortTargetSessions(sessions, null, [], "C:/repo", "orch-prod");
		const names = targets.map(t => t.sessionName).sort();
		assert(names.length === 2, "hyphenated prefix filters to 2 abort targets");
		assert(names[0] === "orch-prod-lane-1" && names[1] === "orch-prod-merge-1", "only lane/merge sessions for exact prefix are selected");
	}

	// 4) hasTaskDoneMarker checks archived path fallback.
	{
		const base = mkdtempSync(join(tmpdir(), "orch-done-"));
		try {
			const taskFolder = join(base, "tasks", "TS-300");
			const archiveTaskFolder = join(base, "tasks", "archive", "TS-300");
			mkdirSync(taskFolder, { recursive: true });
			mkdirSync(archiveTaskFolder, { recursive: true });
			writeFileSync(join(archiveTaskFolder, ".DONE"), "done\n", "utf-8");

			assert(hasTaskDoneMarker(taskFolder), "archived .DONE marker is detected from original task folder path");
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	}

	console.log(`\nResults: ${passed} passed, ${failed} failed`);
	if (failed > 0) throw new Error(`${failed} test(s) failed`);
} // end runAllTests

// ── Dual-mode execution ──────────────────────────────────────────────
// Under vitest: register as a proper test suite
// Standalone (npx tsx): run directly with process.exit
if (isVitest) {
	const { describe, it } = await import("vitest");
	describe("Orchestrator Direct Implementation", () => {
		it("passes all assertions", () => {
			runAllTests();
		});
	});
} else {
	try {
		runAllTests();
		process.exit(0);
	} catch (e) {
		console.error("Test run failed:", e);
		process.exit(1);
	}
}
