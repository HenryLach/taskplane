/**
 * TP-062 — Step Status Initialization Tests
 *
 * Verifies that the step status initialization loop in task-runner.ts
 * only marks the FIRST incomplete step as "in-progress" and leaves
 * subsequent incomplete steps as "not-started".
 *
 * Tests:
 *   1.x — Source pattern verification: initialization loop structure
 *   2.x — Functional logic: simulated step status assignment
 *
 * Run: npx vitest run tests/task-runner-step-status.test.ts
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// ── Source Loading ────────────────────────────────────────────────────

const source = readFileSync(
	join(__dirname, "..", "task-runner.ts"),
	"utf-8"
);

// ══════════════════════════════════════════════════════════════════════
// 1.x — Source pattern verification
// ══════════════════════════════════════════════════════════════════════

describe("1.x: step status initialization source patterns", () => {
	it("1.0: uses foundFirstIncomplete guard in step initialization loop", () => {
		expect(source).toContain("let foundFirstIncomplete = false");
		expect(source).toContain("if (!foundFirstIncomplete)");
		expect(source).toContain("foundFirstIncomplete = true");
	});

	it("1.1: marks first incomplete step as in-progress", () => {
		// Within the !foundFirstIncomplete branch, should call updateStepStatus with in-progress
		expect(source).toContain('updateStepStatus(statusPath, step.number, "in-progress")');
	});

	it("1.2: resets subsequent in-progress steps to not-started", () => {
		// In the else branch, should reset in-progress steps to not-started
		expect(source).toContain('updateStepStatus(statusPath, step.number, "not-started")');
	});

	it("1.3: skips complete steps", () => {
		// The loop should skip steps that are already complete
		expect(source).toContain('if (ss?.status === "complete") continue');
	});

	it("1.4: does NOT mark all incomplete steps as in-progress (old bug pattern absent)", () => {
		// The old buggy comment should no longer exist
		expect(source).not.toContain("// Mark all incomplete steps as in-progress");
	});

	it("1.5: comment describes correct behavior", () => {
		expect(source).toContain("// Mark only the first incomplete step as in-progress");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — Functional simulation of step status logic
// ══════════════════════════════════════════════════════════════════════

describe("2.x: step status initialization logic", () => {
	// Reimplementation of the fixed initialization loop for testability.
	// This mirrors the logic in task-runner.ts step initialization block.

	interface StepStatus {
		number: number;
		status: "not-started" | "in-progress" | "complete";
	}

	interface StepDef {
		number: number;
		name: string;
	}

	/**
	 * Simulates the step status initialization loop from task-runner.ts.
	 * Returns the statuses that would be set.
	 */
	function initializeStepStatuses(
		steps: StepDef[],
		currentStatuses: StepStatus[]
	): Map<number, "in-progress" | "not-started"> {
		const updates = new Map<number, "in-progress" | "not-started">();
		let foundFirstIncomplete = false;

		for (const step of steps) {
			const ss = currentStatuses.find(s => s.number === step.number);
			if (ss?.status === "complete") continue;

			if (!foundFirstIncomplete) {
				updates.set(step.number, "in-progress");
				foundFirstIncomplete = true;
			} else {
				if (ss?.status === "in-progress") {
					updates.set(step.number, "not-started");
				}
			}
		}

		return updates;
	}

	it("2.0: all steps not-started → only first marked in-progress", () => {
		const steps: StepDef[] = [
			{ number: 0, name: "Preflight" },
			{ number: 1, name: "Implementation" },
			{ number: 2, name: "Testing" },
			{ number: 3, name: "Delivery" },
		];
		const statuses: StepStatus[] = [
			{ number: 0, status: "not-started" },
			{ number: 1, status: "not-started" },
			{ number: 2, status: "not-started" },
			{ number: 3, status: "not-started" },
		];

		const updates = initializeStepStatuses(steps, statuses);

		expect(updates.get(0)).toBe("in-progress");
		// Steps 1, 2, 3 are not-started but not previously in-progress,
		// so they don't get an explicit update (they stay not-started)
		expect(updates.has(1)).toBe(false);
		expect(updates.has(2)).toBe(false);
		expect(updates.has(3)).toBe(false);
	});

	it("2.1: first step complete → second step marked in-progress", () => {
		const steps: StepDef[] = [
			{ number: 0, name: "Preflight" },
			{ number: 1, name: "Implementation" },
			{ number: 2, name: "Testing" },
		];
		const statuses: StepStatus[] = [
			{ number: 0, status: "complete" },
			{ number: 1, status: "not-started" },
			{ number: 2, status: "not-started" },
		];

		const updates = initializeStepStatuses(steps, statuses);

		expect(updates.has(0)).toBe(false); // complete, skipped
		expect(updates.get(1)).toBe("in-progress");
		expect(updates.has(2)).toBe(false);
	});

	it("2.2: previously all in-progress (old bug state) → only first reset, rest to not-started", () => {
		const steps: StepDef[] = [
			{ number: 0, name: "Preflight" },
			{ number: 1, name: "Implementation" },
			{ number: 2, name: "Testing" },
			{ number: 3, name: "Delivery" },
		];
		const statuses: StepStatus[] = [
			{ number: 0, status: "in-progress" },
			{ number: 1, status: "in-progress" },
			{ number: 2, status: "in-progress" },
			{ number: 3, status: "in-progress" },
		];

		const updates = initializeStepStatuses(steps, statuses);

		expect(updates.get(0)).toBe("in-progress"); // first incomplete → in-progress
		expect(updates.get(1)).toBe("not-started"); // was in-progress → reset
		expect(updates.get(2)).toBe("not-started"); // was in-progress → reset
		expect(updates.get(3)).toBe("not-started"); // was in-progress → reset
	});

	it("2.3: mixed state with some complete and some in-progress from prior iteration", () => {
		const steps: StepDef[] = [
			{ number: 0, name: "Preflight" },
			{ number: 1, name: "Implementation" },
			{ number: 2, name: "Testing" },
			{ number: 3, name: "Delivery" },
		];
		const statuses: StepStatus[] = [
			{ number: 0, status: "complete" },
			{ number: 1, status: "complete" },
			{ number: 2, status: "in-progress" },
			{ number: 3, status: "in-progress" },
		];

		const updates = initializeStepStatuses(steps, statuses);

		expect(updates.has(0)).toBe(false); // complete
		expect(updates.has(1)).toBe(false); // complete
		expect(updates.get(2)).toBe("in-progress"); // first incomplete → in-progress
		expect(updates.get(3)).toBe("not-started"); // was in-progress → reset
	});

	it("2.4: all steps complete → no updates", () => {
		const steps: StepDef[] = [
			{ number: 0, name: "Preflight" },
			{ number: 1, name: "Implementation" },
		];
		const statuses: StepStatus[] = [
			{ number: 0, status: "complete" },
			{ number: 1, status: "complete" },
		];

		const updates = initializeStepStatuses(steps, statuses);

		expect(updates.size).toBe(0);
	});

	it("2.5: single incomplete step → marked in-progress", () => {
		const steps: StepDef[] = [
			{ number: 0, name: "Only Step" },
		];
		const statuses: StepStatus[] = [
			{ number: 0, status: "not-started" },
		];

		const updates = initializeStepStatuses(steps, statuses);

		expect(updates.get(0)).toBe("in-progress");
		expect(updates.size).toBe(1);
	});

	it("2.6: last step is the only incomplete one → marked in-progress", () => {
		const steps: StepDef[] = [
			{ number: 0, name: "Preflight" },
			{ number: 1, name: "Implementation" },
			{ number: 2, name: "Delivery" },
		];
		const statuses: StepStatus[] = [
			{ number: 0, status: "complete" },
			{ number: 1, status: "complete" },
			{ number: 2, status: "not-started" },
		];

		const updates = initializeStepStatuses(steps, statuses);

		expect(updates.has(0)).toBe(false);
		expect(updates.has(1)).toBe(false);
		expect(updates.get(2)).toBe("in-progress");
	});
});
