# TP-121: Reviewer Dashboard Visibility — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-03
**Review Level:** 2
**Review Counter:** 3
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** 🟨 In Progress
- [x] Read PROMPT.md and STATUS.md
- [x] Read review_step in bridge extension
- [x] Read onTelemetry callback in lane-runner
- [x] Read dashboard reviewer sub-row rendering
- [x] Read V2 snapshot → laneStates synthesis

### Step 1: Bridge extension — write reviewer telemetry to file
**Status:** ⬜ Not Started
- [x] Parse reviewer stdout for RPC events
- [x] Accumulate telemetry (tokens, cost, tools, elapsed)
- [x] Write to .reviewer-state.json on each message_end
- [x] Write final state on exit
- [x] Cleanup after reading output

### Step 2: Lane-runner — read reviewer state into snapshot
**Status:** ⬜ Not Started
- [ ] Add snapshot refresh path independent of worker message_end cadence
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
| 2026-04-03 03:04 | Task started | Runtime V2 lane-runner execution |
| 2026-04-03 03:04 | Step 0 started | Preflight |
|-----------|--------|---------|
| 2026-04-03 03:07 | Review R001 | plan Step 1: APPROVE |
| 2026-04-03 03:12 | Review R002 | code Step 1: APPROVE |
| 2026-04-03 03:14 | Review R003 | plan Step 2: REVISE |

## Notes

- Reviewer suggestion (R003): treat reviewer-state read/parse errors as best-effort and keep reviewer agentId generation on `buildRuntimeAgentId(..., "reviewer")`.
