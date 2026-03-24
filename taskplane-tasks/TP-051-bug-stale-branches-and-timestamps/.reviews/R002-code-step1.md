## Code Review: Step 1 — Delete stale task/saved branches after integrate

### Verdict: **REVISE**

### Summary
Good progress overall: manual `/orch-integrate` now cleans stale `task/*` and `saved/task/*` refs and includes better visibility; acceptance scanning also now detects `saved/task/*` leftovers.

However, one important path still leaves stale branches behind: **supervisor auto-integration in PR mode**.

---

### Findings

1. **[Severity: important] Auto PR integration path still skips stale-branch cleanup**

- In `buildIntegrationExecutor()`, stale-branch cleanup only runs when `result.integratedLocally` is true:
  - `extensions/taskplane/extension.ts:963-968`
- For PR mode, `executeIntegration()` returns `integratedLocally: false`, so this cleanup block is skipped.
- In supervisor auto mode, PR flows are common (branch protection / unknown protection):
  - `extensions/taskplane/supervisor.ts:413-456`
- That PR flow then goes through `handlePrLifecycle()`, which deletes batch state + orch branch after merge, but does **not** call stale lane/saved branch cleanup:
  - `extensions/taskplane/supervisor.ts:740-820`, `981-1000`

**Impact:** Issue #142 remains for auto/supervisor PR integrations (stale `task/*` and `saved/task/*` refs can accumulate).

**Suggested fix:** Ensure stale-branch cleanup runs for PR path too (without deleting `orch/*`). For example, run `deleteStaleBranches(...)` in `buildIntegrationExecutor()` on successful PR creation as well, or add equivalent cleanup in PR lifecycle completion.

---

### Validation Performed

- `git diff 710a3fcd2d5d8a002c2de9b2979d79daa09032c2..HEAD --name-only`
- `git diff 710a3fcd2d5d8a002c2de9b2979d79daa09032c2..HEAD`
- Read changed files in full:
  - `extensions/taskplane/extension.ts`
  - `extensions/taskplane/worktree.ts`
  - `extensions/taskplane/persistence.ts`
- Neighbor consistency checks:
  - `extensions/taskplane/supervisor.ts`
  - `extensions/taskplane/messages.ts`
  - `extensions/taskplane/index.ts`
- Test run:
  - `cd extensions && npx vitest run` ✅ (55 files, 2284 tests passed)

---

### Notes
- The manual `/orch-integrate` path improvements are solid (cleanup invocation + saved-lane acceptance detection).
- Once the auto-PR gap is closed, this step should be in much better shape.