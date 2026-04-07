## Plan Review: Step 1 — Trace orch branch creation

### Verdict: APPROVE

### Summary
The plan identifies five well-chosen trace points across the orch branch lifecycle: creation in `engine.ts`, base-branch resolution fallback in `waves.ts`, merge target resolution, integration cleanup, and task file commit interaction. These cover the key code paths that could explain why api-service ended up with commits on `develop` instead of an orch branch.

### Issues Found
None blocking.

### Missing Items
None — the five trace points form a logical investigation flow covering creation → usage → merge → cleanup → side-effects.

### Suggestions
- When tracing `resolveBaseBranch` (item 2), also note how it's called per-repo group inside `allocateLanes` (waves.ts:~1233). If the orch branch was created but then somehow removed before wave 2's worktree provisioning, `resolveBaseBranch` would fall through to `getCurrentBranch(repoRoot)` (returning `develop`), which matches the observed symptom. This specific fallback path may be the most productive area to focus on.
- Consider also checking whether `workspaceConfig.repos` included api-service at batch start — if it was missing from the map, the `for...of` loop in engine.ts would skip it entirely (no error, just silently omitted).
