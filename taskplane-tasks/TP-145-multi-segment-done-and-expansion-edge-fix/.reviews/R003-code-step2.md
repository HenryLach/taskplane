## Code Review: Step 2 — Fix expansion edge validation

### Verdict: APPROVE

### Summary
The engine.ts change correctly relaxes the edge validation in `validateSegmentExpansionRequestAtBoundary` to accept edges referencing the anchor segment's repo and any completed segment's repo, while still rejecting edges to truly unknown repos. The implementation is clean, well-commented, and defensively coded. Four focused integration tests cover the key scenarios. All tests pass (11/11 in segment-expansion-engine.test.ts, 48/48 in lane-runner-v2.test.ts).

### Issues Found
No blocking issues.

### Pattern Violations
None. The change follows established patterns in engine.ts for accessing `segmentState.orderedSegments` and `statusBySegmentId`.

### Test Gaps
None significant. The four new tests cover:
1. Edge from anchor repo (running) to new repo — the primary bug scenario
2. Edge between two new repos — existing behavior preserved
3. Edge to truly unknown repo — still rejected
4. Edge from completed segment repo — the "already-completed" variant

### Suggestions
- **Spec update needed (Step 4):** The dynamic-segment-expansion spec at `docs/specifications/taskplane/dynamic-segment-expansion.md` line 109 describes edges as "Optional edges between newly requested repos." This should be updated in Step 4 to document that edges may also reference the anchor segment's repo and completed segment repos.

- **Minor: defensive null guards on non-optional fields.** `orderedSegments ?? []` and `statusBySegmentId?.get()` are harmlessly defensive since both fields are required on the `SegmentFrontierTaskState` interface. Not a problem, just a style note — the extra safety is fine for production code.

- **Error message change is safe.** The old message `"edge references a repo outside requestedRepoIds"` was updated to `"edge references a repo outside requestedRepoIds and known segments"`. The only test matching this message uses a regex (`/edge references a repo outside/`) which correctly matches both old and new wording. No external contracts depend on this exact string.
