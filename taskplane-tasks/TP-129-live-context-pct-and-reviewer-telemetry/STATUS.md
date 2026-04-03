# TP-129: Live Context % and Full Reviewer Telemetry — Status

**Current Step:** Step 3: Tests
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-03
**Review Level:** 1
**Review Counter:** 3
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
**Status:** ✅ Complete
- [x] Replace single statsRequested with periodic requests
- [x] Keep immediate first get_session_stats request on first assistant message_end
- [x] Send follow-up get_session_stats on a bounded cadence (every 5 assistant message_end events)
- [x] Verify response handler updates contextUsage
- [x] Benefits both worker and reviewer

### Step 2: Full reviewer telemetry in dashboard
**Status:** ✅ Complete
- [x] Add elapsed time to reviewer sub-row
- [x] Add token summary to reviewer sub-row
- [x] Add context % to reviewer sub-row
- [x] Verify badge layout matches worker row

### Step 3: Tests
**Status:** 🟨 In Progress
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
| 2026-04-03 15:18 | Step 1 implemented | agent-host now requests get_session_stats on assistant message #1 and every 5 assistant message_end events |
| 2026-04-03 15:18 | Step 1 completed | Advancing to Step 2 |
| 2026-04-03 15:24 | Step 2 implementation | Reviewer sub-row now shows worker-style badges: ⏱ elapsed, 🔧 tools, 📊 context, 🪙 token summary, last tool |
| 2026-04-03 15:24 | Server field check | `dashboard/server.cjs` already synthesizes reviewer elapsed/context/tokens/cost fields; no server patch required |
| 2026-04-03 15:24 | Step 2 completed | Advancing to Step 3 |

## Notes

- Worker row telemetry fields in `dashboard/public/app.js` (task row rendering):
  - `⏱` elapsed from `workerElapsed`
  - `🔧` tool calls from `workerToolCount`
  - `📊` context percent from `workerContextPct`
  - `🪙` token summary from `workerInputTokens + workerCacheReadTokens` (input), `workerOutputTokens` (output), and optional `workerCostUsd`
  - Last tool text from `workerLastTool` (or `[awaiting review]` when reviewer active)
  - Retry/compaction badges from telemetry sidecar (`retryActive`/`retries`, `compactions`)
- Plan review suggestion noted: prefer deterministic turn-based cadence over timers for easier testability and lower edge-case risk.
- Reviewer `📊` context badge already existed; parity update retained it in the same `worker-stat` badge layout while adding missing elapsed/token badges.
| 2026-04-03 15:11 | Review R002 | plan Step 1: APPROVE |
| 2026-04-03 15:14 | Review R003 | plan Step 2: APPROVE |
