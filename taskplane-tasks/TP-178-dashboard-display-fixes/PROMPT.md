# Task: TP-178 - Dashboard Display Fixes

**Created:** 2026-04-13
**Size:** L

## Review Level: 1 (Plan Only)

**Assessment:** Multiple independent display bugs in a single file. No runtime changes. Low blast radius per fix, but many fixes in one task.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-178-dashboard-display-fixes/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Fix six display bugs in the dashboard's `app.js` that were discovered during polyrepo and mono-repo testing. Each bug is independent — a rendering or data-display issue that doesn't affect batch execution, only operator visibility.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `dashboard/public/app.js` — the main dashboard rendering code
- `dashboard/public/style.css` — dashboard styling

## Environment

- **Workspace:** `dashboard/`
- **Services required:** None

## File Scope

- `dashboard/public/app.js`
- `dashboard/public/style.css`

## Steps

### Step 0: Preflight

- [ ] Read `dashboard/public/app.js` — understand the rendering architecture, polling loop, and how batch/wave/lane/task data flows into the UI
- [ ] Read each GitHub issue linked below for exact symptoms and expected behavior
- [ ] Document findings in STATUS.md

### Step 1: Fix STATUS.md viewer showing stale content across batches (#487)

When a new batch starts, the STATUS.md viewer panel continues showing content from the previous batch's task until the user clicks a task in the new batch.

- [ ] Detect when `batchId` changes in the polling response (different from previously displayed batch)
- [ ] Clear the STATUS.md viewer state and reset the selected task
- [ ] Either show a "select a task" placeholder or auto-select the first running task in the new batch
- [ ] Verify: new batch starts → viewer clears or shows new task

### Step 2: Fix lane step label that never updates (#488)

The `progress.currentStep` field in the lane snapshot is captured on initial parse and never refreshed. Dashboard shows "Step 0: Preflight" even when the worker is on Step 4.

- [ ] Ensure the step name is re-read from the lane snapshot on every poll (it should be updated by the sidecar)
- [ ] If the sidecar isn't updating it, fall back to parsing the `Current Step` field from STATUS.md content if available
- [ ] Verify: step label updates as worker progresses through steps

### Step 3: Fix succeeded tasks showing 0% progress (#491)

When a task completes very quickly, the sidecar may never capture checkbox state. The dashboard shows `0% 0/0` for succeeded tasks.

- [ ] When task status is `succeeded`, override the progress display to show 100%
- [ ] Show "Complete" as the step label for succeeded tasks regardless of sidecar state
- [ ] Verify: quick-completing tasks show 100% and "Complete"

### Step 4: Fix wave indicators flashing green during merge (#493)

During the merge phase, all wave indicator chips turn green (completed), including future waves. They snap back to correct state after merge completes.

- [ ] During `merging` phase, only mark waves as completed if their index is < `currentWaveIndex`
- [ ] The current wave being merged should show a "merging" indicator (e.g., pulsing or different color), not green
- [ ] Future waves should remain grey regardless of phase
- [ ] Verify: only completed waves are green during merge

### Step 5: Fix merge agent telemetry duplicated across all waves (#498)

The merge agent telemetry (session, elapsed, tools, cost) is displayed on every wave in the merge history, not just the wave currently being merged.

- [ ] Use the `waveIndex` field from the merge snapshot to associate merge telemetry with the correct wave
- [ ] Only display merge telemetry for the wave it belongs to
- [ ] Completed waves show their historical merge telemetry (or none if not captured)
- [ ] Verify: merge telemetry appears only on the correct wave

### Step 6: Fix no progress shown for non-final segment execution (#494)

In polyrepo workspace mode, multi-segment tasks show `0% 0/N` during non-final segment execution because the sidecar reads STATUS.md from the wrong path or doesn't capture the intermediate state.

- [ ] Ensure the progress bar reads from the segment-scoped checkbox count (from sidecar telemetry)
- [ ] If sidecar data is unavailable, show an "executing" indicator rather than 0%
- [ ] Verify: non-final segments show real-time progress during execution

### Step 7: Testing & Verification

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Manual testing: start a batch with the dashboard open and verify each fix
- [ ] Verify no regressions in single-task, multi-task, and polyrepo dashboard views

### Step 8: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- None

**Check If Affected:**
- `docs/tutorials/use-the-dashboard.md` — if any dashboard behavior is documented

## Completion Criteria

- [ ] All six display bugs fixed
- [ ] Each fix verified manually with dashboard open
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `fix(TP-178): complete Step N — description`
- **Hydration:** `hydrate: TP-178 expand Step N checkboxes`

## Do NOT

- Modify runtime code (engine, lane-runner, execution)
- Change the dashboard API contract (only fix rendering logic)
- Add new npm dependencies to the dashboard
- Skip manual testing
- Commit without the task ID prefix

---

## Amendments (Added During Execution)

