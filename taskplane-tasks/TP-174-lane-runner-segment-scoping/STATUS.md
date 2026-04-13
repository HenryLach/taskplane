# TP-174: Lane-Runner Segment Scoping — Status

**Current Step:** Step 3: Segment Exit Condition
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-13
**Review Level:** 2
**Review Counter:** 7
**Iteration:** 1
**Size:** L

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read lane-runner.ts prompt construction and progress logic
- [x] Read sidecar-telemetry.ts STATUS.md parsing
- [x] Understand stepSegmentMap availability from TP-173
- [x] Read spec sections A.2–A.5
- [x] Document findings

---

### Step 1: Segment-Scoped Iteration Prompt
**Status:** ✅ Complete

- [x] Add helper `getRepoIdFromSegmentId(segmentId)` to extract repoId from segment ID
- [x] Add helper `getStepsForRepoId(stepSegmentMap, repoId)` to get step numbers with segments for a given repoId
- [x] Add segment-scoped prompt block: when stepSegmentMap exists and segmentId is present, inject segment context showing only current segment's checkboxes, listing other segments as "not yours", and filtering remaining steps to only those with this repoId
- [x] Legacy fallback: when stepSegmentMap is undefined or segmentId is null, no change to prompt (backward compatible)
- [x] Run targeted tests (48/48 pass)
- [x] R002: Use `config.repoId` instead of parsing opaque segmentId; add fallback when repoStepNumbers is empty (legacy multi-segment without markers)

---

### Step 2: Segment-Scoped Progress and Stall Detection
**Status:** ✅ Complete

- [x] Replace full-task progress delta with segment-scoped delta when segment markers are present (use getSegmentCheckboxes from Step 1 already added)
- [x] Stall detection uses segment-scoped prevChecked/afterChecked counts
- [x] Corrective re-spawn prompt references segment-specific unchecked items
- [x] Legacy fallback: no change to progress/stall when no markers
- [x] Run targeted tests (48/48 pass)

---

### Step 3: Segment Exit Condition
**Status:** 🟨 In Progress
- [ ] Use isSegmentComplete (already added in Step 1) in the step completion and loop exit logic to detect when all segment checkboxes are checked
- [ ] When segment is complete for current step: advance to next step if more steps for this repoId, or break loop if no more
- [ ] Legacy fallback unchanged — allComplete check uses full-task isStepComplete for non-segment tasks
- [ ] Run targeted tests

---

### Step 4: Sidecar Telemetry Update
**Status:** ⬜ Not Started
- [ ] Segment-scoped progress in sidecar
- [ ] Legacy fallback
- [ ] Run targeted tests

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started
- [ ] FULL test suite passing
- [ ] Segment-scoped prompt, progress, stall, exit tests
- [ ] Legacy regression tests
- [ ] All failures fixed

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-12 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-13 16:40 | Task started | Runtime V2 lane-runner execution |
| 2026-04-13 16:40 | Step 0 started | Preflight |

---

## Blockers

*None*

---

## Notes

Depends on TP-173. Core Phase A task — this is what makes workers see only their segment.
Specification: docs/specifications/taskplane/segment-aware-steps.md

### Preflight Findings

**lane-runner.ts structure (1015 lines):**
- `executeTaskV2()` is the main function, taking `ExecutionUnit`, `LaneRunnerConfig`, `pauseSignal`
- Iteration loop: parse PROMPT+STATUS, find remaining steps, build prompt lines, spawn worker, check progress
- Prompt construction: lines 194-246 build `promptLines[]`, including segment DAG context and iteration warnings
- Progress: lines 326-351: `afterTotalChecked - prevTotalChecked` counts ALL checkboxes via `parseStatusMd`
- Stall detection: `noProgressCount` increments when `progressDelta <= 0` (ignoring soft progress from git diff)
- Step completion: marks steps complete via `isStepComplete()`, breaks loop when `allComplete`
- Post-loop: checks allStepsComplete, handles .DONE suppression for non-final segments (TP-145/165)

**sidecar-telemetry.ts (252 lines):**
- `tailSidecarJsonl()` parses JSONL events (message_end, tool_execution_start, etc.)
- Does NOT parse STATUS.md — progress reporting is in `emitSnapshot()` within lane-runner.ts
- Sidecar telemetry is about token counts, tool calls, retries — NOT checkbox progress
- The segment-scoped progress change needed is in `emitSnapshot()` in lane-runner.ts

**stepSegmentMap availability:**
- `unit.task.stepSegmentMap?: StepSegmentMapping[]` available on `ExecutionUnit.task` (ParsedTask)
- `StepSegmentMapping` has `{stepNumber, stepName, segments: SegmentCheckboxGroup[]}`
- `SegmentCheckboxGroup` has `{repoId, checkboxes: string[]}`
- Parsed by `parseStepSegmentMapping()` in discovery.ts
- If no segment markers in PROMPT.md, `stepSegmentMap` is undefined → legacy fallback

**Spec A.2-A.5 key rules:**
- A.2: Worker sees only current segment's checkboxes; remaining steps filtered to steps with this repoId
- A.3: Progress/stall counts only current segment's checkboxes (getSegmentCheckboxes)
- A.4: isSegmentComplete checks all segment checkboxes are checked; step advancement if more steps for repoId
- A.5: Sequential execution unchanged; segments still execute across waves

**Key design decision:** 
- `segmentId` format is `taskId::repoId` — we can extract repoId from it
- Need to parse STATUS.md for segment blocks (#### Segment: repoId) to count segment-specific checkboxes
- For prompt scoping, use `unit.task.stepSegmentMap` (from PROMPT.md parsing)
- For progress counting, parse STATUS.md directly (since worker modifies STATUS.md)
| 2026-04-13 16:42 | Review R001 | plan Step 1: APPROVE |
| 2026-04-13 16:50 | Review R002 | code Step 1: REVISE |
| 2026-04-13 16:53 | Review R003 | code Step 1: REVISE |
| 2026-04-13 16:58 | Review R004 | code Step 1: APPROVE |
| 2026-04-13 17:00 | Review R005 | plan Step 2: APPROVE |
| 2026-04-13 17:02 | Review R006 | code Step 2: REVISE |
| 2026-04-13 17:05 | Review R007 | code Step 2: APPROVE |
