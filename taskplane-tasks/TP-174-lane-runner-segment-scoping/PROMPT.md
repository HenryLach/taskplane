# Task: TP-174 - Lane-Runner Segment Scoping

**Created:** 2026-04-12
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Core worker-facing change — modifies what workers see, how progress is tracked, and when segments complete. High blast radius across lane-runner, stall detection, and exit logic.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-174-lane-runner-segment-scoping/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Modify the lane-runner to scope worker visibility, progress tracking, and exit conditions to the current segment's checkboxes. When a worker spawns for a specific segment (e.g., `TP-005::api-service`), it should only see checkboxes tagged with that repoId in the current step, only count those checkboxes for progress/stall detection, and exit cleanly when they're all checked.

**Reference specification:** `docs/specifications/taskplane/segment-aware-steps.md` (sections A.2, A.3, A.4, A.5)

## Dependencies

- **Task:** TP-173 (StepSegmentMapping must be available on ParsedTask)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/segment-aware-steps.md` — Phase A spec (sections A.2–A.5)

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/lane-runner.ts`
- `extensions/taskplane/sidecar-telemetry.ts`
- `extensions/tests/lane-runner*.test.ts`
- `extensions/tests/segment*.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read lane-runner.ts — understand iteration prompt construction, progress checking, step advancement, and exit logic
- [ ] Read sidecar-telemetry.ts — understand how STATUS.md is parsed for dashboard progress
- [ ] Understand how `stepSegmentMap` from TP-173 will be available (via config, parsed task, or re-parsed from PROMPT.md)
- [ ] Read the spec sections A.2–A.5 for exact scoping rules
- [ ] Document findings in STATUS.md

### Step 1: Segment-Scoped Iteration Prompt

- [ ] When constructing the worker's iteration prompt, read `stepSegmentMap` for the current step
- [ ] If the current step has segment markers, extract only the current segment's (repoId's) checkboxes
- [ ] Inject segment context: active segment ID, repo, checkboxes, prior steps completed
- [ ] List other segments in the step as "NOT yours — do not attempt" for clarity
- [ ] Filter "remaining steps" to only include steps that have a segment for the current repoId
- [ ] If no `stepSegmentMap` exists (legacy task), fall back to showing all checkboxes (unchanged behavior)
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/lane-runner.ts` (modified)

### Step 2: Segment-Scoped Progress and Stall Detection

- [ ] Add helper: `getSegmentCheckboxes(statusContent, stepNumber, repoId)` — extracts checked/unchecked counts for a specific segment block in STATUS.md
- [ ] Modify progress delta calculation to use segment-scoped counts instead of full-task counts
- [ ] Stall detection (noProgressCount) uses segment-scoped delta
- [ ] Soft progress detection (git diff) unchanged — still checks worktree-level changes
- [ ] The corrective re-spawn prompt references segment-specific unchecked items
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/lane-runner.ts` (modified)

### Step 3: Segment Exit Condition

- [ ] Add helper: `isSegmentComplete(statusContent, stepNumber, repoId)` — true when all checkboxes in the segment block are checked
- [ ] When segment is complete for current step: if more steps have segments for this repoId → advance to next step; if no more → segment done (existing .DONE suppression handles the rest)
- [ ] Ensure the lane-runner returns the correct result status for segment completion (non-final segment → "succeeded" with .DONE suppressed)
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/lane-runner.ts` (modified)

### Step 4: Sidecar Telemetry Update

- [ ] Update sidecar STATUS.md parsing to report segment-scoped progress when segment markers are present
- [ ] Dashboard progress bar should reflect current segment's checked/total, not full task
- [ ] Fall back to full-task progress for legacy tasks without markers
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/sidecar-telemetry.ts` (modified)

### Step 5: Testing & Verification

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures
- [ ] Add test: segment-scoped prompt shows only current segment's checkboxes
- [ ] Add test: segment-scoped progress counts only segment's checkboxes
- [ ] Add test: stall detection uses segment-scoped delta (not penalized for other segments)
- [ ] Add test: segment exit condition detects completion correctly
- [ ] Add test: legacy task without markers — no behavior change

### Step 6: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- None (internal lane-runner behavior)

**Check If Affected:**
- `docs/explanation/execution-model.md` — worker visibility description

## Completion Criteria

- [ ] All steps complete
- [ ] Workers only see their segment's checkboxes in the iteration prompt
- [ ] Progress tracking and stall detection are segment-scoped
- [ ] Segments exit cleanly when their checkboxes are complete
- [ ] Legacy tasks without segment markers behave identically to today
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `feat(TP-174): complete Step N — description`
- **Hydration:** `hydrate: TP-174 expand Step N checkboxes`

## Do NOT

- Change the execution model (still sequential segments across waves)
- Modify engine.ts or the segment frontier logic
- Change .DONE handling (TP-165 already handles this)
- Break single-segment task behavior
- Skip tests
- Commit without the task ID prefix

---

## Amendments (Added During Execution)

