# TP-129: Live Context % and Full Reviewer Telemetry — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-03
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read agent-host.ts get_session_stats handling
- [ ] Read dashboard reviewer sub-row rendering
- [ ] Document worker row telemetry fields

### Step 1: Periodic context % refresh
**Status:** ⬜ Not Started
- [ ] Replace single statsRequested with periodic requests
- [ ] Send get_session_stats every N turns or on timer
- [ ] Verify response handler updates contextUsage
- [ ] Benefits both worker and reviewer

### Step 2: Full reviewer telemetry in dashboard
**Status:** ⬜ Not Started
- [ ] Add elapsed time to reviewer sub-row
- [ ] Add token summary to reviewer sub-row
- [ ] Add context % to reviewer sub-row
- [ ] Verify badge layout matches worker row

### Step 3: Tests
**Status:** ⬜ Not Started
- [ ] Test: stats requested more than once
- [ ] Run full suite
- [ ] Fix failures

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update STATUS.md

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
