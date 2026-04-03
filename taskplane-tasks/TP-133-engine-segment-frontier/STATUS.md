# TP-133: Engine Segment Frontier MVP — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-03
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read PROMPT.md and STATUS.md
- [ ] Trace engine wave loop
- [ ] Trace computeWaveAssignments segment plans
- [ ] Identify segment dispatch point

### Step 1: Segment frontier in engine
**Status:** ⬜ Not Started
- [ ] Decompose multi-segment tasks into segment execution units
- [ ] Repo-singleton unchanged
- [ ] Sequential per-task segment execution
- [ ] Track activeSegmentId
- [ ] Update segmentIds

### Step 2: Packet-home completion authority
**Status:** ⬜ Not Started
- [ ] .DONE check uses packet.donePath
- [ ] STATUS.md reads use packet.statusPath
- [ ] Backward compat for repo-mode

### Step 3: Segment lifecycle transitions
**Status:** ⬜ Not Started
- [ ] Track segment status transitions
- [ ] Advance to next segment on completion
- [ ] Mark task complete when all segments done
- [ ] Apply failure policy on segment failure

### Step 4: Tests
**Status:** ⬜ Not Started
- [ ] Test repo-singleton unchanged
- [ ] Test multi-segment sequential execution
- [ ] Test segment DAG edges
- [ ] Test packet-home completion detection
- [ ] Run full suite, fix failures

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update STATUS.md

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
