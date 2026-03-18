## Plan Review: Step 0: Preflight

### Verdict: REVISE

### Summary
The Step 0 checklist covers core fresh-run files and dependency checks, so the baseline direction is good. However, it does not include a resume-path audit, which is a high-risk gap for this task because the main behavioral change is branch-target routing. Add resume parity and test-surface mapping to preflight before implementation proceeds.

### Issues Found
1. **[Severity: important]** — `taskplane-tasks/TP-022-orch-branch-lifecycle-merge-redirect/STATUS.md:16-20` omits `extensions/taskplane/resume.ts` from preflight scope. Resume currently routes key operations via `baseBranch` (`extensions/taskplane/resume.ts:905`, `1069`, `1184`, `1297`, `1317`), so updating only `engine.ts`/`merge.ts` risks violating the “user branch never touched” objective on resumed batches. **Fix:** add explicit preflight audit of resume call sites and intended `orchBranch` routing.
2. **[Severity: important]** — Preflight lacks explicit test-impact inventory for branch-routing behavior changes. Existing tests currently encode today’s `resolveBaseBranch` assumptions (e.g., `extensions/tests/waves-repo-scoped.test.ts:9,112-127`, `extensions/tests/polyrepo-regression.test.ts:322-327`) and may require coordinated updates. **Fix:** add a Step 0 item to map impacted suites (fresh run + resume + merge + persistence).

### Missing Items
- Resume-path parity check (`resume.ts`) for execute, merge, post-merge reset, and cleanup branch targets.
- Preflight note on backward compatibility when persisted state has empty `orchBranch` (defaulted in `extensions/taskplane/persistence.ts:369-378`).
- Explicit resumed-batch test intent, not just fresh `/orch` execution.

### Suggestions
- Add a Step 0 discovery entry listing all current `baseBranch` branch-target call sites and the migration decision per site.
- Include `extensions/taskplane/messages.ts` in preflight reading since Step 4 plans completion-message changes.
