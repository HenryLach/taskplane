# Task: TP-129 - Live Context % and Full Reviewer Telemetry

**Created:** 2026-04-03
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** Two focused improvements to agent telemetry display. Periodic stats refresh is a small change in agent-host. Reviewer telemetry parity is dashboard rendering.
**Score:** 2/8 — Blast radius: 1 (agent-host, dashboard), Pattern novelty: 1 (extending existing patterns), Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-129-live-context-pct-and-reviewer-telemetry/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Two improvements to agent telemetry visibility:

### 1. Live context % refresh
Currently `get_session_stats` is requested once (after the first assistant message) and never refreshed. The context % stays at ~3% for the entire run regardless of actual usage. Fix: periodically request `get_session_stats` so context % updates throughout execution.

### 2. Full reviewer telemetry parity
The reviewer sub-row in the dashboard currently shows only tool count, cost, and last tool. The worker row shows elapsed time, token counts, context %, and token summary badges. The reviewer should show the same telemetry fields.

## Dependencies

- **Task:** TP-121 (reviewer dashboard visibility — done)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/agent-host.ts` — `get_session_stats` request, `contextUsage` accumulation, `statsRequested` flag
- `dashboard/public/app.js` — reviewer sub-row rendering (search "reviewer-sub-row", "reviewerActive")
- `dashboard/server.cjs` — V2 snapshot → laneStates reviewer field synthesis

## File Scope

- `extensions/taskplane/agent-host.ts`
- `dashboard/public/app.js`
- `dashboard/server.cjs` (if reviewer fields need updating)
- `extensions/tests/*.test.ts`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read agent-host.ts `get_session_stats` handling — understand the single-request pattern
- [ ] Read dashboard reviewer sub-row rendering — understand which fields are shown vs available
- [ ] Read dashboard worker row rendering — document all telemetry fields shown

### Step 1: Periodic context % refresh in agent-host
- [ ] In agent-host.ts, replace the single `statsRequested` flag with periodic `get_session_stats` requests
- [ ] Send `get_session_stats` every N `message_end` events (e.g., every 5th turn) or on a timer (e.g., every 30 seconds)
- [ ] Ensure the `response` handler updates `contextUsage` each time (already does)
- [ ] The `onTelemetry` callback already sends `contextUsage` — no change needed there
- [ ] This benefits BOTH worker and reviewer agents (same agent-host code)

### Step 2: Full reviewer telemetry in dashboard
- [ ] In dashboard/public/app.js reviewer sub-row rendering, add all telemetry fields shown in the worker row:
  - Elapsed time (⏱)
  - Token summary (🪙 input↑ output↓ cacheRead)
  - Context % (📊)
  - These may already be available in the lane state — check `reviewerElapsed`, `reviewerContextPct`, `reviewerInputTokens`, etc.
- [ ] Verify the reviewer sub-row renders the same badge layout as the worker row
- [ ] If any reviewer fields are missing from server.cjs synthesis, add them

### Step 3: Tests
- [ ] Add/update test: verify agent-host requests stats more than once during a multi-turn session (structural test on source)
- [ ] Run full test suite
- [ ] Fix failures

### Step 4: Documentation & Delivery
- [ ] Update STATUS.md with completion summary

## Do NOT

- Change the `contextUsage` data structure or the `onTelemetry` callback signature
- Remove the initial stats request (keep it for fast first-update)
- Make the stats request interval too aggressive (Pi has overhead per stats call)

## Git Commit Convention

- `feat(TP-129): complete Step N — ...`

## Amendments

<!-- Workers add amendments here if issues discovered during execution. -->
