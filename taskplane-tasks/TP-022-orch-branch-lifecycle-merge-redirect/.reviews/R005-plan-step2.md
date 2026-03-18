## Plan Review: Step 2: Route Worktrees and Merge to Orch Branch

### Verdict: REVISE

### Summary
The plan captures the core engine-side routing outcomes for Step 2, but it is incomplete for resumability and compatibility. Right now it scopes changes to `engine.ts`/`waves.ts` only, while the same base-branch routing still exists in resume execution paths. Before implementation, expand the plan to include resume parity and explicit test intent so this change does not regress recoverability.

### Issues Found
1. **[Severity: critical]** — `taskplane-tasks/TP-022-orch-branch-lifecycle-merge-redirect/STATUS.md:45-47` omits `resume.ts` updates, even though Step 2 routing points are duplicated there (`STATUS.md:110-127`) and currently still pass/reset against `baseBranch` (`extensions/taskplane/resume.ts:898-905`, `1060-1069`, `1177-1184`, `1297-1299`). This risks split behavior between fresh and resumed batches, violating the task constraint to not break resume flow (`PROMPT.md:176`). **Fix:** add explicit Step 2 outcomes for resume parity (re-exec merge, wave execute/merge, inter-wave reset use `orchBranch`; keep cleanup targeting `baseBranch` for Step 4).
2. **[Severity: important]** — The plan does not define how to handle persisted states where `orchBranch` is empty/missing (`extensions/taskplane/persistence.ts:369-378`; runtime assignment currently allows empty string at `extensions/taskplane/resume.ts:615`). If Step 2 blindly routes to `orchBranch`, resume can pass an invalid branch name into worktree/merge flows. **Fix:** add a guard outcome (e.g., fail fast with clear message, or explicit compatibility fallback) before using `batchState.orchBranch` in resume/execution routing.
3. **[Severity: important]** — Step 2 has no concrete test coverage intent beyond generic Step 5 bullets (`STATUS.md:70-77`), despite multiple call-site migrations and repo/workspace mode branch-resolution behavior. **Fix:** add explicit Step 2 test intent for (a) engine execute/merge/reset routing to orch branch, (b) resume parity for the same routing points, and (c) `resolveBaseBranch()` behavior in repo vs workspace mode.

### Missing Items
- Resume-path routing parity checklist for `resume.ts` call sites discovered in Step 0.
- Explicit compatibility decision for empty `orchBranch` in loaded persisted state.
- Step-specific test scenarios tied to the migrated routing call sites.

### Suggestions
- Minor housekeeping: remove duplicate review row `R004` in `STATUS.md:96-97` to keep review history unambiguous.
