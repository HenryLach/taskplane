## Plan Review: Step 1 — `ratification.ts` — record, validation, staleness

### Verdict: REVISE

### Summary
The plan covers the requested module surface and most explicit rejection cases, and its fail-closed staleness behavior is directionally sound. However, it does not yet bind a ratification to the task/segment and review scope supplied in the validation context, and its proposed review-number derivation conflicts with Taskplane's global `Review Counter`; both gaps can undermine the authority artifact in later integration.

### Issues Found
1. **[Severity: important]** — The validation plan searches all holds for `rulingId` and only scopes `closedEscalationIds` to `holdsForTask`, but never checks `record.taskId`/`record.segmentId` against `ctx.taskId`/`ctx.segmentId`. It also does not define how `supersededReview.path` is constrained to `ctx.reviewsDir` and to `record.gate`. This leaves the context's scope fields effectively unused and could allow a released ruling or hashed review from another task/unit/gate to validate, contrary to the spec's requirement that finalize validate “reference, scope, authority and proof binding.” Add explicit, tested scope semantics (reusing the hold-state unit helpers where appropriate), scope the ruling lookup before accepting it, and resolve/confine the superseded review path beneath the supplied reviews directory.
2. **[Severity: important]** — Deriving the ratification review number as `supersededReview R-number + 1` does not follow the existing globally incremented `**Review Counter:**` convention in `agent-bridge-extension.ts:884-904`. Interleaved reviews for other gates can already occupy later R numbers, and unless the trusted operation advances the counter, a subsequent normal `review_step` can reuse and overwrite the linked APPROVE filename. Define one shared allocation outcome for the ratification JSON and APPROVE markdown (global next R number, collision-safe), return/use that allocation consistently, and ensure Step 2 advances the persistent review counter.
3. **[Severity: important]** — “Malformed file throws” is not precise enough for a runtime authority record. Valid JSON with a malformed shape (for example `{}` or a `proofSet` that is not an array) must not be cast to `GateRatification` and then crash unpredictably in validation; in the finalize path, broad error handling risks turning such a crash into fail-open behavior. Plan structural decoding/validation for every ratification file and tests for syntactically valid but structurally invalid JSON, in addition to invalid JSON syntax.

### Missing Items
- Tests proving wrong-task/wrong-segment ruling and superseded-review references are rejected.
- A numbering/collision test with interleaved gates and a subsequent ordinary review allocation.
- A structural-malformation read test, not only an invalid-JSON test.

### Suggestions
- Have `isRatificationStale` explicitly require the linking file to be an APPROVE for `record.gate`; treating a missing, ambiguous, wrong-gate, or non-APPROVE link as stale keeps the helper fail-closed.
- Keep `supersededReview.path` portable (for example, a reviews-directory-relative path) rather than persisting a worktree-specific absolute path.
