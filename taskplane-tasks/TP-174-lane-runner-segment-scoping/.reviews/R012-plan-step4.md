## Plan Review: Step 4: Sidecar Telemetry Update

### Verdict: REVISE

### Summary
The plan correctly targets segment-scoped progress emission (and legacy fallback) at the runtime snapshot source, but it still does not satisfy a required Step 4 outcome: the dashboard progress bar must show segment-scoped checked/total. As written, the plan explicitly marks dashboard wiring as out of scope, which leaves operator-visible progress unchanged. This is the same blocking gap previously raised in R011 and it remains unaddressed.

### Issues Found
1. **[Severity: important]** Required outcome is explicitly deferred. `PROMPT.md` Step 4 requires: “Dashboard progress bar should reflect current segment's checked/total, not full task,” but the current plan states dashboard wiring is out of scope and only updates `emitSnapshot()` in `lane-runner.ts`. In the current flow, task progress is still rendered from `task.statusData` (full `STATUS.md` counts), so this plan will not achieve the step’s stated result. **Suggested fix:** add an explicit outcome to wire dashboard progress consumption to segment-scoped runtime progress (e.g., prefer V2 snapshot progress for active running task/segment), with fallback to existing full-task parsing when markers/snapshot progress are unavailable.

### Missing Items
- Explicit plan item for dashboard consumption path update so displayed progress uses segment-scoped values during segment execution.
- Verification intent for a live multi-segment scenario proving the progress cell changes from full-task counts to active-segment counts.

### Suggestions
- If `lane-runner.ts` is the true source of segment-scoped telemetry, keep that implementation direction, but document clearly why `sidecar-telemetry.ts` itself is unchanged.
- Add one regression check confirming legacy tasks (no segment markers) still show full-task progress behavior.
