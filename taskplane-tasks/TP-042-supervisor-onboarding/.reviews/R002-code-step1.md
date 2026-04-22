## Code Review: Step 1: /orch Routing Logic

### Verdict: REVISE

### Summary
The no-args `/orch` routing implementation is close, and the separation via `detectOrchState()` is a good direction. However, two routing decisions can produce incorrect state classification in real projects: config detection is not aligned with pointer-based config roots, and completed-batch routing does not verify that the stored orch branch still exists. Those issues can send users to onboarding/integration flows incorrectly.

### Issues Found
1. **[extensions/taskplane/extension.ts:1002-1008] [important]** — Config existence is checked only against `workspaceRoot/repoRoot/cwd`, but workspace mode can load config from `execCtx.pointer?.configRoot` (see `workspace.ts:579-581`). In pointer-based setups, this can misclassify configured projects as `no-config`, routing users into onboarding incorrectly.  
   **Fix:** Use the same resolution chain as config loading (prefer `execCtx.pointer?.configRoot` when present, then workspace/repo roots), or call a shared resolver that mirrors `resolveConfigRoot()` behavior before `hasConfigFiles()`.

2. **[extensions/taskplane/extension.ts:863-873] [important]** — The "completed batch needs integration" branch checks only `batchState.orchBranch` string presence, not actual branch existence. If state is stale (branch deleted/renamed), `/orch` no-args still routes to integration even though there is nothing to integrate.  
   **Fix:** Verify the branch exists (e.g., via `listOrchBranches()` membership or `git rev-parse refs/heads/<orchBranch>`) before returning `completed-batch`; otherwise continue to the remaining states.

### Pattern Violations
- Routing config detection currently diverges from the established config loading chain (pointer-aware resolution), creating inconsistent behavior between startup config loading and `/orch` state routing.

### Test Gaps
- No direct tests cover `detectOrchState()` precedence/branch conditions.
- No `/orch` no-args tests cover workspace pointer config roots.
- No test covers the stale `batchState.orchBranch` case (state says completed, branch missing).

### Suggestions
- Add focused unit tests for `detectOrchState()` with dependency injection (especially pointer-config + stale-branch cases).
- Consider a small helper for routing roots (`stateRoot`, `repoRoot`, `configRoot`) to keep no-args routing consistent with existing workspace/repo conventions.
