# TP-046: Async Merge Polling — Status

**Current Step:** Step 2: Convert waitForMergeResult to Async
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-23
**Review Level:** 2
**Review Counter:** 4
**Iteration:** 4
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
**Status:** ✅ Complete
- [x] Add sleepAsync to worktree.ts
- [x] Keep sleepSync for non-merge callers

---

### Step 2: Convert waitForMergeResult to Async
**Status:** ✅ Complete
- [x] Make waitForMergeResult async
- [x] Replace sleepSync with sleepAsync in polling loop
- [x] Preserve timeout/retry/grace period behavior
- [x] R004: Add `await` at waitForMergeResult call site in mergeWave (make mergeWave async) so Promise is consumed correctly and timeout/retry semantics are preserved

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
| R001 | plan | Step 1 | APPROVE | .reviews/R001-plan-step1.md |
| R001 | plan | Step 1 | APPROVE | .reviews/R001-plan-step1.md |
| R002 | code | Step 1 | APPROVE | .reviews/R002-code-step1.md |
| R002 | code | Step 1 | APPROVE | .reviews/R002-code-step1.md |
| R003 | plan | Step 2 | APPROVE | .reviews/R003-plan-step2.md |
| R003 | plan | Step 2 | REVISE | .reviews/R003-plan-step2.md |
| R004 | code | Step 2 | REVISE | .reviews/R004-code-step2.md |
| R004 | code | Step 2 | REVISE | .reviews/R004-code-step2.md |
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
| 2026-03-23 21:07 | Worker iter 2 | done in 117s, ctx: 32%, tools: 20 |
| 2026-03-23 21:07 | Skip code review | Step 0 (Preflight) — low-risk |
| 2026-03-23 21:07 | Step 0 complete | Preflight |
| 2026-03-23 21:07 | Step 1 started | Add Async Sleep Utility |
| 2026-03-23 21:07 | Worker iter 1 | done in 122s, ctx: 40%, tools: 25 |
| 2026-03-23 21:07 | Skip code review | Step 0 (Preflight) — low-risk |
| 2026-03-23 21:07 | Step 0 complete | Preflight |
| 2026-03-23 21:07 | Step 1 started | Add Async Sleep Utility |
| 2026-03-23 21:08 | Review R001 | plan Step 1: APPROVE |
| 2026-03-23 21:08 | Review R001 | plan Step 1: APPROVE |
| 2026-03-23 21:09 | Worker iter 2 | done in 63s, ctx: 9%, tools: 11 |
| 2026-03-23 21:13 | Worker iter 3 | done in 286s, ctx: 13%, tools: 21 |
| 2026-03-23 21:13 | Review R002 | code Step 1: APPROVE |
| 2026-03-23 21:13 | Step 1 complete | Add Async Sleep Utility |
| 2026-03-23 21:13 | Step 2 started | Convert waitForMergeResult to Async |
| 2026-03-23 21:14 | Review R002 | code Step 1: APPROVE |
| 2026-03-23 21:14 | Step 1 complete | Add Async Sleep Utility |
| 2026-03-23 21:14 | Step 2 started | Convert waitForMergeResult to Async |
| 2026-03-23 21:15 | Review R003 | plan Step 2: APPROVE |
| 2026-03-23 21:15 | Review R003 | plan Step 2: REVISE |
| 2026-03-23 21:17 | Worker iter 3 | done in 130s, ctx: 12%, tools: 22 |
| 2026-03-23 21:18 | Worker iter 4 | done in 133s, ctx: 13%, tools: 21 |
| 2026-03-23 21:21 | Review R004 | code Step 2: REVISE |
| 2026-03-23 21:21 | Review R004 | code Step 2: REVISE |

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
