# TP-143: Engine Segment Graph Mutation — Status

**Current Step:** Step 1: Outbox consumption (R002 revisions)
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-06
**Review Level:** 2
**Review Counter:** 2
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read PROMPT.md and STATUS.md
- [x] Read spec sections 3, 3a, 4, 5, 6, 7
- [x] Read engine.ts segment frontier logic
- [x] Read resume.ts reconstruction
- [x] Understand segment lifecycle

### Step 1: Outbox consumption
**Status:** 🟨 In Progress
- [x] Check for request files after segment completes
- [x] Parse SegmentExpansionRequest
- [x] Handle malformed files (.invalid)
- [x] Discard on failed segment (.discarded)
- [x] Process in requestId order
- [x] R002: consume sorted valid requests through a concrete boundary-processing path
- [x] R002: scope failed-segment discard to matching taskId/fromSegmentId only
- [x] R002: reject empty requestedRepoIds as malformed (.invalid)

### Step 2: Engine validation
**Status:** ⬜ Not Started
- [ ] Repo existence check
- [ ] Cycle detection
- [ ] Task not terminal
- [ ] Placement valid
- [ ] Idempotency guard

### Step 3: DAG mutation with rewiring
**Status:** ⬜ Not Started
- [ ] Formal rewiring algorithm (roots/sinks/S_old)
- [ ] after-current rewiring
- [ ] end placement
- [ ] Repeat-repo disambiguated IDs
- [ ] Re-topologize orderedSegments
- [ ] Update SegmentFrontierTaskState

### Step 4: Persistence and alerts
**Status:** ⬜ Not Started
- [ ] Persist new segments to batch state
- [ ] Update segmentIds[]
- [ ] Record processed requestId
- [ ] Emit supervisor alert
- [ ] Rename request file
- [ ] Worktree provisioning

### Step 5: Resume compatibility
**Status:** ⬜ Not Started
- [ ] Resume reconstructs expanded segments
- [ ] Approved-but-unexecuted expansion resumes
- [ ] Idempotency on resume

### Step 6: Testing & Verification
**Status:** ⬜ Not Started
- [ ] All mutation tests (linear, fan-out, end, repeat-repo)
- [ ] Rejection tests (unknown repo, cycle, duplicate)
- [ ] Edge cases (malformed, multi-request, idempotency)
- [ ] Resume after expansion
- [ ] Full test suite passing
- [ ] Polyrepo regression check

### Step 7: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] JSDoc
- [ ] Update STATUS.md

---

## Notes

- Reviewer suggestion (R002): consider extracting boundary outbox consumption into a dedicated helper for readability/testability.

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-05 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-06 03:12 | Task started | Runtime V2 lane-runner execution |
| 2026-04-06 03:12 | Step 0 started | Preflight |
| 2026-04-06 03:26 | Step 0 completed | Preflight |
| 2026-04-06 03:26 | Step 1 started | Outbox consumption |
| 2026-04-06 03:41 | Step 1 completed | Outbox consumption |
| 2026-04-06 03:41 | Step 2 started | Engine validation |
| 2026-04-06 03:14 | Review R001 | plan Step 1: APPROVE |
| 2026-04-06 03:22 | Review R002 | code Step 1: REVISE |
