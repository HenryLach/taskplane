# R007 — Plan Review (Step 3: Testing & Verification)

## Verdict
**Changes requested**

## What I reviewed
- `taskplane-tasks/TP-004-repo-scoped-lane-allocation-and-worktrees/PROMPT.md`
- `taskplane-tasks/TP-004-repo-scoped-lane-allocation-and-worktrees/STATUS.md`
- Prior code review outcome: `.reviews/R006-code-step2.md`
- Relevant tests:
  - `extensions/tests/waves-repo-scoped.test.ts`
  - `extensions/tests/external-task-path-resolution.test.ts`
  - `extensions/tests/worktree-lifecycle.test.ts`

## Findings

### 1) **Blocking**: Step 3 plan is not hydrated enough for Review Level 3
`STATUS.md` Step 3 currently contains only four prompt-level checkboxes (`STATUS.md:127-133`).
For this task size/blast radius, Step 3 needs a concrete execution plan (exact commands, order, pass/fail gates, and remediation path), not just headings.

### 2) **Blocking**: Plan does not resolve the prompt’s **zero-failure** requirement against known failing baseline
Prompt is explicit: “ZERO test failures allowed” (`PROMPT.md:82-87`).
But STATUS still carries “4 pre-existing failures, not blocking” from prior steps (`STATUS.md:95,123,167`).

Current full-suite run still fails in 4 files:
- `tests/orch-direct-implementation.test.ts`
- `tests/orch-pure-functions.test.ts`
- `tests/orch-state-persistence.test.ts`
- `tests/task-runner-orchestration.test.ts`

Without an explicit plan to fix or formally unblock these, Step 3 cannot be completed per prompt criteria.

### 3) **Major**: Missing targeted verification plan for unresolved Step 2 review findings
R006 is still “Changes requested” and calls out:
- multi-repo cleanup remains single-repo scoped,
- missing test coverage for `executeWave(..., workspaceConfig?)` threading.

Step 3 plan should explicitly include targeted tests (and expected fixes) for these before final full-suite verification.

## Required updates before approval
1. Expand Step 3 in `STATUS.md` into a concrete checklist with command-level granularity, including:
   - targeted tests for TP-004 touched modules,
   - full-suite run,
   - CLI smoke (`node bin/taskplane.mjs help`).

2. Add a clear **failure policy** aligned to `PROMPT.md`:
   - either fix all failing suites,
   - or explicitly mark task blocked and record required external decision (waiver/scope adjustment).  
   “Pre-existing, not blocking” is incompatible with Step 3 completion as currently defined.

3. Add targeted verification items for R006 findings:
   - workspace-mode multi-repo cleanup behavior,
   - executeWave workspaceConfig threading through engine/resume.

4. Define evidence capture in STATUS for each Step 3 item:
   - exact command run,
   - pass/fail result,
   - if failed: root cause + disposition + follow-up action.

## Validation note
Targeted TP-004 tests currently pass when run directly:
- `npx vitest run tests/waves-repo-scoped.test.ts tests/external-task-path-resolution.test.ts tests/worktree-lifecycle.test.ts` ✅

But full-suite still fails, so Step 3 plan must explicitly handle that gap before approval.
