# TP-164: Live merge agent telemetry in dashboard (#465) — Status

**Current Step:** Step 5: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-04-11
**Review Level:** 2
**Review Counter:** 6
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read `runtimeLaneSnapshotPath` and `writeLaneSnapshot` in types.ts / process-registry.ts
- [x] Read `emitSnapshot` in lane-runner.ts — understand onTelemetry pattern
- [x] Read `spawnMergeAgentV2` in merge.ts — understand spawnAgent call
- [x] Read `loadRuntimeLaneSnapshots` and `buildDashboardState` in server.cjs
- [x] Read how merge pane uses `sessions` and `telemetry` in app.js
- [x] Read `spawnAgent` onTelemetry callback signature in agent-host.ts
- [x] Verify test baseline (3254/3255 pass; 1 pre-existing failure in worktree-lifecycle.integration.test.ts)

---

### Step 1: Add merge snapshot infrastructure
**Status:** ✅ Complete

- [x] Add `RuntimeMergeSnapshot` interface to `types.ts`
- [x] Add `runtimeMergeSnapshotPath()` to `types.ts`
- [x] Add `writeMergeSnapshot()` to `process-registry.ts`
- [x] Add `readMergeSnapshot()` to `process-registry.ts`

---

### Step 2: Write snapshots from spawnMergeAgentV2
**Status:** ✅ Complete

- [x] Add `onTelemetry` callback to `spawnAgent` call in `spawnMergeAgentV2`
- [x] Write initial `running` snapshot immediately after spawn
- [x] Write `running` snapshot on each telemetry update
- [x] Write terminal snapshot in `.then(result)` with correct status mapping (killed||exitCode!==0||!agentEnded = "failed", else "complete")
- [x] Keep `.catch` as exceptional fallback writing `failed` snapshot
- [x] All snapshot writes wrapped in try/catch

---

### Step 3: Load and expose merge snapshots in dashboard server
**Status:** ✅ Complete

- [x] Add `loadRuntimeMergeSnapshots(batchId)` to `server.cjs`
- [x] Update `getActiveSessions()` to return active merger session names from registry
- [x] Add merge snapshot telemetry to `telemetry` map in `buildDashboardState`
- [x] Expose `runtimeMergeSnapshots` in response

---

### Step 4: Testing & Verification
**Status:** ✅ Complete

- [x] Full test suite passing (3255/3255 — 2 test assertions updated for new spawnAgent signature)
- [x] CLI smoke passing
- [x] Fix all failures

---

### Step 5: Documentation & Delivery
**Status:** ✅ Complete

- [x] JSDoc on new types/functions (RuntimeMergeSnapshot, runtimeMergeSnapshotPath, writeMergeSnapshot, readMergeSnapshot)
- [x] Comment in spawnMergeAgentV2 explaining snapshot write pattern
- [x] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| `spawnAgent` resolves for both success and failure exits; `.catch` rarely fires. Terminal status must be derived from `AgentHostResult.killed/exitCode/agentEnded`. | Fixed in Step 2 (reviewer feedback) | `merge.ts` `spawnMergeAgentV2` |
| Two source-extraction tests asserted literal `spawnAgent(opts)` — broken when third `onTelemetry` arg was added. Updated to `spawnAgent(opts` (prefix match). | Fixed in Step 4 | `engine-runtime-v2-routing.test.ts`, `orch-rpc-telemetry.test.ts` |
| `loadTelemetryData` accumulator uses `cost` not `costUsd` for the cost field. Merge snapshot uses `costUsd`. Translation needed in telemetry injection. | Handled in Step 3 | `server.cjs` `buildDashboardState` |
| `waveIndex` not easily available inside `spawnMergeAgentV2`; hardcoded to 0 per PROMPT.md guidance. Future work could pass it through. | Tech debt | `merge.ts` |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-11 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-11 04:49 | Task started | Runtime V2 lane-runner execution |
| 2026-04-11 04:49 | Step 0 started | Preflight |
| 2026-04-11 05:21 | Worker iter 1 | done in 1900s, tools: 132 |
| 2026-04-11 05:21 | Task complete | .DONE created |

---

## Blockers

*None*
| 2026-04-11 04:55 | Review R001 | plan Step 1: APPROVE |
| 2026-04-11 04:57 | Review R002 | code Step 1: APPROVE |
| 2026-04-11 04:58 | Review R003 | plan Step 2: REVISE |
| 2026-04-11 05:02 | Review R004 | code Step 2: APPROVE |
| 2026-04-11 05:03 | Review R005 | plan Step 3: APPROVE |
| 2026-04-11 05:06 | Review R006 | code Step 3: APPROVE |
