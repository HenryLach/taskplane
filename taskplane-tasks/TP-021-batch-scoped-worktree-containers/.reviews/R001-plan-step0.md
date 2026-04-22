## Plan Review: Step 0: Preflight

### Verdict: REVISE

### Summary
The Step 0 plan covers core files, but it misses at least one runtime path that is directly affected by worktree listing/cleanup changes. As written, preflight can be marked complete without producing a durable caller inventory, which increases the risk of regressions in resume flows and compatibility behavior. Tightening Step 0 outcomes now will make Steps 1–3 much safer.

### Issues Found
1. **[Severity: important]** — `resume.ts` is a real caller of the APIs being refactored (`listWorktrees()` at `extensions/taskplane/resume.ts:1295`, `removeAllWorktrees()` at `extensions/taskplane/resume.ts:1323`), but it is not explicitly included in Step 0 scope (`STATUS.md:16-20`). Suggested fix: add `resume.ts` to preflight review scope and caller map before implementation proceeds.
2. **[Severity: important]** — “Identify all callers” (`STATUS.md:20`) has no required output artifact, so Step 0 can be checked off without preserving findings. Suggested fix: require a discovery entry/table in `STATUS.md` listing each caller (runtime + tests), expected change needed, and whether behavior must remain backward-compatible.
3. **[Severity: minor]** — The task requires transition compatibility for old/new worktree naming (`PROMPT.md:152`), but Step 0 does not explicitly include preflight validation of tests that encode current naming assumptions (notably `extensions/tests/worktree-lifecycle.test.ts` and `extensions/tests/naming-collision.test.ts`). Suggested fix: include these tests in the preflight inventory and note which assertions will need migration.

### Missing Items
- Explicit preflight scope item for `extensions/taskplane/resume.ts` (resume/reset/cleanup parity with `engine.ts`).
- Explicit Step 0 deliverable: persisted caller inventory in `STATUS.md` discoveries.
- Explicit compatibility preflight note covering legacy `listWorktrees()` discovery behavior during transition.

### Suggestions
- Add a grep checkpoint in Step 0 for `generateWorktreePath(`, `listWorktrees(`, and `removeAllWorktrees(` and log the exact matches in `STATUS.md`.
- Mark each caller as runtime-critical vs test-only to prioritize safe rollout in Step 3.
