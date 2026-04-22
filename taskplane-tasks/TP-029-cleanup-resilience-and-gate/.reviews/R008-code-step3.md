## Code Review: Step 3: Integrate Cleanup into /orch-integrate

### Verdict: REVISE

### Summary
The Step 3 changes add useful cleanup primitives (`dropBatchAutostash`, `collectRepoCleanupFindings`) and a pure reporting function, and the new unit tests cover many helper-level scenarios well. However, there is a mode-handling regression in `/orch-integrate --pr`: the new cleanup acceptance flow treats the intentionally-preserved orch branch as stale and recommends deleting it. That breaks the PR-mode contract and needs to be fixed before approval.

### Issues Found
1. **[extensions/taskplane/extension.ts:1406-1452, extensions/taskplane/extension.ts:601-606] [important]** — Post-integration cleanup acceptance runs unconditionally after all modes, including `--pr`, and `collectRepoCleanupFindings()` always classifies `refs/heads/<orchBranch>` as stale. In PR mode, `executeIntegration()` explicitly says the branch is kept for the PR (`extensions/taskplane/extension.ts:460-467`), so this now produces contradictory output and manual cleanup commands (`git branch -D`) for expected state. **Fix:** gate cleanup acceptance by mode (or by `integratedLocally`) so PR mode either skips orch-branch checks entirely or uses a PR-specific acceptance profile that does not treat preserved orch branches as residual artifacts.
2. **[extensions/taskplane/extension.ts:1452] [minor]** — Cleanup-incomplete summaries are always emitted as `info`, even when `cleanupResult.clean === false`. This reduces operator visibility for residual artifacts. **Fix:** use `warning` (or `error`) notify level when cleanup is not clean.

### Pattern Violations
- The new behavior conflicts with the documented `/orch-integrate` contract that PR mode preserves the orch branch (`docs/reference/commands.md:373-374`).

### Test Gaps
- `extensions/tests/orch-integrate.test.ts` adds good helper-level coverage but does not cover the command-handler mode interaction where `--pr` should not be reported as cleanup-incomplete solely because the orch branch remains.
- No assertion currently verifies notification severity when cleanup findings are present.

### Suggestions
- Add one integration-style test around the `/orch-integrate` handler flow (or a factored orchestrator function) to lock mode-specific cleanup semantics (`ff/merge` vs `pr`).
- Consider including explicit remediation text for non-empty `.worktrees/` containers in `computeIntegrateCleanupResult()` (currently counted but no command guidance).
