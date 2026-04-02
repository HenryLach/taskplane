# Task: TP-121 - Reviewer Dashboard Visibility

**Created:** 2026-04-02
**Size:** M

## Review Level: 2 (Plan + Code)

**Assessment:** Adds reviewer telemetry reporting from the bridge extension to the lane snapshot, restoring the reviewer sub-row in the dashboard. Touches bridge extension, lane-runner, lane snapshot schema, and dashboard rendering.
**Score:** 4/8 — Blast radius: 2 (bridge, lane-runner, dashboard), Pattern novelty: 1 (file-based telemetry reporting), Security: 0, Reversibility: 1 (additive)

## Canonical Task Folder

```
taskplane-tasks/TP-121-reviewer-dashboard-visibility/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Restore reviewer agent visibility in the dashboard during V2 execution. When a worker calls `review_step`, the reviewer subprocess should appear as a sub-row under the worker in the dashboard lane view, showing live telemetry (elapsed, tools, context%, cost, last tool). When the review completes, the sub-row disappears.

**Approach:** The bridge extension's `review_step` tool writes reviewer telemetry to a `.reviewer-state.json` file in the task folder during reviewer execution. The lane-runner's `onTelemetry` callback reads this file and populates the `reviewer` field in the lane snapshot. The dashboard already renders reviewer sub-rows when `snapshot.reviewer` is non-null — it just needs real data.

## Dependencies

- None (builds on existing bridge extension review_step from v0.23.15)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/agent-bridge-extension.ts` — review_step tool and spawnReviewer()
- `extensions/taskplane/lane-runner.ts` — onTelemetry callback, emitSnapshot()
- `extensions/taskplane/process-registry.ts` — RuntimeLaneSnapshot, writeLaneSnapshot()
- `dashboard/public/app.js` — reviewer sub-row rendering (search "reviewerActive", "reviewer-sub-row")
- `dashboard/server.cjs` — V2 snapshot → laneStates synthesis (search "TP-115")

## File Scope

- `extensions/taskplane/agent-bridge-extension.ts`
- `extensions/taskplane/lane-runner.ts`
- `dashboard/public/app.js`
- `dashboard/server.cjs`
- `extensions/tests/*.test.ts`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read the current `review_step` tool in `agent-bridge-extension.ts` — understand how spawnReviewer() works
- [ ] Read the `onTelemetry` callback in `lane-runner.ts` — understand how emitSnapshot() populates the lane snapshot
- [ ] Read the dashboard reviewer sub-row rendering in `app.js` — understand what fields it expects
- [ ] Read the V2 snapshot → laneStates synthesis in `server.cjs` — understand how reviewer data flows

### Step 1: Bridge extension — write reviewer telemetry to file
- [ ] In `spawnReviewer()`, parse the reviewer subprocess stdout for RPC events (same JSON-line protocol as agent-host)
- [ ] Accumulate telemetry: inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd, toolCalls, lastTool, elapsedMs
- [ ] Write telemetry to `{taskFolder}/.reviewer-state.json` on each `message_end` event
- [ ] Include fields: `{ status: "running", elapsedMs, toolCalls, contextPct, costUsd, lastTool, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }`
- [ ] On reviewer exit, write final state with `status: "done"` or `status: "error"`
- [ ] Delete `.reviewer-state.json` after reading the review output (cleanup)

### Step 2: Lane-runner — read reviewer state into snapshot
- [ ] In the `onTelemetry` callback (inside the `spawnAgent` call for the worker), check for `.reviewer-state.json` in the task folder
- [ ] If present with `status: "running"`, populate `snapshot.reviewer` with the telemetry data
- [ ] If absent or `status: "done"/"error"`, set `snapshot.reviewer = null`
- [ ] The reviewer agentId should be `{agentIdPrefix}-lane-{N}-reviewer`

### Step 3: Dashboard server — include reviewer in laneStates synthesis
- [ ] In `buildDashboardState()` V2 snapshot synthesis, map `snap.reviewer` fields to the legacy reviewer format:
  - `reviewerStatus` → "running" / "done" / "idle"
  - `reviewerElapsed`, `reviewerContextPct`, `reviewerLastTool`, `reviewerToolCount`
  - `reviewerCostUsd`, `reviewerInputTokens`, `reviewerOutputTokens`, etc.
- [ ] Ensure the dashboard frontend's reviewer sub-row rendering activates when reviewer data is present

### Step 4: Dashboard frontend — verify reviewer sub-row renders
- [ ] Verify the existing `reviewerActive` check in `app.js` works with V2 data
- [ ] If needed, adjust the check to work with the V2 snapshot reviewer format
- [ ] Test that reviewer sub-row appears during review and disappears after

### Step 5: Tests
- [ ] Add test: lane snapshot with reviewer data produces correct dashboard state
- [ ] Add test: reviewer-state.json absent → snapshot.reviewer is null
- [ ] Run full test suite
- [ ] Fix all failures

### Step 6: Documentation & Delivery
- [ ] Update STATUS.md with completion summary
- [ ] Log any discoveries

## Do NOT

- Move reviewer spawning to the lane-runner (stay with bridge extension approach)
- Add reviewer to the process registry (not needed for dashboard visibility)
- Remove the Agents panel (separate decision, not this task)
- Break the existing worker telemetry flow

## Git Commit Convention

- `feat(TP-121): complete Step N — ...`

## Amendments

<!-- Workers add amendments here if issues discovered during execution. -->
