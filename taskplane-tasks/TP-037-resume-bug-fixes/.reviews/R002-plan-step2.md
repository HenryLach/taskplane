## Plan Review: Step 2: Fix Stale Session Names (Bug #102b)

### Verdict: REVISE

### Summary
The planned Precedence-5 relaxation is directionally correct for bug #102b, but the plan is missing one critical persistence detail needed to actually clear stale metadata. In the current code, both `sessionName` and `laneNumber` are re-derived during serialization from lane assignments/fallback logic, so a reconciliation-only change can appear to work in-memory but still write stale values back to state.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly handle serialization fallback behavior that can reintroduce stale fields after reconciliation. `serializeBatchState()` writes `laneNumber` from lane mapping (`extensions/taskplane/persistence.ts:1015`) and writes `sessionName` via `outcome?.sessionName || lane?.tmuxSessionName || ""` (`extensions/taskplane/persistence.ts:1016`). Resume also seeds lanes from persisted lane records before the first checkpoint (`extensions/taskplane/resume.ts:1241`), and outcomes are initially built from persisted task session names (`extensions/taskplane/resume.ts:1274`). **Suggested fix:** add an explicit plan item for how stale-pending tasks are removed from lane attribution and how cleared session names are preserved through serialization (e.g., no `||` fallback for explicitly-cleared values, and/or pruning stale tasks from reconstructed lane task lists).

### Missing Items
- Explicit outcome-level step describing **where** stale `sessionName`/`laneNumber` are cleared so persisted checkpoints (`resume-reconciliation` and later) do not rehydrate stale values.

### Suggestions
- In Step 3 tests, add an assertion on the persisted state after reconciliation/checkpoint (not only action classification) to verify stale-pending tasks have cleared `sessionName` and `laneNumber`.
