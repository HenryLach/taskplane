## Plan Review: Step 1: Detect and Save Partial Progress

### Verdict: REVISE

### Summary
The Step 1 plan is directionally correct and aligned with the roadmap intent (save failed-task branch progress before cleanup). However, it still misses a few non-obvious failure-path outcomes that are necessary to guarantee no progress loss in real runs, especially across resume/workspace flows. Tightening those items now will reduce rework in Step 2/3.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly require wiring the save logic into **both terminal cleanup paths** (`extensions/taskplane/engine.ts:726` and `extensions/taskplane/resume.ts:1410`). The notes mention these insertion points, but Step 1 checkboxes/artifacts do not commit to implementing both; add this as a required outcome so repo mode + resume/workspace terminal cleanup are both covered.
2. **[Severity: important]** — No collision/idempotency handling is called out for deterministic saved branch names. Because the naming format is fixed (`saved/{opId}-{...}`), reruns/resume can hit an existing ref; plan should explicitly reuse or mirror existing collision logic (`extensions/taskplane/worktree.ts:1026-1130`) instead of a raw `git branch` create that can fail.
3. **[Severity: important]** — Failure-safe behavior is not specified for git-count/save errors. If `rev-list`/branch-create fails, the plan should define a safe default that does **not** allow silent progress loss (e.g., retain lane branch and emit explicit warning), consistent with branch-protection intent in `extensions/taskplane/worktree.ts:809-840`.

### Missing Items
- Explicit Step 1 outcome for “save failed/unknown → do not delete source lane branch.”
- Test coverage intent (can be in Step 3) for branch-collision/idempotency and git-command failure paths, not only happy paths.
- Alignment between stated insertion points in notes and Step 1 artifact scope (currently only `worktree.ts` listed, but call-site wiring is required).

### Suggestions
- Add one Step 1 checkbox per terminal flow: engine final cleanup + resume final cleanup.
- Add a short “error policy” note in STATUS for count/save failures to keep behavior deterministic.
