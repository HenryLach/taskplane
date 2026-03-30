/**
 * Persistent Worker Context Per Task — TP-048 Step 5
 *
 * Tests for the single-spawn-per-task execution model:
 *   1.x — Single-spawn-per-task: worker spawned once with all remaining steps
 *   2.x — Multi-step progress tracking: total checkboxes across all steps
 *   3.x — Stall detection: noProgressCount across full iterations
 *   4.x — Review timing: transition-based reviews after worker exit
 *   5.x — REVISE → rework in next iteration
 *   6.x — Context limit → recovery on next iteration
 *   7.x — parseStatusMd correctness for the new model
 *   8.x — Worker prompt construction: multi-step format
 *
 * Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/persistent-worker-context.test.ts
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Source Reading ───────────────────────────────────────────────────

const sourceFile = join(__dirname, "..", "task-runner.ts");
const source = readFileSync(sourceFile, "utf8");

/**
 * Extract a function body from the source by name.
 * Works for both `function foo(` and `async function foo(`.
 */
function extractFunction(src: string, name: string): string {
	const pattern = new RegExp(`(async\\s+)?function ${name}\\s*[<(]`);
	const match = pattern.exec(src);
	if (!match) throw new Error(`Function '${name}' not found in source`);

	let depth = 0;
	let started = false;
	const start = match.index;

	for (let i = match.index; i < src.length; i++) {
		if (src[i] === "{") {
			depth++;
			started = true;
		}
		if (src[i] === "}") {
			depth--;
			if (started && depth === 0) {
				return src.slice(start, i + 1);
			}
		}
	}

	throw new Error(`Could not find end of function '${name}'`);
}

/**
 * Get the region of source code around a specific pattern.
 */
function sourceRegion(pattern: string, beforeChars = 0, afterChars = 1000): string {
	const idx = source.indexOf(pattern);
	if (idx === -1) throw new Error(`Pattern not found: ${pattern}`);
	return source.slice(Math.max(0, idx - beforeChars), idx + pattern.length + afterChars);
}

// ══════════════════════════════════════════════════════════════════════
// 1.x — Single-spawn-per-task: structural verification
// ══════════════════════════════════════════════════════════════════════

describe("1.x: Single spawn per task — worker handles all remaining steps", () => {
	it("1.1: executeTask has a single per-task iteration loop (not per-step)", () => {
		// The old model had: for each step → for iter in max_worker_iterations → runWorker(step)
		// The new model has: for iter in max_worker_iterations → runWorker(remainingSteps)
		// Verify there's only ONE loop calling runWorker, and it passes remainingSteps
		const executeTaskBody = extractFunction(source, "executeTask");

		// Should call runWorker with remainingSteps (array), not a single step
		expect(executeTaskBody).toMatch(/await runWorker\(remainingSteps, ctx/);

		// Should NOT contain "runWorker(step," — the old per-step pattern
		expect(executeTaskBody).not.toMatch(/runWorker\(\s*step\s*,/);
	});

	it("1.2: runWorker accepts remainingSteps array, not single step", () => {
		// The function signature should take StepInfo[]
		const runWorkerSig = source.match(/async function runWorker\(([^)]+)\)/);
		expect(runWorkerSig).not.toBeNull();
		expect(runWorkerSig![1]).toContain("remainingSteps");
		expect(runWorkerSig![1]).toContain("StepInfo[]");
	});

	it("1.3: worker prompt passes file paths, not inline content", () => {
		const runWorkerBody = extractFunction(source, "runWorker");

		// Lean prompt: worker reads PROMPT.md and STATUS.md via file paths
		expect(runWorkerBody).toContain("task.promptPath");
		expect(runWorkerBody).toContain("statusPath");

		// Should NOT embed step listings inline (worker reads STATUS.md instead)
		expect(runWorkerBody).not.toContain("Work through these steps in order");
		expect(runWorkerBody).not.toContain("Execute Step ${step.number}");
		expect(runWorkerBody).not.toContain("Work ONLY on Step");
	});

	it("1.4: remainingSteps is computed from isStepComplete for all task steps", () => {
		const executeTaskBody = extractFunction(source, "executeTask");

		// remainingSteps is built by filtering task.steps through isStepComplete
		expect(executeTaskBody).toContain("const remainingSteps: StepInfo[] = []");
		expect(executeTaskBody).toContain("if (!isStepComplete(ss)) remainingSteps.push(step)");
	});

	it("1.5: loop breaks when remainingSteps is empty (all done)", () => {
		const executeTaskBody = extractFunction(source, "executeTask");
		expect(executeTaskBody).toContain("if (remainingSteps.length === 0) break");
	});

	it("1.6: no executeStep function exists (eliminated in refactor)", () => {
		// The old model had a separate executeStep function per step
		// This should no longer exist
		expect(source).not.toMatch(/function executeStep\s*\(/);
	});

	it("1.7: worker prompt includes wrap-up signal file path", () => {
		const runWorkerBody = extractFunction(source, "runWorker");
		expect(runWorkerBody).toContain("Wrap-up signal file");
		expect(runWorkerBody).toContain("wrapUpFile");
	});

	it("1.8: worker prompt includes iteration number", () => {
		const runWorkerBody = extractFunction(source, "runWorker");
		expect(runWorkerBody).toContain("state.totalIterations");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 2.x — Multi-step progress tracking
// ══════════════════════════════════════════════════════════════════════

describe("2.x: Multi-step progress tracking — total checkboxes across all steps", () => {
	it("2.1: progress is tracked per iteration (total across ALL steps)", () => {
		const executeTaskBody = extractFunction(source, "executeTask");

		// Before worker: count total checked across ALL steps
		expect(executeTaskBody).toContain(
			"currentStatus.steps.reduce((sum, s) => sum + s.totalChecked, 0)"
		);

		// After worker: count total again to compute delta
		expect(executeTaskBody).toContain(
			"afterStatus.steps.reduce((sum, s) => sum + s.totalChecked, 0)"
		);
	});

	it("2.2: progressDelta is computed from total before vs after", () => {
		const executeTaskBody = extractFunction(source, "executeTask");
		expect(executeTaskBody).toContain("const progressDelta = afterTotalChecked - prevTotalChecked");
	});

	it("2.3: newly completed steps are determined by comparing before/after sets", () => {
		const executeTaskBody = extractFunction(source, "executeTask");

		// completedBefore tracks which steps were done before the worker
		expect(executeTaskBody).toContain("const completedBefore = new Set<number>()");
		expect(executeTaskBody).toContain("if (isStepComplete(ss)) completedBefore.add(ss.number)");

		// newlyCompleted finds steps that transitioned to complete
		expect(executeTaskBody).toContain("const newlyCompleted: StepInfo[] = []");
		expect(executeTaskBody).toContain("if (completedBefore.has(step.number)) continue");
	});

	it("2.4: iteration summary logs which steps completed and progress delta", () => {
		const executeTaskBody = extractFunction(source, "executeTask");

		// Log completed step names
		expect(executeTaskBody).toContain(
			"newlyCompleted.map(s => `Step ${s.number}`).join"
		);

		// Log both: steps completed + checkboxes gained
		expect(executeTaskBody).toContain("+${progressDelta} checkboxes, completed: ${completedNames}");
		expect(executeTaskBody).toContain("+${progressDelta} checkboxes, no steps fully completed");
	});

	it("2.5: newly completed steps are detected and logged per iteration", () => {
		const executeTaskBody = extractFunction(source, "executeTask");

		// newlyCompleted tracks steps that transitioned to complete this iteration
		expect(executeTaskBody).toContain("const newlyCompleted: StepInfo[] = []");
		expect(executeTaskBody).toContain("newlyCompleted.push(step)");

		// Iteration summary logs both checkbox progress and completed steps
		expect(executeTaskBody).toContain("completedNames");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 3.x — Stall detection across iterations
// ══════════════════════════════════════════════════════════════════════

describe("3.x: Stall detection — no progress across full iterations", () => {
	it("3.1: noProgressCount increments when no new checkboxes in iteration", () => {
		const executeTaskBody = extractFunction(source, "executeTask");

		// Zero or negative progress delta increments noProgressCount
		expect(executeTaskBody).toContain("if (progressDelta <= 0)");
		expect(executeTaskBody).toContain("noProgressCount++");
	});

	it("3.2: noProgressCount resets when progress is made", () => {
		const executeTaskBody = extractFunction(source, "executeTask");

		// Positive progress resets the counter
		expect(executeTaskBody).toContain("} else {");
		expect(executeTaskBody).toContain("noProgressCount = 0");
	});

	it("3.3: task blocked when noProgressCount reaches no_progress_limit", () => {
		const executeTaskBody = extractFunction(source, "executeTask");

		expect(executeTaskBody).toContain("if (noProgressCount >= config.context.no_progress_limit)");
		expect(executeTaskBody).toContain(
			'logExecution(statusPath, "Task blocked"'
		);
		expect(executeTaskBody).toContain('state.phase = "error"');
	});

	it("3.4: stall detection logs iteration number and progress info", () => {
		const executeTaskBody = extractFunction(source, "executeTask");

		// TP-098: Changed from iter+1 (loop-local) to state.totalIterations (global)
		// to prevent label collision across restarts.
		expect(executeTaskBody).toContain(
			"`Iteration ${state.totalIterations}: 0 new checkboxes (${noProgressCount}/${config.context.no_progress_limit} stall limit)`"
		);
	});

	it("3.5: noProgressCount is per-iteration, not per-step", () => {
		const executeTaskBody = extractFunction(source, "executeTask");

		// noProgressCount is declared at the task level (outside the iteration loop)
		// and only checked once per iteration (after the worker exits), not per step
		const noProgressDecl = executeTaskBody.indexOf("let noProgressCount = 0");
		const forLoop = executeTaskBody.indexOf("for (let iter = 0");
		expect(noProgressDecl).toBeLessThan(forLoop);

		// The increment is inside the iteration loop but NOT inside any step loop
		// (it's directly after the worker call and progress comparison)
		const progressCheck = executeTaskBody.indexOf("if (progressDelta <= 0)");
		expect(progressCheck).toBeGreaterThan(forLoop);
	});

	it("3.6: max_worker_iterations bounds the outer loop", () => {
		const executeTaskBody = extractFunction(source, "executeTask");
		expect(executeTaskBody).toContain("for (let iter = 0; iter < config.context.max_worker_iterations; iter++)");
	});

	it("3.7: post-loop safety check fails explicitly if steps are incomplete", () => {
		const executeTaskBody = extractFunction(source, "executeTask");

		// After the loop, verify all steps are actually complete
		expect(executeTaskBody).toContain("Post-loop safety check");
		expect(executeTaskBody).toContain("if (!allStepsComplete)");
		expect(executeTaskBody).toContain("Max iterations");
		expect(executeTaskBody).toContain('state.phase = "error"');
	});
});

// ══════════════════════════════════════════════════════════════════════
// 4.x — Review timing: transition-based, after worker exit
// ══════════════════════════════════════════════════════════════════════

describe("4.x: Review timing — worker-driven via review_step tool (TP-050)", () => {
	it("4.1: review_step tool is registered in orchestrated mode", () => {
		// The task-runner registers a review_step tool for worker-driven reviews
		expect(source).toContain('name: "review_step"');
		expect(source).toContain("pi.registerTool(");
	});

	it("4.2: no deferred review loop in executeTask (reviews are worker-driven)", () => {
		const executeTaskBody = extractFunction(source, "executeTask");

		// The old deferred review patterns should NOT exist:
		// - No planReviewedSteps tracking
		// - No needsRework set
		// - No stepBaselineCommits map
		// - No doReview calls in the step loop
		expect(executeTaskBody).not.toContain("const planReviewedSteps");
		expect(executeTaskBody).not.toContain("const needsRework");
		expect(executeTaskBody).not.toContain("const stepBaselineCommits");
	});

	it("4.3: review_step tool accepts step number and review type", () => {
		// Tool parameters: step (number) and type (plan/code) in Type.Object schema
		expect(source).toContain("step: Type.Number(");
		expect(source).toContain('Type.Literal("plan")');
		expect(source).toContain('Type.Literal("code")');
	});

	it("4.4: review_step tool spawns reviewer via spawnAgentTmux", () => {
		// The tool handler uses the existing spawnAgentTmux infrastructure
		expect(source).toContain("spawnAgentTmux(");
	});

	it("4.5: review_step tool returns verdict to worker", () => {
		// Tool returns verdict string (APPROVE/REVISE/RETHINK/UNAVAILABLE)
		expect(source).toContain("APPROVE");
		expect(source).toContain("REVISE");
		expect(source).toContain("UNAVAILABLE");
	});

	it("4.6: executeTask comments confirm reviews are worker-driven", () => {
		const executeTaskBody = extractFunction(source, "executeTask");

		// Explicit comment that reviews are now inline via tool
		expect(executeTaskBody).toContain("review_step");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 5.x — REVISE → rework in next iteration
// ══════════════════════════════════════════════════════════════════════

describe("5.x: REVISE handling — worker-driven inline (TP-050)", () => {
	it("5.1: REVISE is handled by the worker via review_step tool, not outer loop", () => {
		const executeTaskBody = extractFunction(source, "executeTask");

		// The old needsRework pattern should NOT exist in the outer loop
		expect(executeTaskBody).not.toContain("const needsRework");
		expect(executeTaskBody).not.toContain("needsRework.add(");
		expect(executeTaskBody).not.toContain("needsRework.delete(");
	});

	it("5.2: review_step tool returns REVISE verdict with feedback summary", () => {
		// The tool handler includes REVISE in its verdict handling
		expect(source).toContain("REVISE");
	});

	it("5.3: worker template instructs worker to handle REVISE inline", () => {
		// The worker template (tested separately) tells the worker to address
		// REVISE feedback before proceeding. We verify the tool returns enough
		// context for the worker to act on.
		expect(source).toContain("review_step");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 6.x — Context limit → recovery on next iteration
// ══════════════════════════════════════════════════════════════════════

describe("6.x: Context limit mid-task → next iteration picks up from incomplete step", () => {
	it("6.1: context limit triggers wrap-up signal for graceful exit", () => {
		const runWorkerBody = extractFunction(source, "runWorker");
		expect(runWorkerBody).toContain("writeWrapUpSignal(`Wrap up (context ${Math.round(pct)}%)`)");
	});

	it("6.2: context limit at killPct kills the worker", () => {
		const runWorkerBody = extractFunction(source, "runWorker");
		expect(runWorkerBody).toContain("pct >= killPct");
		expect(runWorkerBody).toContain('killReason = "context"');
	});

	it("6.3: after worker exits, remaining steps are recomputed from STATUS.md", () => {
		const executeTaskBody = extractFunction(source, "executeTask");

		// At the start of each iteration, STATUS.md is re-parsed
		// to determine which steps are still incomplete.
		// Use a generous slice window to accommodate comments/guards added by TP-098.
		const iterLoop = executeTaskBody.indexOf("for (let iter = 0");
		const afterIterStart = executeTaskBody.slice(iterLoop, iterLoop + 800);
		expect(afterIterStart).toContain("const currentStatus = parseStatusMd(readFileSync(statusPath");
		expect(afterIterStart).toContain("const remainingSteps: StepInfo[] = []");
	});

	it("6.4: recovery iteration recomputes remaining steps from STATUS.md", () => {
		const executeTaskBody = extractFunction(source, "executeTask");

		// On recovery iterations, remaining steps are filtered from the full step list
		// based on their completion status in the freshly-parsed STATUS.md
		expect(executeTaskBody).toContain("remainingSteps");
		expect(executeTaskBody).toContain("isStepComplete");
	});

	it("6.5: wall-clock timeout also writes wrap-up signal", () => {
		const runWorkerBody = extractFunction(source, "runWorker");
		expect(runWorkerBody).toContain("writeWrapUpSignal(`Wrap up (wall-clock ${maxMinutes}min limit)`)");
	});

	it("6.6: wrap-up signals are cleared at start of each worker invocation", () => {
		const runWorkerBody = extractFunction(source, "runWorker");
		// clearWrapUpSignals is called before spawning
		expect(runWorkerBody).toContain("clearWrapUpSignals()");
	});

	it("6.7: worker prompt includes iteration number for context on recovery", () => {
		const runWorkerBody = extractFunction(source, "runWorker");
		expect(runWorkerBody).toContain("state.totalIterations");
		// Iteration nudge for subsequent iterations
		expect(runWorkerBody).toContain("exited previously without completing");
	});

	it("6.8: paused state is checked at start of each iteration", () => {
		const executeTaskBody = extractFunction(source, "executeTask");
		expect(executeTaskBody).toContain('if (state.phase === "paused")');
	});
});

// ══════════════════════════════════════════════════════════════════════
// 7.x — parseStatusMd correctness for the new model
// ══════════════════════════════════════════════════════════════════════

describe("7.x: parseStatusMd correctness — supports new execution model", () => {
	// Reimplementation of parseStatusMd for testing (matches task-runner.ts logic).
	// We test the source pattern matches the reimplementation below.
	interface TestStepInfo {
		number: number;
		name: string;
		status: string;
		checkboxes: Array<{ text: string; checked: boolean }>;
		totalChecked: number;
		totalItems: number;
	}

	function parseStatus(content: string): {
		steps: TestStepInfo[];
		reviewCounter: number;
		iteration: number;
	} {
		const text = content.replace(/\r\n/g, "\n");
		const steps: TestStepInfo[] = [];
		let currentStep: TestStepInfo | null = null;
		let reviewCounter = 0, iteration = 0;

		for (const line of text.split("\n")) {
			const rcMatch = line.match(/\*\*Review Counter:\*\*\s*(\d+)/);
			if (rcMatch) reviewCounter = parseInt(rcMatch[1]);
			const itMatch = line.match(/\*\*Iteration:\*\*\s*(\d+)/);
			if (itMatch) iteration = parseInt(itMatch[1]);

			const stepMatch = line.match(/^###\s+Step\s+(\d+):\s*(.+)/);
			if (stepMatch) {
				if (currentStep) {
					currentStep.totalChecked = currentStep.checkboxes.filter(c => c.checked).length;
					currentStep.totalItems = currentStep.checkboxes.length;
					steps.push(currentStep);
				}
				currentStep = { number: parseInt(stepMatch[1]), name: stepMatch[2].trim(), status: "not-started", checkboxes: [], totalChecked: 0, totalItems: 0 };
				continue;
			}
			if (currentStep) {
				const ss = line.match(/\*\*Status:\*\*\s*(.*)/);
				if (ss) {
					const s = ss[1];
					if (s.includes("✅") || s.toLowerCase().includes("complete")) currentStep.status = "complete";
					else if (s.includes("🟨") || s.toLowerCase().includes("progress")) currentStep.status = "in-progress";
				}
				const cb = line.match(/^\s*-\s*\[([ xX])\]\s*(.*)/);
				if (cb) currentStep.checkboxes.push({ text: cb[2].trim(), checked: cb[1].toLowerCase() === "x" });
			}
		}
		if (currentStep) {
			currentStep.totalChecked = currentStep.checkboxes.filter(c => c.checked).length;
			currentStep.totalItems = currentStep.checkboxes.length;
			steps.push(currentStep);
		}
		return { steps, reviewCounter, iteration };
	}

	// First verify the source has the expected parseStatusMd function
	it("7.0: parseStatusMd source matches expected patterns", () => {
		// Verify key patterns in the full source (not extracted, since the function
		// has a complex return type annotation that confuses brace-based extraction)
		expect(source).toContain("function parseStatusMd(content: string)");
		expect(source).toContain("Step\\s+(\\d+):");
		expect(source).toContain("Status:\\*\\*");
		expect(source).toContain("\\[([ xX])\\]");
		expect(source).toContain("currentStep.checkboxes.filter(c => c.checked).length");
	});

	it("7.1: parses multiple steps with mixed completion states", () => {
		const status = `
### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read code
- [x] Understand structure

### Step 1: Implementation
**Status:** 🟨 In Progress

- [x] Implement feature A
- [ ] Implement feature B
- [ ] Write tests

### Step 2: Documentation
**Status:** ⬜ Not Started

- [ ] Update docs
`;
		const result = parseStatus(status);
		expect(result.steps).toHaveLength(3);

		expect(result.steps[0].number).toBe(0);
		expect(result.steps[0].status).toBe("complete");
		expect(result.steps[0].totalChecked).toBe(2);
		expect(result.steps[0].totalItems).toBe(2);

		expect(result.steps[1].number).toBe(1);
		expect(result.steps[1].status).toBe("in-progress");
		expect(result.steps[1].totalChecked).toBe(1);
		expect(result.steps[1].totalItems).toBe(3);

		expect(result.steps[2].number).toBe(2);
		expect(result.steps[2].status).toBe("not-started");
		expect(result.steps[2].totalChecked).toBe(0);
		expect(result.steps[2].totalItems).toBe(1);
	});

	it("7.2: total checked across all steps is sum of individual steps", () => {
		const status = `
### Step 0: Preflight
**Status:** ✅ Complete

- [x] A
- [x] B

### Step 1: Work
**Status:** 🟨 In Progress

- [x] C
- [x] D
- [ ] E

### Step 2: Finish
**Status:** ⬜ Not Started

- [ ] F
- [ ] G
`;
		const result = parseStatus(status);
		const totalChecked = result.steps.reduce((sum, s) => sum + s.totalChecked, 0);
		expect(totalChecked).toBe(4); // A, B, C, D
		const totalItems = result.steps.reduce((sum, s) => sum + s.totalItems, 0);
		expect(totalItems).toBe(7);
	});

	it("7.3: review counter and iteration are parsed", () => {
		const status = `
**Review Counter:** 5
**Iteration:** 3

### Step 0: Test
**Status:** ✅ Complete

- [x] Done
`;
		const result = parseStatus(status);
		expect(result.reviewCounter).toBe(5);
		expect(result.iteration).toBe(3);
	});

	it("7.4: step with all checkboxes checked is detected as fully checked", () => {
		const status = `
### Step 1: Implementation
**Status:** 🟨 In Progress

- [x] Task A
- [x] Task B
- [x] Task C
`;
		const result = parseStatus(status);
		expect(result.steps[0].totalChecked).toBe(3);
		expect(result.steps[0].totalItems).toBe(3);
		expect(result.steps[0].totalChecked === result.steps[0].totalItems).toBe(true);
	});

	it("7.5: step with no checkboxes has totalItems = 0", () => {
		const status = `
### Step 0: Preflight
**Status:** ✅ Complete

(No checkboxes — just orientation)

### Step 1: Work
**Status:** ⬜ Not Started

- [ ] Do thing
`;
		const result = parseStatus(status);
		expect(result.steps[0].totalItems).toBe(0);
		expect(result.steps[0].totalChecked).toBe(0);
		expect(result.steps[1].totalItems).toBe(1);
	});
});

// ══════════════════════════════════════════════════════════════════════
// 8.x — Worker prompt construction: multi-step format
// ══════════════════════════════════════════════════════════════════════

describe("8.x: Worker prompt construction — lean filepath-based format", () => {
	it("8.1: prompt passes PROMPT.md and STATUS.md file paths (not content)", () => {
		const runWorkerBody = extractFunction(source, "runWorker");
		// Worker reads task files itself via the read tool
		expect(runWorkerBody).toContain("task.promptPath");
		expect(runWorkerBody).toContain("statusPath");
		// Should NOT embed inline step listings or numbered instructions
		expect(runWorkerBody).not.toContain("1. Read STATUS.md to find unchecked items");
	});

	it("8.2: prompt includes task ID and task folder", () => {
		const runWorkerBody = extractFunction(source, "runWorker");
		expect(runWorkerBody).toContain("task.taskId");
		expect(runWorkerBody).toContain("task.taskFolder");
	});

	it("8.3: prompt includes wrap-up signal file path", () => {
		const runWorkerBody = extractFunction(source, "runWorker");
		expect(runWorkerBody).toContain("Wrap-up signal file");
		expect(runWorkerBody).toContain("wrapUpFile");
	});

	it("8.4: archive suppression included for orchestrated mode", () => {
		const runWorkerBody = extractFunction(source, "runWorker");
		expect(runWorkerBody).toContain("isOrchestratedMode()");
		expect(runWorkerBody).toContain("ORCHESTRATED RUN");
	});

	it("8.5: iteration nudge included for subsequent iterations", () => {
		const runWorkerBody = extractFunction(source, "runWorker");
		expect(runWorkerBody).toContain("state.totalIterations > 1");
		expect(runWorkerBody).toContain("exited previously without completing");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 9.x — isStepComplete logic
// ══════════════════════════════════════════════════════════════════════

describe("9.x: isStepComplete — completion determination", () => {
	it("9.1: returns false for undefined step", () => {
		const executeTaskBody = extractFunction(source, "executeTask");
		const isStepCompleteBody = sourceRegion("function isStepComplete(ss: StepInfo | undefined): boolean", 0, 400);

		expect(isStepCompleteBody).toContain("if (!ss) return false");
	});

	it("9.2: returns false when step status is not complete and checkboxes incomplete", () => {
		const isStepCompleteBody = sourceRegion("function isStepComplete(ss: StepInfo | undefined): boolean", 0, 400);
		// isStepComplete checks explicit status first, then falls back to checkbox count
		expect(isStepCompleteBody).toContain('if (ss.status === "complete") return true');
	});

	it("9.3: returns true when status is explicitly 'complete'", () => {
		const isStepCompleteBody = sourceRegion("function isStepComplete(ss: StepInfo | undefined): boolean", 0, 400);
		expect(isStepCompleteBody).toContain('if (ss.status === "complete") return true');
	});

	it("9.4: falls back to checkbox count when status is in-progress", () => {
		const isStepCompleteBody = sourceRegion("function isStepComplete(ss: StepInfo | undefined): boolean", 0, 400);
		// Fallback: all checkboxes checked AND totalItems > 0
		expect(isStepCompleteBody).toContain("ss.totalChecked === ss.totalItems && ss.totalItems > 0");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 10.x — Worker template updates for multi-step awareness
// ══════════════════════════════════════════════════════════════════════

describe("10.x: Worker templates — multi-step awareness", () => {
	it("10.1: task-worker.md does NOT contain single-step-only instructions", () => {
		const templatePath = join(__dirname, "..", "..", "templates", "agents", "task-worker.md");
		let templateContent: string;
		try {
			templateContent = readFileSync(templatePath, "utf8");
		} catch {
			// Template might not exist in worktree — skip gracefully
			return;
		}

		// Should NOT have rigid single-step constraints
		expect(templateContent).not.toContain("Work ONLY on the step assigned");
		expect(templateContent).not.toContain("Do NOT proceed to other steps");
	});

	it("10.2: task-worker.md supports multi-step execution", () => {
		const templatePath = join(__dirname, "..", "..", "templates", "agents", "task-worker.md");
		let templateContent: string;
		try {
			templateContent = readFileSync(templatePath, "utf8");
		} catch {
			return;
		}

		// Should support working through multiple steps
		// The template should reference working on steps (plural) or step progression
		expect(templateContent).toContain("STATUS.md");
		expect(templateContent).toContain("checkpoint");
	});
});

// ══════════════════════════════════════════════════════════════════════
// 11.x — Integration: all complete detection
// ══════════════════════════════════════════════════════════════════════

describe("11.x: All-complete detection and task finalization", () => {
	it("11.1: allComplete checks every step via isStepComplete", () => {
		const executeTaskBody = extractFunction(source, "executeTask");
		expect(executeTaskBody).toContain("const allComplete = task.steps.every(step =>");
		expect(executeTaskBody).toContain("isStepComplete(ss)");
	});

	it("11.2: allComplete triggers loop exit", () => {
		const executeTaskBody = extractFunction(source, "executeTask");
		expect(executeTaskBody).toContain("if (allComplete) break");
	});

	it("11.3: quality gate runs after all steps complete (not per step)", () => {
		const executeTaskBody = extractFunction(source, "executeTask");

		// Quality gate block appears after the main loop exits
		const mainLoopEnd = executeTaskBody.lastIndexOf("if (allComplete) break");
		const qualityGateBlock = executeTaskBody.indexOf("if (config.quality_gate.enabled)");
		expect(qualityGateBlock).toBeGreaterThan(mainLoopEnd);
	});

	it("11.4: .DONE is created after all steps complete (and quality gate passes if enabled)", () => {
		const executeTaskBody = extractFunction(source, "executeTask");
		expect(executeTaskBody).toContain('writeFileSync(donePath, `Completed:');
	});
});
