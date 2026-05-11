/**
 * Tests for TP-174: Lane-Runner Segment Scoping
 *
 * Covers:
 * - getStepsForRepoId — step filtering by repoId
 * - getSegmentCheckboxes — segment-scoped checkbox counting from STATUS.md
 * - isSegmentComplete — segment completion detection
 * - Segment-scoped prompt construction (structural contract tests)
 * - Legacy fallback (tasks without segment markers)
 *
 * @since TP-174
 */

import { describe, it } from "node:test";
import { expect } from "./expect.ts";

import {
	getStepsForRepoId,
	getSegmentCheckboxes,
	isSegmentComplete,
	computeSegmentScopeMode,
} from "../taskplane/lane-runner.ts";

import type { StepSegmentMapping } from "../taskplane/types.ts";

// ── Test Fixtures ────────────────────────────────────────────────────

const MULTI_SEGMENT_MAP: StepSegmentMapping[] = [
	{
		stepNumber: 0,
		stepName: "Preflight",
		segments: [
			{ repoId: "shared-libs", checkboxes: ["- [ ] Verify shared-libs repo"] },
			{ repoId: "web-client", checkboxes: ["- [ ] Read brand guidelines"] },
		],
	},
	{
		stepNumber: 1,
		stepName: "Create utilities",
		segments: [
			{ repoId: "shared-libs", checkboxes: ["- [ ] Create string-utils.js", "- [ ] Add JSDoc"] },
			{ repoId: "web-client", checkboxes: ["- [ ] Create api/client.js", "- [ ] Add JSDoc"] },
		],
	},
	{
		stepNumber: 2,
		stepName: "Documentation & Delivery",
		segments: [{ repoId: "shared-libs", checkboxes: ["- [ ] Update STATUS.md"] }],
	},
];

const SINGLE_SEGMENT_MAP: StepSegmentMapping[] = [
	{
		stepNumber: 0,
		stepName: "Preflight",
		segments: [{ repoId: "default", checkboxes: ["- [ ] Verify project structure"] }],
	},
	{
		stepNumber: 1,
		stepName: "Implement feature",
		segments: [{ repoId: "default", checkboxes: ["- [ ] Create src/utils.js", "- [ ] Add tests"] }],
	},
];

const STATUS_WITH_SEGMENTS = `# TP-005: Multi-Repo Task — Status

**Current Step:** Step 1: Create utilities
**Status:** 🟡 In Progress
**Iteration:** 1

---

### Step 0: Preflight
**Status:** ✅ Complete

#### Segment: shared-libs
- [x] Verify shared-libs repo

#### Segment: web-client
- [x] Read brand guidelines

---

### Step 1: Create utilities
**Status:** 🟨 In Progress

#### Segment: shared-libs
- [x] Create string-utils.js
- [ ] Add JSDoc

#### Segment: web-client
- [ ] Create api/client.js
- [ ] Add JSDoc

---

### Step 2: Documentation & Delivery
**Status:** ⬜ Not Started

#### Segment: shared-libs
- [ ] Update STATUS.md

---
`;

const STATUS_ALL_SEGMENT_COMPLETE = `# TP-005: Multi-Repo Task — Status

**Current Step:** Step 1: Create utilities
**Status:** 🟡 In Progress
**Iteration:** 2

---

### Step 1: Create utilities
**Status:** 🟨 In Progress

#### Segment: shared-libs
- [x] Create string-utils.js
- [x] Add JSDoc

#### Segment: web-client
- [ ] Create api/client.js
- [ ] Add JSDoc

---
`;

const STATUS_NO_SEGMENTS = `# TP-010: Single-Repo Task — Status

**Current Step:** Step 1: Implement feature
**Status:** 🟡 In Progress
**Iteration:** 1

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Verify project structure

---

### Step 1: Implement feature
**Status:** 🟨 In Progress
- [x] Create src/utils.js
- [ ] Add tests

---
`;

// ── 1. getStepsForRepoId ──────────────────────────────────────────────

describe("1.x: getStepsForRepoId", () => {
	it("1.1: returns steps containing the requested repoId", () => {
		const result = getStepsForRepoId(MULTI_SEGMENT_MAP, "shared-libs");
		expect(result.has(0)).toBe(true);
		expect(result.has(1)).toBe(true);
		expect(result.has(2)).toBe(true);
		expect(result.size).toBe(3);
	});

	it("1.2: returns only steps with segments for the given repoId", () => {
		const result = getStepsForRepoId(MULTI_SEGMENT_MAP, "web-client");
		expect(result.has(0)).toBe(true);
		expect(result.has(1)).toBe(true);
		expect(result.has(2)).toBe(false); // web-client not in Step 2
		expect(result.size).toBe(2);
	});

	it("1.3: returns empty set for unknown repoId", () => {
		const result = getStepsForRepoId(MULTI_SEGMENT_MAP, "unknown-repo");
		expect(result.size).toBe(0);
	});

	it("1.4: single-segment map returns all steps for the repo", () => {
		const result = getStepsForRepoId(SINGLE_SEGMENT_MAP, "default");
		expect(result.size).toBe(2);
		expect(result.has(0)).toBe(true);
		expect(result.has(1)).toBe(true);
	});
});

// ── 2. getSegmentCheckboxes ───────────────────────────────────────────

describe("2.x: getSegmentCheckboxes", () => {
	it("2.1: counts checked and unchecked for a specific segment in a step", () => {
		const result = getSegmentCheckboxes(STATUS_WITH_SEGMENTS, 1, "shared-libs");
		expect(result).not.toBe(null);
		expect(result!.checked).toBe(1);
		expect(result!.unchecked).toBe(1);
		expect(result!.total).toBe(2);
	});

	it("2.2: returns unchecked texts for the segment", () => {
		const result = getSegmentCheckboxes(STATUS_WITH_SEGMENTS, 1, "shared-libs");
		expect(result).not.toBe(null);
		expect(result!.uncheckedTexts.length).toBe(1);
		expect(result!.uncheckedTexts[0]).toBe("Add JSDoc");
	});

	it("2.3: counts correct values for web-client segment", () => {
		const result = getSegmentCheckboxes(STATUS_WITH_SEGMENTS, 1, "web-client");
		expect(result).not.toBe(null);
		expect(result!.checked).toBe(0);
		expect(result!.unchecked).toBe(2);
		expect(result!.total).toBe(2);
	});

	it("2.4: returns null for non-existent segment in a step", () => {
		const result = getSegmentCheckboxes(STATUS_WITH_SEGMENTS, 1, "unknown-repo");
		expect(result).toBe(null);
	});

	it("2.5: returns null for non-existent step number", () => {
		const result = getSegmentCheckboxes(STATUS_WITH_SEGMENTS, 99, "shared-libs");
		expect(result).toBe(null);
	});

	it("2.6: returns null for STATUS.md without segment markers", () => {
		const result = getSegmentCheckboxes(STATUS_NO_SEGMENTS, 1, "default");
		expect(result).toBe(null);
	});

	it("2.7: completed segment in Step 0", () => {
		const result = getSegmentCheckboxes(STATUS_WITH_SEGMENTS, 0, "shared-libs");
		expect(result).not.toBe(null);
		expect(result!.checked).toBe(1);
		expect(result!.unchecked).toBe(0);
		expect(result!.total).toBe(1);
	});
});

// ── 3. isSegmentComplete ──────────────────────────────────────────────

describe("3.x: isSegmentComplete", () => {
	it("3.1: returns true when all segment checkboxes are checked", () => {
		expect(isSegmentComplete(STATUS_ALL_SEGMENT_COMPLETE, 1, "shared-libs")).toBe(true);
	});

	it("3.2: returns false when segment has unchecked checkboxes", () => {
		expect(isSegmentComplete(STATUS_WITH_SEGMENTS, 1, "shared-libs")).toBe(false);
	});

	it("3.3: returns false for non-existent segment", () => {
		expect(isSegmentComplete(STATUS_WITH_SEGMENTS, 1, "unknown-repo")).toBe(false);
	});

	it("3.4: returns true for completed Step 0 segment", () => {
		expect(isSegmentComplete(STATUS_WITH_SEGMENTS, 0, "shared-libs")).toBe(true);
	});

	it("3.5: returns false for all-unchecked segment", () => {
		expect(isSegmentComplete(STATUS_WITH_SEGMENTS, 1, "web-client")).toBe(false);
	});

	it("3.6: returns false for empty STATUS.md", () => {
		expect(isSegmentComplete("", 0, "shared-libs")).toBe(false);
	});
});

// ── 4. Segment-scoped prompt construction contracts ───────────────────

describe("4.x: Segment-scoped prompt construction contracts (source analysis)", () => {
	let laneRunnerSrc: string;

	it("4.0: load lane-runner source", async () => {
		const { readFileSync } = await import("node:fs");
		const { join, dirname } = await import("node:path");
		const { fileURLToPath } = await import("node:url");
		const testDir = dirname(fileURLToPath(import.meta.url));
		laneRunnerSrc = readFileSync(join(testDir, "..", "taskplane", "lane-runner.ts"), "utf-8");
	});

	it("4.1: segment-scoped prompt block has a defensive mySegment guard (TP-196)", () => {
		// TP-196 / #502: the outer gate is now `if (isSegmentScoped)` (mode-driven),
		// and inside that block a defensive guard skips the segment-scoped body when
		// `currentStepMapping` / `mySegment` is unexpectedly missing (logs a WARN).
		// This preserves the original mySegment safety property without re-encoding
		// the raw composite condition outside.
		expect(laneRunnerSrc).toContain("if (!currentStepMapping || !mySegment) {");
	});

	it("4.2: prompt includes 'NOT yours' guardrail for other segments", () => {
		expect(laneRunnerSrc).toContain("NOT yours");
		expect(laneRunnerSrc).toContain("do not attempt");
	});

	it("4.3: prompt includes segment exit instruction", () => {
		expect(laneRunnerSrc).toContain("When all YOUR checkboxes are checked");
		expect(laneRunnerSrc).toContain("exit successfully");
	});

	it("4.4: remaining steps are filtered by repoStepNumbers", () => {
		expect(laneRunnerSrc).toContain("repoStepNumbers && !repoStepNumbers.has(step.number)");
	});

	it("4.5: segment-scoped filtering falls back when repoStepNumbers is empty", () => {
		// The legacy fallback logic: rawRepoStepNumbers.size > 0 check
		expect(laneRunnerSrc).toContain("rawRepoStepNumbers && rawRepoStepNumbers.size > 0");
	});

	it("4.6: uses config.repoId instead of parsing segmentId", () => {
		// Should NOT contain getRepoIdFromSegmentId (removed in R002/R003)
		expect(laneRunnerSrc).not.toContain("getRepoIdFromSegmentId");
		// Should use config.repoId for the currentRepoId
		expect(laneRunnerSrc).toContain("const currentRepoId = segmentId ? config.repoId : null");
	});
});

// ── 5. Segment-scoped progress and stall detection contracts ──────────

describe("5.x: Segment-scoped progress and stall detection contracts (source analysis)", () => {
	let laneRunnerSrc: string;

	it("5.0: load lane-runner source", async () => {
		const { readFileSync } = await import("node:fs");
		const { join, dirname } = await import("node:path");
		const { fileURLToPath } = await import("node:url");
		const testDir = dirname(fileURLToPath(import.meta.url));
		laneRunnerSrc = readFileSync(join(testDir, "..", "taskplane", "lane-runner.ts"), "utf-8");
	});

	it("5.1: prevTotalChecked uses segment-scoped count when segment markers present", () => {
		// Check that the code branches on repoStepNumbers for prevTotalChecked
		expect(laneRunnerSrc).toContain("if (repoStepNumbers && currentRepoId)");
		// Should call getSegmentCheckboxes for the pre-check
		const preCheckPattern = /prevTotalChecked.*=.*segCbs.*checked/s;
		expect(preCheckPattern.test(laneRunnerSrc)).toBe(true);
	});

	it("5.2: afterTotalChecked uses segment-scoped count when segment markers present", () => {
		// Segment-scoped progress delta comment
		expect(laneRunnerSrc).toContain("TP-174: Segment-scoped progress delta");
	});

	it("5.3: onPrematureExit uses segment-scoped midTotalChecked", () => {
		// The exit intercept should use the same scope
		expect(laneRunnerSrc).toContain("TP-174: Use same scope as prevTotalChecked");
	});

	it("5.4: corrective re-spawn references segment-specific unchecked items", () => {
		expect(laneRunnerSrc).toContain(
			"TP-174: When segment-scoped, report only this segment's unchecked items",
		);
	});
});

// ── 6. Segment exit condition contracts ────────────────────────────────

describe("6.x: Segment exit condition contracts (source analysis)", () => {
	let laneRunnerSrc: string;

	it("6.0: load lane-runner source", async () => {
		const { readFileSync } = await import("node:fs");
		const { join, dirname } = await import("node:path");
		const { fileURLToPath } = await import("node:url");
		const testDir = dirname(fileURLToPath(import.meta.url));
		laneRunnerSrc = readFileSync(join(testDir, "..", "taskplane", "lane-runner.ts"), "utf-8");
	});

	it("6.1: allComplete check uses isSegmentComplete for segment-scoped execution", () => {
		expect(laneRunnerSrc).toContain("isSegmentComplete(afterStatusContent, stepNum, currentRepoId)");
	});

	it("6.2: remainingSteps uses isSegmentComplete for segment-scoped step advancement", () => {
		expect(laneRunnerSrc).toContain(
			"!isSegmentComplete(iterStatusContent, step.number, currentRepoId)",
		);
	});

	it("6.3: post-loop completion uses segment-scoped check", () => {
		expect(laneRunnerSrc).toContain("isSegmentComplete(finalStatusContent, stepNum, postLoopRepoId)");
	});

	it("6.4: step marking still uses isStepComplete for non-segment mode", () => {
		// The else branch for step marking should use isStepComplete
		expect(laneRunnerSrc).toContain("if (isStepComplete(ss))");
	});
});

// ── 7. Legacy fallback (no segment markers) ───────────────────────────

describe("7.x: Legacy fallback — no behavior change for tasks without markers", () => {
	let laneRunnerSrc: string;

	it("7.0: load lane-runner source", async () => {
		const { readFileSync } = await import("node:fs");
		const { join, dirname } = await import("node:path");
		const { fileURLToPath } = await import("node:url");
		const testDir = dirname(fileURLToPath(import.meta.url));
		laneRunnerSrc = readFileSync(join(testDir, "..", "taskplane", "lane-runner.ts"), "utf-8");
	});

	it("7.1: segment scoping is gated on segmentId being non-null", () => {
		expect(laneRunnerSrc).toContain("const currentRepoId = segmentId ? config.repoId : null");
	});

	it("7.2: repoStepNumbers is null when segmentId is null (whole-task execution)", () => {
		// stepSegmentMap check requires both stepSegmentMap AND currentRepoId
		expect(laneRunnerSrc).toContain("stepSegmentMap && currentRepoId");
	});

	it("7.3: segment prompt block is gated on the authoritative mode flag (TP-196)", () => {
		// TP-196 / #502: the segment-scoped prompt-injection branch must derive
		// its gate from the authoritative `isSegmentScoped` (which itself is
		// derived from `segmentScopeMode`) rather than re-evaluating the raw
		// composite condition. Asserting the mode-driven gate prevents drift.
		expect(laneRunnerSrc).toContain(
			"// TP-174/TP-196: Segment-scoped prompt — show only this segment's checkboxes.",
		);
		// The actual gate is `if (isSegmentScoped) {`, not the old composite.
		expect(laneRunnerSrc).toContain("\n\t\tif (isSegmentScoped) {");
		// And the raw composite condition no longer appears as a prompt-block gate.
		expect(laneRunnerSrc).not.toContain(
			"if (stepSegmentMap && currentRepoId && repoStepNumbers && remainingSteps.length > 0)",
		);
	});

	it("7.4: progress counting falls back to full-task when no segment context", () => {
		// The else branches should reduce across all steps
		expect(laneRunnerSrc).toContain(
			"currentStatus.steps.reduce((sum, s) => sum + s.totalChecked, 0)",
		);
		expect(laneRunnerSrc).toContain("afterStatus.steps.reduce((sum, s) => sum + s.totalChecked, 0)");
	});

	it("7.5: step completion check falls back to isStepComplete when no segment context", () => {
		// allComplete else branch uses isStepComplete.
		// TP-193: pattern accepts both `step =>` and `(step) =>` (formatter
		// inserts arrow parens) and uses normalized whitespace.
		const normSrc = laneRunnerSrc.replace(/\s+/g, " ");
		const fallbackPattern = /allComplete = parsed\.steps\.every\(\(?step\)? =>/;
		expect(fallbackPattern.test(normSrc)).toBe(true);
	});

	it("7.6: emitSnapshot receives null segmentContext for non-segment tasks", () => {
		expect(laneRunnerSrc).toContain(
			"snapshotSegmentCtx: { stepSegmentMap: StepSegmentMapping[]; repoId: string } | null",
		);
	});
});

// ── 9. computeSegmentScopeMode (TP-196 / #502) ─────────────────────

describe("9.x: computeSegmentScopeMode (TP-196 / #502)", () => {
	it("9.1: returns FULL_TASK when stepSegmentMap is null", () => {
		const result = computeSegmentScopeMode(null, new Set([1]), "shared-libs", 1);
		expect(result).toBe("FULL_TASK");
	});

	it("9.2: returns FULL_TASK when stepSegmentMap is undefined", () => {
		const result = computeSegmentScopeMode(undefined, new Set([1]), "shared-libs", 1);
		expect(result).toBe("FULL_TASK");
	});

	it("9.3: returns FULL_TASK when currentRepoId is null", () => {
		const result = computeSegmentScopeMode(MULTI_SEGMENT_MAP, new Set([1]), null, 1);
		expect(result).toBe("FULL_TASK");
	});

	it("9.4: returns FULL_TASK when repoStepNumbers is null (legacy fallback)", () => {
		const result = computeSegmentScopeMode(MULTI_SEGMENT_MAP, null, "shared-libs", 1);
		expect(result).toBe("FULL_TASK");
	});

	it("9.5: returns FULL_TASK when currentStepNumber is null (no remaining steps)", () => {
		const result = computeSegmentScopeMode(MULTI_SEGMENT_MAP, new Set([1]), "shared-libs", null);
		expect(result).toBe("FULL_TASK");
	});

	it("9.6: returns FULL_TASK when current step has no segment for repoId", () => {
		// web-client is NOT in Step 2 of MULTI_SEGMENT_MAP
		const result = computeSegmentScopeMode(MULTI_SEGMENT_MAP, new Set([0, 1, 2]), "web-client", 2);
		expect(result).toBe("FULL_TASK");
	});

	it("9.7: returns SEGMENT_SCOPED when all conditions hold for shared-libs in Step 1", () => {
		const result = computeSegmentScopeMode(MULTI_SEGMENT_MAP, new Set([0, 1, 2]), "shared-libs", 1);
		expect(result).toBe("SEGMENT_SCOPED");
	});

	it("9.8: returns SEGMENT_SCOPED for web-client in Step 0", () => {
		const result = computeSegmentScopeMode(MULTI_SEGMENT_MAP, new Set([0, 1]), "web-client", 0);
		expect(result).toBe("SEGMENT_SCOPED");
	});

	it("9.9: returns SEGMENT_SCOPED for single-segment map matching repoId", () => {
		const result = computeSegmentScopeMode(SINGLE_SEGMENT_MAP, new Set([0, 1]), "default", 1);
		expect(result).toBe("SEGMENT_SCOPED");
	});

	it("9.10: returns FULL_TASK when stepSegmentMap is empty array", () => {
		// Empty array is truthy but has no entries — the find() returns undefined.
		const result = computeSegmentScopeMode([], new Set([1]), "shared-libs", 1);
		expect(result).toBe("FULL_TASK");
	});

	it("9.11: returns FULL_TASK when step number does not exist in map", () => {
		const result = computeSegmentScopeMode(MULTI_SEGMENT_MAP, new Set([1]), "shared-libs", 99);
		expect(result).toBe("FULL_TASK");
	});
});

describe("9.x: SegmentScopeMode source-analysis contracts (TP-196 / #502)", () => {
	let laneRunnerSrc: string;

	it("9.20: load lane-runner source", async () => {
		const { readFileSync } = await import("node:fs");
		const { join, dirname } = await import("node:path");
		const { fileURLToPath } = await import("node:url");
		const testDir = dirname(fileURLToPath(import.meta.url));
		laneRunnerSrc = readFileSync(join(testDir, "..", "taskplane", "lane-runner.ts"), "utf-8");
	});

	it("9.21: iteration loop derives isSegmentScoped from segmentScopeMode (single source of truth)", () => {
		// The boolean must now be derived from the mode, not recomputed inline.
		expect(laneRunnerSrc).toContain('const isSegmentScoped = segmentScopeMode === "SEGMENT_SCOPED"');
	});

	it("9.22: iteration loop calls computeSegmentScopeMode helper", () => {
		// The new computation goes through the helper.
		const pattern = /const segmentScopeMode: SegmentScopeMode = computeSegmentScopeMode\(/;
		expect(pattern.test(laneRunnerSrc)).toBe(true);
	});

	it("9.23: TASKPLANE_ACTIVE_SEGMENT_ID env var is gated on isSegmentScoped", () => {
		// FULL_TASK mode must hard-clear the env var to prevent inheritance leaks.
		expect(laneRunnerSrc).toContain(
			'TASKPLANE_ACTIVE_SEGMENT_ID: isSegmentScoped ? (segmentId ?? "") : ""',
		);
		expect(laneRunnerSrc).toContain('TASKPLANE_SEGMENT_ID: isSegmentScoped ? (segmentId ?? "") : ""');
	});

	it("9.24: segment system-prompt overlay is gated on isSegmentScoped", () => {
		// FULL_TASK mode must NOT append the segment system-prompt overlay.
		expect(laneRunnerSrc).toContain("isSegmentScoped && config.workerSegmentPrompt");
	});
});

// ── 10. Pre-spawn segment-completion check (TP-196 / #508) ─────────

describe("10.x: Pre-spawn segment-completion early-exit (TP-196 / #508)", () => {
	let laneRunnerSrc: string;

	it("10.0: load lane-runner source", async () => {
		const { readFileSync } = await import("node:fs");
		const { join, dirname } = await import("node:path");
		const { fileURLToPath } = await import("node:url");
		const testDir = dirname(fileURLToPath(import.meta.url));
		laneRunnerSrc = readFileSync(join(testDir, "..", "taskplane", "lane-runner.ts"), "utf-8");
	});

	it("10.1: pre-spawn check exists between remainingSteps guard and iteration counter", () => {
		// The TP-196 / #508 pre-spawn check must live AFTER the existing
		// `if (remainingSteps.length === 0) break;` and BEFORE `totalIterations++`,
		// so a fully-complete segment skips the spawn without incrementing iterations.
		const breakIdx = laneRunnerSrc.indexOf("if (remainingSteps.length === 0) break;");
		expect(breakIdx).toBeGreaterThan(-1);
		const checkIdx = laneRunnerSrc.indexOf(
			"TP-196 / #508: Pre-spawn segment-completion check",
			breakIdx,
		);
		expect(checkIdx).toBeGreaterThan(breakIdx);
		const iterIncIdx = laneRunnerSrc.indexOf("totalIterations++", checkIdx);
		expect(iterIncIdx).toBeGreaterThan(checkIdx);
	});

	it("10.2: pre-spawn check delegates to shouldSkipSpawnForCompleteSegment helper", () => {
		const checkIdx = laneRunnerSrc.indexOf("TP-196 / #508: Pre-spawn segment-completion check");
		expect(checkIdx).toBeGreaterThan(-1);
		const block = laneRunnerSrc.slice(checkIdx, checkIdx + 1200);
		// Delegates the decision to the pure helper (#508 contract).
		expect(block).toContain(
			"shouldSkipSpawnForCompleteSegment(iterStatusContent, repoStepNumbers, currentRepoId)",
		);
	});

	it("10.3: pre-spawn check breaks out of the loop (no spawn for an already-complete segment)", () => {
		const checkIdx = laneRunnerSrc.indexOf("TP-196 / #508: Pre-spawn segment-completion check");
		const block = laneRunnerSrc.slice(checkIdx, checkIdx + 1200);
		// Logs the decision and breaks out of the iteration loop on `true`.
		expect(block).toContain("Pre-spawn segment-completion check");
		const ifCallIdx = block.indexOf("if (shouldSkipSpawnForCompleteSegment(");
		expect(ifCallIdx).toBeGreaterThan(-1);
		const breakIdx = block.indexOf("break;", ifCallIdx);
		expect(breakIdx).toBeGreaterThan(ifCallIdx);
	});

	it("10.4: helper itself is gated so FULL_TASK iterations are unaffected", () => {
		// FULL_TASK iterations (currentRepoId null or no repo segment set) rely
		// on the existing `remainingSteps.length === 0` exit. The new helper
		// must short-circuit to `false` for those cases.
		const helperIdx = laneRunnerSrc.indexOf(
			"export function shouldSkipSpawnForCompleteSegment(",
		);
		expect(helperIdx).toBeGreaterThan(-1);
		const helperBody = laneRunnerSrc.slice(helperIdx, helperIdx + 800);
		expect(helperBody).toContain(
			"if (!repoStepNumbers || !currentRepoId || repoStepNumbers.size === 0) return false",
		);
	});
});

// ── 8. Snapshot segment-scoped progress ───────────────────────────────

describe("8.x: Snapshot segment-scoped progress (emitSnapshot)", () => {
	let laneRunnerSrc: string;

	it("8.0: load lane-runner source", async () => {
		const { readFileSync } = await import("node:fs");
		const { join, dirname } = await import("node:path");
		const { fileURLToPath } = await import("node:url");
		const testDir = dirname(fileURLToPath(import.meta.url));
		laneRunnerSrc = readFileSync(join(testDir, "..", "taskplane", "lane-runner.ts"), "utf-8");
	});

	it("8.1: emitSnapshot accepts segmentContext parameter", () => {
		expect(laneRunnerSrc).toContain(
			"segmentContext?: { stepSegmentMap: StepSegmentMapping[]; repoId: string } | null",
		);
	});

	it("8.2: emitSnapshot uses segment-scoped checked/total when segmentContext provided", () => {
		expect(laneRunnerSrc).toContain("if (segmentContext)");
		expect(laneRunnerSrc).toContain("const { stepSegmentMap, repoId } = segmentContext");
	});

	it("8.3: all emitSnapshot calls pass snapshotSegmentCtx", () => {
		// TP-193: Whitespace-normalize so cosmetic formatter wrapping (multi-arg
		// emitSnapshot calls split across lines) doesn't break the regex match.
		const normSrc = laneRunnerSrc
			.replace(/\s+/g, " ")
			.replace(/([(\[{])\s+/g, "$1")
			.replace(/\s+([)\]},])/g, "$1")
			.replace(/,([)\]}])/g, "$1");
		const calls = normSrc.match(/emitSnapshot\(config,.*?snapshotSegmentCtx\)/g);
		expect(calls).not.toBe(null);
		expect(calls!.length).toBeGreaterThanOrEqual(2);
	});

	it("8.4: makeResult passes segmentCtx to emitSnapshot", () => {
		expect(laneRunnerSrc).toContainNormalized(
			"emitSnapshot(config, taskId, segmentId, terminalStatus, finalTelemetry ?? {}, statusPath, reviewerStatePath, segmentCtx)",
		);
	});
});
