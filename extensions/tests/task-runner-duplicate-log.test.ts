/**
 * TP-098 — Duplicate Execution Log Prevention Tests
 *
 * Verifies that the task-runner does not produce duplicate execution log
 * entries on restart/resume, and that iteration labels use the global
 * counter (state.totalIterations) instead of the loop-local counter.
 *
 * Tests:
 *   1.x — Source pattern verification: lifecycle logging guards
 *   2.x — Functional simulation: log entry deduplication logic
 *
 * Run: cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/task-runner-duplicate-log.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ── Source Loading ────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
	join(__dirname, "..", "task-runner.ts"),
	"utf-8"
);

// ══════════════════════════════════════════════════════════════════════
// 1.x — Source pattern verification: lifecycle logging guards
// ══════════════════════════════════════════════════════════════════════

describe("1.x: TP-098 lifecycle logging source patterns", () => {
	it("1.0: distinguishes first start from restart using totalIterations", () => {
		// executeTask should check totalIterations to decide which log entry to write
		expect(source).toContain("state.totalIterations === 0");
		expect(source).toContain('"Task started"');
		expect(source).toContain('"Task resumed"');
	});

	it("1.1: logs 'Task started' only on first start (totalIterations === 0)", () => {
		// The "Task started" logExecution call should be inside a totalIterations === 0 guard
		const startBlock = source.match(
			/if\s*\(\s*state\.totalIterations\s*===\s*0\s*\)\s*\{[^}]*Task started/s
		);
		expect(startBlock).not.toBe(null);
	});

	it("1.2: logs 'Task resumed' on restart (totalIterations > 0)", () => {
		// The else branch should log "Task resumed"
		const resumeBlock = source.match(
			/else\s*\{[^}]*Task resumed/s
		);
		expect(resumeBlock).not.toBe(null);
	});

	it("1.3: skips 'Step N started' log when step is already in-progress", () => {
		// The step-marking block should check ss?.status !== "in-progress"
		// before logging "Step N started"
		expect(source).toContain('ss?.status !== "in-progress"');
	});

	it("1.4: 'No progress' log uses state.totalIterations, not iter+1", () => {
		// The "No progress" logExecution should use state.totalIterations
		const noProgressLog = source.match(
			/logExecution\(statusPath,\s*"No progress",\s*`Iteration \$\{state\.totalIterations\}/
		);
		expect(noProgressLog).not.toBe(null);

		// Should NOT use iter + 1 for No progress
		const oldPattern = source.match(
			/logExecution\(statusPath,\s*"No progress",\s*`Iteration \$\{iter \+ 1\}/
		);
		expect(oldPattern).toBe(null);
	});

	it("1.5: 'Iteration summary' log uses state.totalIterations, not iter+1", () => {
		// The "Iteration N summary" logExecution should use state.totalIterations
		const summaryLog = source.match(
			/logExecution\(statusPath,\s*`Iteration \$\{state\.totalIterations\} summary`/
		);
		expect(summaryLog).not.toBe(null);

		// Should NOT use iter + 1 for summary
		const oldSummary = source.match(
			/logExecution\(statusPath,\s*`Iteration \$\{iter \+ 1\} summary`/
		);
		expect(oldSummary).toBe(null);
	});

	it("1.6: 'Paused' log uses state.totalIterations, not iter+1", () => {
		const pausedLog = source.match(
			/logExecution\(statusPath,\s*"Paused",\s*`User paused at iteration \$\{state\.totalIterations\}/
		);
		expect(pausedLog).not.toBe(null);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — Functional simulation: log entry deduplication logic
// ══════════════════════════════════════════════════════════════════════

describe("2.x: TP-098 execution log deduplication logic", () => {
	interface StepStatus {
		number: number;
		name: string;
		status: "not-started" | "in-progress" | "complete";
	}

	/**
	 * Simulates the lifecycle logging behavior in executeTask.
	 * Returns an array of log entries [action, outcome] that would be written.
	 */
	function simulateStartupLogs(
		totalIterations: number,
		steps: StepStatus[]
	): Array<[string, string]> {
		const logs: Array<[string, string]> = [];

		// Lifecycle log: first start vs restart (TP-098 fix)
		if (totalIterations === 0) {
			logs.push(["Task started", "Extension-driven execution"]);
		} else {
			logs.push(["Task resumed", `Resuming from iteration ${totalIterations}`]);
		}

		// Step initialization logging (TP-098 fix)
		let foundFirstIncomplete = false;
		for (const step of steps) {
			if (step.status === "complete") continue;

			if (!foundFirstIncomplete) {
				// Only log "Step N started" if step was NOT already in-progress
				if (step.status !== "in-progress") {
					logs.push([`Step ${step.number} started`, step.name]);
				}
				foundFirstIncomplete = true;
			}
		}

		return logs;
	}

	it("2.0: first start (totalIterations=0) produces exactly one 'Task started'", () => {
		const logs = simulateStartupLogs(0, [
			{ number: 0, name: "Preflight", status: "not-started" },
			{ number: 1, name: "Implementation", status: "not-started" },
		]);

		const taskStarted = logs.filter(([action]) => action === "Task started");
		expect(taskStarted.length).toBe(1);

		const taskResumed = logs.filter(([action]) => action === "Task resumed");
		expect(taskResumed.length).toBe(0);
	});

	it("2.1: first start logs 'Step 0 started' for not-started step", () => {
		const logs = simulateStartupLogs(0, [
			{ number: 0, name: "Preflight", status: "not-started" },
		]);

		const stepStarted = logs.filter(([action]) => action === "Step 0 started");
		expect(stepStarted.length).toBe(1);
	});

	it("2.2: restart (totalIterations > 0) produces 'Task resumed' not 'Task started'", () => {
		const logs = simulateStartupLogs(2, [
			{ number: 0, name: "Preflight", status: "in-progress" },
			{ number: 1, name: "Implementation", status: "not-started" },
		]);

		const taskStarted = logs.filter(([action]) => action === "Task started");
		expect(taskStarted.length).toBe(0);

		const taskResumed = logs.filter(([action]) => action === "Task resumed");
		expect(taskResumed.length).toBe(1);
		expect(taskResumed[0][1]).toContain("iteration 2");
	});

	it("2.3: restart skips 'Step N started' when step is already in-progress", () => {
		const logs = simulateStartupLogs(1, [
			{ number: 0, name: "Preflight", status: "in-progress" },
			{ number: 1, name: "Implementation", status: "not-started" },
		]);

		const stepStarted = logs.filter(([action]) => action.includes("started"));
		expect(stepStarted.length).toBe(0);
	});

	it("2.4: restart with completed first step logs 'Step 1 started' for new step", () => {
		const logs = simulateStartupLogs(3, [
			{ number: 0, name: "Preflight", status: "complete" },
			{ number: 1, name: "Implementation", status: "not-started" },
			{ number: 2, name: "Testing", status: "not-started" },
		]);

		expect(logs[0][0]).toBe("Task resumed");
		expect(logs[1][0]).toBe("Step 1 started");
		expect(logs.length).toBe(2);
	});

	it("2.5: restart with all steps complete produces only 'Task resumed'", () => {
		const logs = simulateStartupLogs(5, [
			{ number: 0, name: "Preflight", status: "complete" },
			{ number: 1, name: "Implementation", status: "complete" },
		]);

		expect(logs.length).toBe(1);
		expect(logs[0][0]).toBe("Task resumed");
	});

	it("2.6: no duplicate startup entries across simulated restart sequence", () => {
		// Simulate a lifecycle: start → crash → restart
		const firstStartLogs = simulateStartupLogs(0, [
			{ number: 0, name: "Preflight", status: "not-started" },
		]);

		// After first run, step would be in-progress, totalIterations would be 1
		const restartLogs = simulateStartupLogs(1, [
			{ number: 0, name: "Preflight", status: "in-progress" },
		]);

		// Combine and check: no duplicate "Task started" entries
		const allLogs = [...firstStartLogs, ...restartLogs];
		const taskStarted = allLogs.filter(([action]) => action === "Task started");
		const taskResumed = allLogs.filter(([action]) => action === "Task resumed");

		expect(taskStarted.length).toBe(1); // Only from first start
		expect(taskResumed.length).toBe(1); // Only from restart
	});
});
