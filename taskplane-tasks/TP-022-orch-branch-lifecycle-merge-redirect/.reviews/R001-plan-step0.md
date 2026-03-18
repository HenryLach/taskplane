## Plan Review: Step 0: Preflight

### Verdict: REVISE

### Summary
The preflight checklist covers the primary fresh-run files (`engine.ts`, `merge.ts`, `waves.ts`, `persistence.ts`) and dependency verification, which is a solid start. However, it misses resume-path parity analysis, which is critical for this task’s core invariant (“never touches the user’s current branch”). Without adding that to preflight, later steps are likely to update only the non-resume path.

### Issues Found
1. **[Severity: important]** — `STATUS.md:16-20` scopes preflight to four files and omits `resume.ts`, but resume currently routes merge/reset/cleanup through `baseBranch` at `extensions/taskplane/resume.ts:905`, `:1069`, `:1184`, `:1297`, and `:1317`. Add a preflight item to audit resume branch routing and define which call sites must switch to `orchBranch`.
2. **[Severity: minor]** — Preflight has no explicit test-surface mapping, so implementation may miss coverage for resumed-batch behavior. Add a preflight item to identify impacted tests (at minimum merge + persistence + resume regression suites) before coding.

### Missing Items
- Resume-path parity check (`resume.ts`) for worktree base branch, merge target, reset target, and cleanup target.
- Preflight compatibility note for persisted states where `orchBranch` can be empty (`persistence.ts` defaulting/upconvert path).
- Explicit preflight test intent for resumed batches (not just fresh `/orch` execution).

### Suggestions
- Record a Step 0 discovery table entry listing all `baseBranch` call sites and the intended `orchBranch` migration decision.
- Include `messages.ts` in preflight reads since Step 4 requires completion-message changes.
