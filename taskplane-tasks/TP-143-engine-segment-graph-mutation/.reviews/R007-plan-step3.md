## Plan Review: Step 3: DAG mutation with successor rewiring

### Verdict: REVISE

### Summary
The Step 3 plan covers the core mutation mechanics (roots/sinks rewiring, repeat-repo IDs, re-topology, and frontier map updates), but it misses one execution-critical outcome: ensuring newly inserted segments are actually scheduled after mutation. In the current engine, segment rounds are precomputed from the original segment counts, so expansion can increase `orderedSegments` without guaranteeing additional execution opportunities. Without explicitly planning for that, Step 3 can complete “mutation” but fail to run expanded segments.

### Issues Found
1. **[Severity: important]** — The Step 3 checklist in `STATUS.md:45-50` does not include how expanded segments remain schedulable after insertion. Today, segment waves are built once from initial plans (`engine.ts:643-700`), captured as `rawWaves` (`engine.ts:1698`), and iterated with a fixed upper bound (`engine.ts:1779`). If Step 3 adds segments, a task can exhaust its preplanned rounds before reaching new pending segments. Suggested fix: add an explicit Step 3 outcome to keep the task eligible until its mutated frontier reaches terminal status (while preserving the spec contract that `wavePlan`/`totalWaves` are not mutated).

### Missing Items
- Add explicit Step 3 outcome: **post-mutation scheduling continuity** (new pending segments created by expansion must be executed, not just stored in `orderedSegments`).
- Add explicit test intent for that outcome (e.g., a task that initially had one segment expands after completion and still runs the new segment(s) in subsequent execution rounds).

### Suggestions
- Clarify `end` placement behavior for multi-root inserts in the plan text (the prompt requires edges from current terminals to `roots(N)`; making this explicit avoids ambiguous implementation choices).
- Preserve deterministic re-topology tie-breaks (stable sort by existing order/segmentId) so replay and tests remain predictable.
