## Plan Review: Step 1: Fix Wave-Aware Lane Display

### Verdict: APPROVE

### Summary
The revised Step 1 plan now covers the previously missing identity reconciliation outcome and directly targets all required behaviors from the prompt. It addresses stale wave monitor data, workspace lane-to-registry identity matching, dead-vs-not-yet-started handling, and lane-card rendering semantics needed to eliminate false `session dead` / `waiting for data` states. The targeted test intent is also aligned with the key regressions and edge cases discovered in Step 0.

### Issues Found
1. **[Severity: minor]** — No blocking issues found.

### Missing Items
- None.

### Suggestions
- In targeted tests, include one explicit assertion that prior-wave lanes are either hidden or shown as succeeded (not failed), to lock in the wave-transition UI contract.
- If practical, include a narrow test that verifies task ID + step + progress all render together for an active lane once telemetry resolves.
