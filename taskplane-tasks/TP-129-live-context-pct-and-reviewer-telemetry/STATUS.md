# TP-129: Live Context % and Full Reviewer Telemetry — Status

**Current Step:** Step 1: Periodic context % refresh
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-03
**Review Level:** 1
**Review Counter:** 1
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read PROMPT.md and STATUS.md
- [x] Read agent-host.ts get_session_stats handling
- [x] Read dashboard reviewer sub-row rendering
- [x] Document worker row telemetry fields

### Step 1: Periodic context % refresh
**Status:** 🟨 In Progress
- [ ] Replace single statsRequested with periodic requests
- [ ] Keep immediate first get_session_stats request on first assistant message_end
- [ ] Send follow-up get_session_stats on a bounded cadence (every 5 assistant message_end events)
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
- [ ] Test: initial immediate stats request is preserved and periodic follow-ups occur at bounded cadence
- [ ] Run full suite
- [ ] Fix failures

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update STATUS.md

---

## Execution Log

| Timestamp | Action | Outcome |
| 2026-04-03 15:08 | Task started | Runtime V2 lane-runner execution |
| 2026-04-03 15:08 | Step 0 started | Preflight |
| 2026-04-03 15:14 | Worker telemetry documented | Worker row renders ⏱ elapsed, 🔧 tool count, 📊 context %, 🪙 token summary (input+cacheRead, output, optional cost), last tool label, and retry/compaction badges |
| 2026-04-03 15:14 | Step 0 completed | Advancing to Step 1 |
| 2026-04-03 15:15 | Review R001 | plan Step 1: REVISE; hydrate Step 1/Step 3 checklist with initial-request + bounded-cadence requirements |

## Notes

- Worker row telemetry fields in `dashboard/public/app.js` (task row rendering):
  - `⏱` elapsed from `workerElapsed`
  - `🔧` tool calls from `workerToolCount`
  - `📊` context percent from `workerContextPct`
  - `🪙` token summary from `workerInputTokens + workerCacheReadTokens` (input), `workerOutputTokens` (output), and optional `workerCostUsd`
  - Last tool text from `workerLastTool` (or `[awaiting review]` when reviewer active)
  - Retry/compaction badges from telemetry sidecar (`retryActive`/`retries`, `compactions`)
- Plan review suggestion noted: prefer deterministic turn-based cadence over timers for easier testability and lower edge-case risk.
