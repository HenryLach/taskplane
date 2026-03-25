# R001 — Plan Review (Step 1: Fix Step Status Initialization)

## Verdict: **APPROVE**

The Step 1 plan is sound and correctly targeted at the root cause in `executeTask`.

## What I checked
- `PROMPT.md` requirements for TP-062
- `STATUS.md` progress context
- `extensions/task-runner.ts` status initialization and worker flow

## Why this plan is correct
1. **Correct root-cause target:** the initialization loop that previously marked all incomplete steps as `in-progress`.
2. **Correct fix shape:** mark only the **first incomplete** step as `in-progress`, keep later steps `not-started`.
3. **Recovery-safe behavior:** reverting stale future `in-progress` steps back to `not-started` is appropriate for resumed/retried runs.
4. **Low blast radius:** one focused change in task-runner status handling, no parser/dashboard contract changes.

## Important implementation note
The optional “remove the loop entirely” variant should **not** be used in current code:
- `runWorker()` instructions explicitly tell workers to set step status to **"complete"** (not to set `in-progress` on entry).
- Therefore, keeping an initialization pass in `executeTask` is still necessary to display a current in-progress step correctly.

## Step 2 test guidance (to confirm plan intent)
Add/keep a source-behavior check that validates:
- First incomplete step => `in-progress`
- Subsequent incomplete steps => `not-started`
- Completed steps remain `complete`

No blockers for proceeding.
