# TP-164: Live merge agent telemetry in dashboard (#465) — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-11
**Review Level:** 2
**Review Counter:** 0
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
**Status:** ⬜ Not Started

- [ ] Add `RuntimeMergeSnapshot` interface to `types.ts`
- [ ] Add `runtimeMergeSnapshotPath()` to `types.ts`
- [ ] Add `writeMergeSnapshot()` to `process-registry.ts`
- [ ] Add `readMergeSnapshot()` to `process-registry.ts`

---

### Step 2: Write snapshots from spawnMergeAgentV2
**Status:** ⬜ Not Started

- [ ] Add `onTelemetry` callback to `spawnAgent` call in `spawnMergeAgentV2`
- [ ] Write `running` snapshot on each telemetry update
- [ ] Write terminal snapshot on promise completion
- [ ] All snapshot writes wrapped in try/catch

---

### Step 3: Load and expose merge snapshots in dashboard server
**Status:** ⬜ Not Started

- [ ] Add `loadRuntimeMergeSnapshots(batchId)` to `server.cjs`
- [ ] Update `getActiveSessions()` to return active merger session names from registry
- [ ] Add merge snapshot telemetry to `telemetry` map in `buildDashboardState`
- [ ] Expose `runtimeMergeSnapshots` in response

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Full test suite passing
- [ ] CLI smoke passing
- [ ] Fix all failures

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] JSDoc on new types/functions
- [ ] Comment in spawnMergeAgentV2
- [ ] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-11 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-11 04:49 | Task started | Runtime V2 lane-runner execution |
| 2026-04-11 04:49 | Step 0 started | Preflight |

---

## Blockers

*None*
