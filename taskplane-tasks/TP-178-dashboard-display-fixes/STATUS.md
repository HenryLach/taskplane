# TP-178: Dashboard Display Fixes — Status

**Current Step:** Step 3: Succeeded tasks show 0% (#491)
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-14
**Review Level:** 1
**Review Counter:** 3
**Iteration:** 1
**Size:** L

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read app.js rendering architecture
- [x] Read all 6 linked issues
- [x] Document findings

---

### Step 1: Stale STATUS.md viewer across batches (#487)
**Status:** ✅ Complete
- [x] Detect batchId change → clear viewer
- [x] Auto-select or show placeholder

---

### Step 2: Lane step label never updates (#488)
**Status:** ✅ Complete
- [x] Re-read step name on every poll
- [x] Fallback to STATUS.md Current Step field

---

### Step 3: Succeeded tasks show 0% (#491)
**Status:** ✅ Complete
- [x] Override to 100% when succeeded
- [x] Show "Complete" as step label

---

### Step 4: Wave indicators flash green during merge (#493)
**Status:** ⬜ Not Started
- [ ] Only completed waves green during merge
- [ ] Current merging wave shows merging indicator

---

### Step 5: Merge telemetry duplicated across waves (#498)
**Status:** ⬜ Not Started
- [ ] Associate telemetry with correct wave via waveIndex
- [ ] Only display on matching wave

---

### Step 6: No progress for non-final segments (#494)
**Status:** ⬜ Not Started
- [ ] Segment-scoped progress from sidecar
- [ ] Fallback "executing" indicator

---

### Step 7: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Full test suite passing
- [ ] Manual dashboard testing

---

### Step 8: Documentation & Delivery
**Status:** ⬜ Not Started
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
| 2026-04-13 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-14 01:55 | Task started | Runtime V2 lane-runner execution |
| 2026-04-14 01:55 | Step 0 started | Preflight |

---

## Blockers

*None*

---

## Notes

GitHub issues: #487, #488, #491, #493, #494, #498
All fixes in dashboard/public/app.js — no runtime code changes.

### Architecture Findings

**Rendering pipeline:** SSE connection → `render(data)` → per-section renderers. Data includes `batch` (with tasks, lanes, wavePlan, mergeResults, segments, phase, currentWaveIndex), `sessions`, `laneStates`, `telemetry`, `runtimeLaneSnapshots`, `runtimeMergeSnapshots`, `runtimeRegistry`, `mailbox`.

**Bug #487 (Step 1):** No `batchId` change detection. `viewerMode`/`viewerTarget` persist across batch transitions. Need to track `lastBatchId` and call `closeViewer()` when batch changes.

**Bug #488 (Step 2):** Step cell at line 737 reads `sd.currentStep` from `task.statusData` (server-side `parseStatusMd`). But V2 snapshots have `v2snap.progress.currentStep` which is updated by the lane-runner sidecar on every poll. The dashboard already reads `_v2Progress` for checkbox counts but ignores its `currentStep`. Need to prefer `_v2Progress.currentStep` over `sd.currentStep` when available.

**Bug #491 (Step 3):** Already partially fixed by TP-176. Progress cell shows 100% for succeeded tasks. Step label shows "Complete" when `!sd`. But if `sd` exists with stale data, step label shows stale step. Need to override step label to "Complete" when `task.status === "succeeded"` regardless of `sd`.

**Bug #493 (Step 4):** Wave chips at line 587 set `isDone` including `batch.phase === "merging"`. This means ALL waves turn green during merge. Fix: during merging phase, only `i < waveIdx` should be `isDone`. The current merging wave should get a `merging` class.

**Bug #498 (Step 5):** `renderMergeAgents` tries to match merge telemetry to waves via lane number inference, but during merge the telemetry for the ACTIVE merge agent leaks to all completed wave rows because the fallback search picks up any merge session. Need to use the merge snapshot's `waveIndex` field for precise association.

**Bug #494 (Step 6):** Progress cell already prefers V2 progress (`v2p`) when `v2p.total > 0`. During non-final segments, sidecar reports segment-scoped counts. If sidecar hasn't started or reports 0/0, running tasks show `—`. Need to show an "executing" indicator instead of `—` for running tasks.
| 2026-04-14 01:59 | Review R001 | plan Step 1: APPROVE |
| 2026-04-14 02:01 | Review R002 | plan Step 2: APPROVE |
| 2026-04-14 02:02 | Review R003 | plan Step 3: APPROVE |
