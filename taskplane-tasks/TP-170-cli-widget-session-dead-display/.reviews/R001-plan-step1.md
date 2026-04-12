## Plan Review: Step 1: Fix Wave-Aware Lane Display

### Verdict: REVISE

### Summary
The Step 1 plan is close and correctly targets the two primary symptoms (stale wave monitor data and false `session dead` rendering). However, it does not explicitly include the required session-name matching fix between widget/runtime lane identity and the V2 registry identity model, which is called out in the task prompt and Step 0 discoveries. Without that explicit outcome, the implementation can still regress in workspace mode where local lane session IDs differ from registry agent IDs.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly include the required **session name matching** fix (`PROMPT.md` Step 1 requirement: “Fix session name matching between widget and V2 process registry”). Current items focus on stale monitor fallback and card rendering logic, but a missing identity-normalization/lookup step can leave active lanes unresolved and still produce `waiting for data`/`session dead` artifacts. Add a dedicated outcome item for registry identity reconciliation (including workspace lane numbering/name differences).

### Missing Items
- Explicit Step 1 outcome: normalize/reconcile widget lane identity to V2 registry agent identity (or equivalent lookup bridge) so liveness/progress resolution is correct in workspace mode.
- Targeted-test intent should explicitly cover identity mismatch paths (e.g., workspace local lane ID vs registry global lane ID) in addition to wave-transition stale monitor data.

### Suggestions
- Keep your existing stale-monitor and lane-card reconciliation items, but tie them to a clear rule: only treat a lane as dead when the lookup path is identity-resolved for the current wave.
- In tests, include three concrete assertions: (1) prior-wave lane is hidden or succeeded, (2) active lane shows task/step/progress once telemetry appears, (3) startup/no-registry-entry lane does not render as failed.
