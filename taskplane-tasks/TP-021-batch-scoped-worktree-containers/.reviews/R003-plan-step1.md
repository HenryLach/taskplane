## Plan Review: Step 1: Refactor Worktree Path Generation

### Verdict: REVISE

### Summary
The Step 1 plan captures the main refactor goals (lane path format, merge path helper, and container creation), but it is missing two important implementation constraints that protect existing behavior. In particular, the checklist no longer explicitly guards `worktree_location` mode behavior or shared base-path logic for the new merge helper. Tightening those outcomes now will reduce the chance of a sibling/subdirectory regression.

### Issues Found
1. **[Severity: important]** — `STATUS.md:30-33` omits an explicit requirement that `generateWorktreePath()` continues to derive its base directory through `resolveWorktreeBasePath()` (`extensions/taskplane/worktree.ts:45-55`), even though this is required in `PROMPT.md:72` and validated later in `PROMPT.md:112`. Suggested fix: add a Step 1 checklist item that explicitly preserves `worktree_location` semantics (sibling vs subdirectory) via `resolveWorktreeBasePath()`.
2. **[Severity: important]** — The plan adds `generateMergeWorktreePath()` (`STATUS.md:31`) but does not require it to be config-aware and base-path-consistent with lane worktrees. Without that constraint, it can regress to hardcoded `.worktrees` behavior like current `merge.ts:572`, violating the mode-compat requirement (`PROMPT.md:110-113`). Suggested fix: specify that `generateMergeWorktreePath()` must use the same base-path resolution flow as lane paths (repoRoot + config) and produce `{basePath}/{opId}-{batchId}/merge`.
3. **[Severity: minor]** — Step 1 says “Update `CreateWorktreeOptions`” (`STATUS.md:32`), but `batchId` is already present in `extensions/taskplane/types.ts:227-231`. Suggested fix: clarify this as a verification-only item (no schema churn unless a concrete gap is found).

### Missing Items
- Explicit Step 1 risk mitigation for signature transition of `generateWorktreePath()` used in tests (`extensions/tests/naming-collision.test.ts:111`, `extensions/tests/worktree-lifecycle.test.ts:246`), i.e., whether to keep a temporary compatibility signature or update callers in lockstep.
- Explicit requirement that container creation logic applies to the shared batch container path used by both lane and merge worktrees.

### Suggestions
- Add a small shared helper for batch container path construction (e.g., `{basePath}/{opId}-{batchId}`) and have both `generateWorktreePath()` and `generateMergeWorktreePath()` build from it.
- Update Step 1 checklist wording to separate “type verification” from “behavioral change” items to keep implementation focused.
