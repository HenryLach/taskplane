# TP-037: Resume Bug Fixes & State Coherence — Status

**Current Step:** Step 1: Fix Resume Merge Skip (Bug #102)
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-22
**Review Level:** 1
**Review Counter:** 1
**Iteration:** 2
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
**Status:** ⬜ Not Started
- [ ] Relax Precedence 5 condition for pending tasks with dead sessions
- [ ] Clear stale sessionName and laneNumber

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Merge skip detection test
- [ ] Stale session name test
- [ ] State coherence test
- [ ] Full test suite passes

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 1 | REVISE | .reviews/R001-plan-step1.md |
| R001 | plan | Step 1 | REVISE | .reviews/R001-plan-step1.md |
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
