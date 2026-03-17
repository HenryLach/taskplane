## Plan Review: Step 4: Thread Through Dashboard

### Verdict: REVISE

### Summary
The Step 4 plan is currently too coarse to execute safely. The single checklist item does not preserve the already-established pointer contract (pointer for config/agents, workspace root for runtime state), and it does not define how dashboard path resolution will be updated across all relevant call sites. Tightening the outcomes now will prevent partial or contradictory behavior in workspace mode.

### Issues Found
1. **[Severity: important]** — `taskplane-tasks/TP-016-pointer-file-resolution-chain/STATUS.md:65` (“Dashboard follows pointer for state and STATUS.md”) conflicts with the task’s own invariant that runtime state/sidecar files never follow pointer (`STATUS.md:57`, `STATUS.md:208`). **Fix:** split the outcome into: (a) dashboard runtime files remain under `<workspaceRoot>/.pi/`, and (b) pointer is used only where needed for config-repo-derived task path/STATUS resolution.
2. **[Severity: important]** — The plan does not identify the full dashboard path surface that currently hardcodes `REPO_ROOT/.pi`, risking incomplete wiring. Affected call sites include lane state loading (`dashboard/server.cjs:194`), conversation logs (`dashboard/server.cjs:381`), batch/history paths (`dashboard/server.cjs:635-636`), and watch path setup (`dashboard/server.cjs:650-657`). **Fix:** add an explicit outcome to compute/centralize resolved dashboard roots once, then thread them consistently through all readers/watchers.
3. **[Severity: important]** — No explicit workspace/repo mode and pointer-failure behavior is specified for dashboard, even though the task contract requires workspace-only pointer logic with warn+fallback semantics (`STATUS.md:207-210`). **Fix:** add outcome-level requirements for repo-mode parity and non-fatal handling of missing/malformed/unknown pointer (warn + fallback).

### Missing Items
- Step 4 test/verification intent for dashboard-specific behavior:
  - workspace mode + valid pointer
  - workspace mode + missing/malformed/unknown pointer (fallback)
  - repo mode unchanged
  - `/api/status-md/:taskId` still resolves active + archived `STATUS.md` paths correctly
- Clarification of launch-root assumptions (`bin/taskplane.mjs:2310-2318` currently passes `--root` as cwd) and how dashboard should behave when invoked outside workspace root.

### Suggestions
- Add a small dashboard-local resolver helper (for pointer + fallback) so all `.pi` path decisions come from one place.
- Keep warning behavior operator-visible but non-fatal (single warning per process to avoid log spam).
