# TP-164: Live merge agent telemetry in dashboard (#465) — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-11
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read `runtimeLaneSnapshotPath` and `writeLaneSnapshot` in types.ts / process-registry.ts
- [ ] Read `emitSnapshot` in lane-runner.ts — understand onTelemetry pattern
- [ ] Read `spawnMergeAgentV2` in merge.ts — understand spawnAgent call
- [ ] Read `loadRuntimeLaneSnapshots` and `buildDashboardState` in server.cjs
- [ ] Read how merge pane uses `sessions` and `telemetry` in app.js
- [ ] Read `spawnAgent` onTelemetry callback signature in agent-host.ts
- [ ] Verify test baseline

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

---

## Blockers

*None*
