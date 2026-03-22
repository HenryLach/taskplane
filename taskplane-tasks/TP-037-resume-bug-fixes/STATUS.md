# TP-037: Resume Bug Fixes & State Coherence — Status

**Current Step:** Step 4: Documentation & Delivery
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-22
**Review Level:** 1
**Review Counter:** 3
**Iteration:** 6
**Size:** S

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read reconcileTaskStates() logic
- [x] Read computeResumePoint() logic
- [x] Read engine wave advancement
- [x] Identify code paths for both bugs

---

### Step 1: Fix Resume Merge Skip (Bug #102)
**Status:** ✅ Complete
- [x] Add `mergeRetryWaveIndexes` field to `ResumePoint` type in types.ts
- [x] Update `computeResumePoint()` to check per-wave merge status before skipping; build `mergeRetryWaveIndexes` array and add helper `getMergeStatusForWave()`
- [x] Update `resumeOrchBatch()` wave loop to detect merge-retry waves and run merge-only (no task execution)
- [x] Verify tests pass with `npx vitest run`

---

### Step 2: Fix Stale Session Names (Bug #102b)
**Status:** ✅ Complete
- [x] Relax Precedence 5 condition for pending tasks with dead sessions
- [x] Clear stale sessionName and laneNumber

---

### Step 3: Testing & Verification
**Status:** ✅ Complete
- [x] Merge skip detection test
- [x] Stale session name test
- [x] State coherence test
- [x] Full test suite passes

---

### Step 4: Documentation & Delivery
**Status:** 🟨 In Progress
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 1 | REVISE | .reviews/R001-plan-step1.md |
| R001 | plan | Step 1 | REVISE | .reviews/R001-plan-step1.md |
| R002 | plan | Step 2 | APPROVE | .reviews/R002-plan-step2.md |
| R002 | plan | Step 2 | REVISE | .reviews/R002-plan-step2.md |
| R003 | plan | Step 3 | APPROVE | .reviews/R003-plan-step3.md |
| R003 | plan | Step 3 | APPROVE | .reviews/R003-plan-step3.md |
|---|------|------|---------|------|

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-21 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-22 04:23 | Task started | Extension-driven execution |
| 2026-03-22 04:23 | Step 0 started | Preflight |
| 2026-03-22 04:23 | Skip plan review | Step 0 (Preflight) — low-risk |
| 2026-03-22 04:23 | Task started | Extension-driven execution |
| 2026-03-22 04:23 | Step 0 started | Preflight |
| 2026-03-22 04:23 | Skip plan review | Step 0 (Preflight) — low-risk |
| 2026-03-22 04:24 | Worker iter 2 | done in 80s, ctx: 30%, tools: 16 |
| 2026-03-22 04:24 | Step 0 complete | Preflight |
| 2026-03-22 04:24 | Step 1 started | Fix Resume Merge Skip (Bug #102) |
| 2026-03-22 04:24 | Worker iter 1 | done in 92s, ctx: 30%, tools: 19 |
| 2026-03-22 04:24 | Step 0 complete | Preflight |
| 2026-03-22 04:24 | Step 1 started | Fix Resume Merge Skip (Bug #102) |
| 2026-03-22 04:27 | Review R001 | plan Step 1: REVISE |
| 2026-03-22 04:27 | Review R001 | plan Step 1: REVISE |
| 2026-03-22 04:38 | Worker iter 3 | done in 653s, ctx: 44%, tools: 70 |
| 2026-03-22 04:38 | Step 1 complete | Fix Resume Merge Skip (Bug #102) |
| 2026-03-22 04:38 | Step 2 started | Fix Stale Session Names (Bug #102b) |
| 2026-03-22 04:38 | Worker iter 2 | done in 657s, ctx: 46%, tools: 83 |
| 2026-03-22 04:38 | Step 1 complete | Fix Resume Merge Skip (Bug #102) |
| 2026-03-22 04:38 | Step 2 started | Fix Stale Session Names (Bug #102b) |
| 2026-03-22 04:39 | Review R002 | plan Step 2: APPROVE |
| 2026-03-22 04:39 | Review R002 | plan Step 2: REVISE |
| 2026-03-22 04:50 | Worker iter 4 | done in 632s, ctx: 26%, tools: 45 |
| 2026-03-22 04:50 | Step 2 complete | Fix Stale Session Names (Bug #102b) |
| 2026-03-22 04:50 | Step 3 started | Testing & Verification |
| 2026-03-22 04:50 | Worker iter 3 | done in 629s, ctx: 22%, tools: 45 |
| 2026-03-22 04:50 | Step 2 complete | Fix Stale Session Names (Bug #102b) |
| 2026-03-22 04:50 | Step 3 started | Testing & Verification |
| 2026-03-22 04:51 | Review R003 | plan Step 3: APPROVE |
| 2026-03-22 04:52 | Review R003 | plan Step 3: APPROVE |
| 2026-03-22 04:56 | Worker iter 5 | done in 287s, ctx: 30%, tools: 27 |
| 2026-03-22 04:56 | Step 3 complete | Testing & Verification |
| 2026-03-22 04:56 | Step 4 started | Documentation & Delivery |
| 2026-03-22 04:56 | Skip plan review | Step 4 (final step) — low-risk |

## Blockers

*None*

## Notes

### Bug #102 (Resume Merge Skip)
- `computeResumePoint()` (resume.ts ~L315-350): wave-skip logic checks if all tasks are terminal (mark-complete, mark-failed, skip). If yes, `resumeWaveIndex` advances past that wave. But it never checks `persistedState.mergeResults` to verify merge succeeded.
- Resume wave loop (resume.ts ~L1200): filters out completed/failed tasks → `waveTasks` is empty → `continue` skips the wave entirely, including merge.
- **Fix location**: `computeResumePoint()` — a wave should NOT be skipped if its merge is missing or failed in `persistedState.mergeResults`. The `ResumePoint` type should carry `mergeRetryWaveIndexes` for waves needing merge retry.
- **Engine-side**: resume wave loop needs to detect merge-retry waves and run `mergeWaveByRepo()` without executing tasks.

### Bug #102b (Stale Session Names)
- `reconcileTaskStates()` (resume.ts ~L370): Precedence 5 condition is `task.status === "pending" && !task.sessionName`. If a pending task was allocated a session in a prior failed resume but never started, it has `sessionName` set but the session is dead → falls to Precedence 6 → `mark-failed`.
- **Fix location**: Precedence 5 condition should be: `task.status === "pending" && (!task.sessionName || (!sessionAlive && !worktreeExists))`. Also clear stale `sessionName`/`laneNumber` in the reconciliation output or during state reconstruction.
