## Plan Review: Step 3: Escalation Interface

### Verdict: REVISE

### Summary
The Step 3 checklist captures the right intent, but it is currently too generic to guarantee the required escalation behavior in this codebase. In particular, it does not account for the existing Tier 0 event schema constraints or for the multiple distinct retry-exhaustion paths already present in `engine.ts`. Add those explicit outcomes so Step 3 can reliably emit `tier0_escalation` events without missing branches.

### Issues Found
1. **[Severity: important]** — The plan does not include updating the Tier 0 event schema/emit contract to support a new `tier0_escalation` event.
   - Evidence: Step 3 plan is currently only three generic items (`taskplane-tasks/TP-039-tier0-watchdog-integration/STATUS.md:51-53`), while `emitTier0Event()` currently accepts `Tier0EventType` that only includes `tier0_recovery_attempt|success|exhausted` (`extensions/taskplane/persistence.ts:1635-1638`).
   - Suggested fix: Add a plan outcome to extend event typing/serialization so `tier0_escalation` is a first-class event (with typed escalation payload), then emit through the shared persistence utility.

2. **[Severity: important]** — The plan does not explicitly require escalation emission at all existing exhaustion points, so implementation can easily be partial.
   - Evidence: Exhaustion handling is currently spread across multiple branches in `engine.ts` (e.g., worker crash `:110/:233/:254`, stale worktree `:324/:744`, merge timeout `:1128/:1155`, cleanup gate `:1440/:1463`). A generic “emit escalation event on retry exhaustion” checkbox does not ensure full coverage.
   - Suggested fix: Add a plan outcome to wire escalation emission for each Tier 0 exhaustion/safe-stop path (or centralize with one helper used by all of them).

### Missing Items
- Explicit outcome to extend Tier 0 event type/schema for `tier0_escalation` (including `EscalationContext` payload shape).
- Explicit outcome to cover all exhaustion emit sites (worker crash, stale worktree, cleanup gate, merge timeout exhausted/safe-stop).

### Suggestions
- Build a small `buildEscalationContext(...)` helper in `engine.ts` to keep emitted context consistent across patterns.
- Keep existing `tier0_recovery_exhausted` events and add `tier0_escalation` alongside them, so current observability remains backward-compatible while introducing the supervisor-facing interface.
