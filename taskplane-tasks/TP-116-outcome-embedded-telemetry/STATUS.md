# TP-116: Outcome-Embedded Telemetry — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-01
**Review Level:** 0
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read PROMPT.md and confirm understanding
- [ ] Read LaneTaskOutcome type in types.ts
- [ ] Read batch history writer in engine.ts
- [ ] Read makeResult in lane-runner.ts

### Step 1: Extend LaneTaskOutcome Type
**Status:** ⬜ Not Started
- [ ] Add laneNumber to LaneTaskOutcome
- [ ] Add telemetry to LaneTaskOutcome
- [ ] Both optional for backward compatibility

### Step 2: Populate in Lane-Runner
**Status:** ⬜ Not Started
- [ ] Populate outcome.laneNumber from config.laneNumber
- [ ] Populate outcome.telemetry from finalTelemetry
- [ ] Skipped tasks: leave telemetry undefined

### Step 3: Populate in executeLaneV2
**Status:** ⬜ Not Started
- [ ] Outcomes carry through laneNumber and telemetry
- [ ] Skipped outcomes: set laneNumber, no telemetry

### Step 4: Simplify Batch History Writer
**Status:** ⬜ Not Started
- [ ] Read telemetry from to.telemetry when available
- [ ] Fall back to lane snapshot for legacy
- [ ] Remove batchState.lanes.find() dependency
- [ ] Keep legacy sidecar fallback

### Step 5: Tests
**Status:** ⬜ Not Started
- [ ] Test: outcome with telemetry → correct history tokens
- [ ] Test: outcome without telemetry → snapshot fallback
- [ ] Test: skipped task → zero tokens
- [ ] All existing tests pass

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update STATUS.md
- [ ] Log discoveries

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|

---

## Blockers

*None*
