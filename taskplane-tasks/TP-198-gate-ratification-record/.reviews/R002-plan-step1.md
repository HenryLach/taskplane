## Plan Review: Step 1 — `ratification.ts` — record, validation, staleness

### Verdict: APPROVE

### Summary
The revised plan addresses all three blocking findings from R001: ratifications are explicitly bound to task/segment/review scope, numbering is allocated once from the global review counter for both artifacts, and persisted records receive structural validation rather than an unchecked JSON cast. The fail-closed link/staleness semantics and expanded negative tests provide an adequate foundation for the trusted operation and finalize binding in later steps.

### Issues Found
None.

### Missing Items
None.

### Suggestions
- When implementing the review-path scope check, prefer requiring `supersededReview.path` to be a direct filename under `reviewsDir` (not merely a traversal-free nested relative path), matching the top-level review scanner's actual namespace.
- Keep the rejection-code union exported or otherwise strongly typed so Step 3 can carry stable, exhaustive reason codes into `BlockingReviewGate` alerts.
