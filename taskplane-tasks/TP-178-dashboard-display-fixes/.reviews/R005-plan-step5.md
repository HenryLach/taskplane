## Plan Review: Step 5: Fix merge agent telemetry duplicated across all waves (#498)

### Verdict: APPROVE

### Summary
The Step 5 plan is directionally correct and scoped to the right UI layer: associate merge telemetry to a specific wave and stop rendering it across unrelated wave rows. The architecture note correctly identifies the current failure mode (`renderMergeAgents` fallback logic pulling “any merge session” telemetry), and using merge snapshot `waveIndex` is the right anchor for this fix. Overall, this plan should achieve the issue outcome without touching runtime execution behavior.

### Issues Found
1. **[Severity: minor]** The plan should explicitly call out wave-index normalization when matching data sources. `mergeResults` in dashboard state are 0-based (`mr.waveIndex`), while merge snapshot `waveIndex` can be emitted from merge flow as wave-number semantics; add an explicit normalization/check to avoid off-by-one association.

### Missing Items
- None blocking.

### Suggestions
- Explicitly remove/limit the current “any merge session” telemetry fallback for historical wave rows; unmatched rows should render `—` instead of borrowing active-wave telemetry.
- Add a concise verification matrix in STATUS.md for: (a) current merging wave shows telemetry, (b) completed prior wave keeps only its own telemetry or `—`, (c) future waves show none.
