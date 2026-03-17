## Code Review: Step 4: Thread Through Dashboard

### Verdict: APPROVE

### Summary
The Step 4 change is scoped and consistent with the project’s resolved pointer contract: dashboard runtime artifacts continue to resolve from `<REPO_ROOT>/.pi/`, and no pointer-based path rewrite was introduced for state files. I verified all relevant dashboard `.pi` call sites still use `REPO_ROOT` and ran the test suite successfully (`extensions`: 608/608 passing).

### Issues Found
1. **[dashboard/server.cjs:31,644] [minor]** — The new comment says the dashboard “only reads state files,” but the server also reads task `STATUS.md` files via `serveStatusMd()`/`parseStatusMd()`. Suggested fix: reword to “dashboard does not resolve config/agent files via pointer; it reads runtime state under `<REPO_ROOT>/.pi/` and task status files from task folders.”

### Pattern Violations
- None.

### Test Gaps
- No dashboard-focused automated test was added for workspace launch-root assumptions (`--root` passed from CLI cwd). Not blocking for this comment-only step, but still an uncovered behavior contract.

### Suggestions
- Consider adding a small integration test (or smoke script) that starts dashboard with a workspace root and validates `/api/state` + `/api/status-md/:taskId` resolution paths in workspace mode.
