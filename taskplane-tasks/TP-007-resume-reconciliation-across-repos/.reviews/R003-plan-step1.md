# R003 — Plan Review (Step 1: Compute repo-aware resume point)

## Verdict
**Changes requested**

## Reviewed artifacts
- `taskplane-tasks/TP-007-resume-reconciliation-across-repos/PROMPT.md`
- `taskplane-tasks/TP-007-resume-reconciliation-across-repos/STATUS.md`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/engine.ts`
- `extensions/tests/orch-state-persistence.test.ts`
- `extensions/tests/orch-direct-implementation.test.ts`

## Blocking findings

### 1) Step 1 plan is not hydrated yet
`STATUS.md` still has only two prompt-level bullets for Step 1 (`STATUS.md:55-59`).

For a failure-path-critical resume step, this is not implementation-ready. It needs concrete, file-scoped checklist items (logic + tests) before coding.

### 2) Continuation contract for "pending vs interrupted" tasks is not defined
Current behavior marks any non-terminal task with dead session + no `.DONE` + no worktree as `mark-failed` (`resume.ts:240-249`).

That currently includes tasks that were never started (future waves), and tests explicitly encode that outcome (`orch-state-persistence.test.ts:3652-3654`).

Step 1 must explicitly decide and document whether future-wave `pending` tasks should:
- remain pending for normal execution after resume, or
- be terminally failed during reconciliation.

Without this contract, mixed-repo continuation behavior is ambiguous and can produce surprising terminal counts.

### 3) Blocked/skipped determinism is not operationalized in the plan
The requirement says blocked/skipped semantics must remain deterministic, but the plan does not define counting/exclusion rules.

Current resume flow initializes counters from persisted state (`resume.ts:492-494`) **and** increments blocked counts again while iterating resumed waves (`resume.ts:831-836`), which can double-count on replayed waves.

Also, wave filtering excludes completed/failed/blocked only (`resume.ts:821-826`), while `computeResumePoint()` intentionally does not bucket persisted `skipped` tasks as completed/failed (`resume.ts:286-293`). Step 1 must define whether skipped tasks are replayable or terminal-for-resume and keep that deterministic.

### 4) Test plan for Step 1 is missing
Existing Step 0 additions are mostly reconciliation-focused; they do not lock continuation determinism for blocked/skipped counters or resume-wave pruning.

`orch-direct-implementation.test.ts` only has a narrow `mark-failed` pending assertion (`orch-direct-implementation.test.ts:52-63`).

Step 1 needs an explicit test matrix for:
- blocked task count behavior across resume (no double counting),
- skipped task replay/non-replay contract,
- mixed-repo wave continuation where one repo has reconnect/re-execute and another has blocked/skipped outcomes,
- v1 fallback parity for any Step 1 logic changes.

## Required plan updates before implementation
1. Expand Step 1 in `STATUS.md` into concrete checklist items per file (`resume.ts`, and tests).
2. Add an explicit continuation-state contract table for actions/statuses (`mark-complete`, `mark-failed`, `reconnect`, `re-execute`, `skip`) showing:
   - whether task is considered wave-complete,
   - whether task is pending for execution,
   - whether task contributes to terminal counters.
3. Define deterministic blocked/skipped counter rules on resume (especially how persisted counters interact with resumed-wave recounting).
4. Add a Step 1 test matrix covering blocked/skipped determinism and mixed-repo continuation cases.

## Non-blocking note
- Prior Step 0 code review findings about repo-root collection parity (`collectRepoRoots` helper vs in-loop root collection) are still relevant for continuation/cleanup quality and should remain visible as follow-up while Step 1/2 proceed.
