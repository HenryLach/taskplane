# TP-143: Engine Segment Graph Mutation — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-05
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read spec sections 3, 3a, 4, 5, 6, 7
- [ ] Read engine.ts segment frontier logic
- [ ] Read resume.ts reconstruction
- [ ] Understand segment lifecycle

### Step 1: Outbox consumption
**Status:** ⬜ Not Started
- [ ] Check for request files after segment completes
- [ ] Parse SegmentExpansionRequest
- [ ] Handle malformed files (.invalid)
- [ ] Discard on failed segment (.discarded)
- [ ] Process in requestId order

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

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-05 | Task staged | PROMPT.md and STATUS.md created |
