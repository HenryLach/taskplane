# TP-121: Reviewer Dashboard Visibility — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-02
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read review_step in bridge extension
- [ ] Read onTelemetry callback in lane-runner
- [ ] Read dashboard reviewer sub-row rendering
- [ ] Read V2 snapshot → laneStates synthesis

### Step 1: Bridge extension — write reviewer telemetry to file
**Status:** ⬜ Not Started
- [ ] Parse reviewer stdout for RPC events
- [ ] Accumulate telemetry (tokens, cost, tools, elapsed)
- [ ] Write to .reviewer-state.json on each message_end
- [ ] Write final state on exit
- [ ] Cleanup after reading output

### Step 2: Lane-runner — read reviewer state into snapshot
**Status:** ⬜ Not Started
- [ ] Check for .reviewer-state.json in onTelemetry callback
- [ ] Populate snapshot.reviewer when running
- [ ] Set null when absent or done

### Step 3: Dashboard server — reviewer in laneStates synthesis
**Status:** ⬜ Not Started
- [ ] Map snap.reviewer to legacy reviewer format
- [ ] Ensure frontend rendering activates

### Step 4: Dashboard frontend — verify reviewer sub-row
**Status:** ⬜ Not Started
- [ ] Verify reviewerActive check works with V2 data
- [ ] Adjust if needed
- [ ] Test appearance/disappearance

### Step 5: Tests
**Status:** ⬜ Not Started
- [ ] Test: reviewer data in snapshot → correct dashboard state
- [ ] Test: no reviewer-state → null
- [ ] Run full suite
- [ ] Fix failures

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update STATUS.md
- [ ] Log discoveries

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
