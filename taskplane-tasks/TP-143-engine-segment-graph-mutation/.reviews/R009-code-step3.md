## Code Review: Step 3: DAG mutation with successor rewiring

### Verdict: APPROVE

### Summary
This implementation delivers the Step 3 outcomes: it adds formal DAG mutation with roots/sinks rewiring, repeat-repo segment ID disambiguation, deterministic re-topology, and frontier-state updates. It also addresses the blocking concern I raised in R007 by adding runtime continuation-round scheduling so expanded pending segments stay executable. The new unit coverage exercises core mutation paths and the continuation helper, and I did not find blocking correctness issues for this step.

### Issues Found
1. **[extensions/taskplane/engine.ts:2010,2127,2820] [minor]** — Wave-total reporting is now inconsistent across lifecycle messages/events (`orchStarting` uses `rawWaves.length`, while wave start and merge success use `runtimeSegmentRounds.length`). This can produce confusing operator output (e.g., initial 2 waves, later reporting 3). Suggested fix: either keep all user-facing totals anchored to `batchState.totalWaves` (spec contract), or introduce a separate explicit field/name for runtime continuation rounds.

### Pattern Violations
- None observed.

### Test Gaps
- No direct fan-out rewiring test yet for `after-current` (e.g., `A → {B,C}` + `X` after `A` should become `A → X → {B,C}`).
- No direct test for multiple expansion requests at the same boundary to validate deterministic ordering across sequential mutations.
- Continuation scheduling is tested at helper level, but not yet at `executeOrchBatch` integration level with real frontier mutation and subsequent round execution.

### Suggestions
- Add a compact table-driven test block for rewiring shapes (linear, fan-out, multi-root end-placement) to lock in graph semantics.
- Consider asserting continuation insertion idempotency in tests (no duplicate insertion when task already exists in a future round).
