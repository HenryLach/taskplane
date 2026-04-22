# R007 — Plan Review (Step 3: Testing & Verification)

## Verdict
**CHANGES REQUESTED**

## Reviewed artifacts
- `taskplane-tasks/TP-007-resume-reconciliation-across-repos/PROMPT.md`
- `taskplane-tasks/TP-007-resume-reconciliation-across-repos/STATUS.md`
- `taskplane-tasks/TP-007-resume-reconciliation-across-repos/.reviews/R006-code-step2.md`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/engine.ts`
- `extensions/tests/orch-state-persistence.test.ts`
- `extensions/tests/orch-direct-implementation.test.ts`

## Blocking findings

### 1) Step 3 is marked complete while a blocking Step 2 review issue is still open
`STATUS.md` marks Step 3 complete and says “All failures fixed” with `Blockers: None` (`STATUS.md:149-163`, `STATUS.md:259-261`), but Step 2 code review is still unresolved in the review table (`STATUS.md:191`, `STATUS.md:193`) and R006 is **CHANGES REQUESTED**.

For this task, Step 3 cannot be considered complete until the R006 blocker is either fixed and re-reviewed, or explicitly dispositioned.

### 2) Verification still does not cover the R006 counterexample (blocked counter drift)
Current resume logic still uses:
- init-time counting of persisted blocked IDs for `wave >= resumeWaveIndex` (`extensions/taskplane/resume.ts:632-643`)
- per-wave exclusion of all persisted blocked IDs (`extensions/taskplane/resume.ts:1025-1030`)

R006 called out the specific edge case where resume starts in a wave that was already entered (with unfinished non-blocked work), which can overcount.

Step 3 targeted verification does not add that regression. Existing test section 2.14 still encodes the disputed assumption (`extensions/tests/orch-state-persistence.test.ts:5708-5735`).

## Required updates before approval
1. Re-open Step 3 to **In Progress** and set `Blockers` to include the open R006 issue until closed.
2. Add an explicit targeted regression test for: “resume begins at already-entered wave with persisted blocked tasks + unfinished non-blocked tasks in same wave,” and verify deterministic `blockedTasks` totals.
3. Re-run and record commands (not just aggregate counts) in Step 3 evidence:
   - targeted suite containing the new regression,
   - full suite: `cd extensions && npx vitest run`,
   - CLI smoke required by prompt: `node bin/taskplane.mjs help`.
4. Update the review table statuses after re-review so Step 3 completion is traceable to closed blockers.

## Non-blocking note
- `taskplane doctor` currently exits non-zero in this worktree due missing project config; if kept in Step 3 notes, record it as informational (expected in this context), not a passing smoke gate.
