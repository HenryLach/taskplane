# TP-046: Async Merge Polling — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-23
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 2
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read waitForMergeResult polling loop
- [x] Read mergeWave and mergeWaveByRepo
- [x] Read engine.ts and resume.ts callers
- [x] Identify all sleepSync call sites in merge.ts
- [x] Read sleepSync implementation

---

### Step 1: Add Async Sleep Utility
**Status:** ⬜ Not Started
- [ ] Add sleepAsync to worktree.ts
- [ ] Keep sleepSync for non-merge callers

---

### Step 2: Convert waitForMergeResult to Async
**Status:** ⬜ Not Started
- [ ] Make waitForMergeResult async
- [ ] Replace sleepSync with sleepAsync in polling loop
- [ ] Preserve timeout/retry/grace period behavior

---

### Step 3: Convert mergeWave and Callers to Async
**Status:** ⬜ Not Started
- [ ] Make mergeWave async
- [ ] Update mergeWaveByRepo
- [ ] Update engine.ts callers
- [ ] Update resume.ts callers
- [ ] Convert spawnMergeAgent retry delays

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Merge timeout tests pass
- [ ] Merge repo-scoped tests pass
- [ ] Cleanup resilience tests pass
- [ ] Full test suite passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-23 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-23 21:05 | Task started | Extension-driven execution |
| 2026-03-23 21:05 | Step 0 started | Preflight |
| 2026-03-23 21:05 | Skip plan review | Step 0 (Preflight) — low-risk |
| 2026-03-23 21:05 | Task started | Extension-driven execution |
| 2026-03-23 21:05 | Step 0 started | Preflight |
| 2026-03-23 21:05 | Skip plan review | Step 0 (Preflight) — low-risk |

## Blockers

*None*

## Notes

### Preflight Findings

**sleepSync call sites in merge.ts (9 total):**
1. `parseMergeResult()` L115: `sleepSync(MERGE_RESULT_READ_RETRY_DELAY_MS)` — retry loop for partially-written files
2. `parseMergeResult()` L197: `sleepSync(MERGE_RESULT_READ_RETRY_DELAY_MS)` — retry loop (2nd path, JSON parse error)
3. `spawnMergeAgent()` L374: `sleepSync(500)` — wait after killing stale session
4. `spawnMergeAgent()` L427: `sleepSync(attempt * 1000)` — spawn retry backoff
5. `waitForMergeResult()` L562: `sleepSync(MERGE_RESULT_READ_RETRY_DELAY_MS)` — retry after invalid result file
6. `waitForMergeResult()` L608: `sleepSync(MERGE_POLL_INTERVAL_MS)` — **main polling loop** (biggest blocker)
7. `mergeWave()` L1011: `sleepSync(500)` — stale worktree cleanup retry delay
8. `mergeWave()` L1735: `sleepSync(500)` — post-merge worktree cleanup delay

**Caller context:**
- engine.ts: `mergeWaveByRepo()` called from `executeOrchBatch()` (already async)
- resume.ts: `mergeWaveByRepo()` called from multiple async resume paths
- Both already use `await` for wave execution, just need `await` on merge calls

**sleepSync impl:** Uses `execSync("ping"/"sleep")` — blocks entire Node process

**Constants:** MERGE_POLL_INTERVAL_MS=2000, MERGE_RESULT_READ_RETRY_DELAY_MS=1000, MERGE_TIMEOUT_MS=600000
