## Plan Review: Step 4: Sidecar Telemetry Update

### Verdict: REVISE

### Summary
The plan captures the core telemetry-side intent (segment-scoped checked/total with legacy fallback), but it currently stops short of a required outcome: making the dashboard progress bar actually reflect that segment-scoped data. In the current code path, dashboard task progress is still sourced from full-task `STATUS.md` parsing, so changing `emitSnapshot()` alone will not update what operators see. Add an explicit wiring outcome for dashboard consumption and corresponding tests.

### Issues Found
1. **[Severity: important]** Missing outcome: dashboard progress bar consumption path is not covered. The plan assumes updating `emitSnapshot()` is sufficient, but dashboard rendering currently uses `task.statusData` from `parseStatusMd()` in `dashboard/server.cjs` (full-task checkbox counts) and renders that in `dashboard/public/app.js`; `v2snap.progress` is attached as `_v2Progress` but not used for the progress cell. **Suggested fix:** add an outcome to wire segment-scoped runtime progress into displayed task progress (e.g., prefer snapshot progress for active running task/lane), or make dashboard-side STATUS parsing segment-aware with repo/segment context.

### Missing Items
- Explicit plan item ensuring the UI progress bar path consumes the segment-scoped telemetry data (not just emits it).
- Targeted verification for multi-segment running task that displayed `checked/total` changes from full-task to active-segment scope.

### Suggestions
- Keep the Step 4 implementation in `lane-runner.ts` if that is truly the canonical source of dashboard progress, but explicitly document why `sidecar-telemetry.ts` is unchanged to avoid future confusion.
- Add one regression test for legacy tasks without segment markers to confirm dashboard progress remains unchanged.
