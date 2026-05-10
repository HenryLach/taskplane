## Plan Review: Step 1: Plan all three sub-fix designs

### Verdict: REVISE

### Summary
The Step 1 plan is strong for #538 and #540: it identifies the right interception points, distinguishes `supervisor_takeover` from `orch_abort`, and defines practical alert/fallback behavior. However, the #539 reconstruction design is still not execution-safe as written. Two parts would likely force repeated fail-loud outcomes (instead of successful reattach) or change resume semantics in ways that can violate dependency ordering.

### Issues Found
1. **[Severity: important]** — The proposed “minimal valid `PersistedBatchState`” is not actually valid against current schema validation (`STATUS.md:93-106` vs `persistence.ts:553-580, 603-649, 694-752, 961-1015, 1075-1080`). Examples: `diagnostics = null` is explicitly invalid; required top-level fields like `updatedAt`, `blockedTaskIds`, `errors`, and `segments` are not listed; task/lane records are missing required fields (`doneFileFound`, `exitReason`, `laneId`, `branch`, etc.). **Suggested fix:** revise the plan to reconstruct a full validator-compliant state shape (with deterministic defaults), then validate and persist; fail-loud only when required reconstruction artifacts are missing/corrupt.
2. **[Severity: important]** — Flattening reconstructed `wavePlan` to a single wave (`STATUS.md:106`) can violate DAG execution order on resume. `resume.ts` executes directly from persisted `wavePlan` (`resume.ts:655-670, 1819-1838`), so this can run formerly later-wave dependents too early. **Suggested fix:** reconstruct wave topology from preserved artifacts when available (history/runtime lane data), and if topology cannot be recovered safely, fail loudly with actionable guidance instead of flattening.

### Missing Items
- Explicit source-of-truth plan for reconstructing `orchBranch`/`baseBranch` in #539 (the persisted schema and merge/retry flow depend on both).

### Suggestions
- For #539, consider a dedicated helper that returns `{ state, selectionNote }` only after building a fully schema-valid object, so `resumeOrchBatch` stays simple and deterministic.
