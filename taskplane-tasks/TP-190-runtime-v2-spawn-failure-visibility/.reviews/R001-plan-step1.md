## Plan Review: Step 1: Plan all four parts of the fix

### Verdict: APPROVE

### Summary
The Step 1 plan is strong and directly addresses the root cause described in #561: `executeWave` hangs because monitor termination depends on lane snapshots that never exist when spawn fails early. The proposed design covers all four required parts (state transition/alerting, no-retry behavior, phase transition, and regression testing) with concrete insertion points and clear rationale for choosing `failed` over `paused` for all-lane spawn failures. I also agree with the explicit decision to avoid adding a redundant outer catch in `executeWave` and instead fix downstream propagation.

### Issues Found
1. **[Severity: minor]** — No blocking gaps found for this step.

### Missing Items
- None.

### Suggestions
- When writing the synthetic terminal lane snapshot in `executeLaneV2`'s catch, prefer emitting the full `RuntimeLaneSnapshot` shape (not only minimal fields) so dashboard consumers remain robust and schema-consistent.
- As a parity check during implementation, quickly confirm whether resumed execution paths (`resume.ts`) should also include `context.exitCategory` in `task-failure` alerts, to keep supervisor routing behavior consistent across `/orch` and `/orch-resume`.
