# TP-169: Segment Expansion Resume Crash and Workspace Orch Branch — Status

**Current Step:** Step 4: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-04-12
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 1
**Size:** L

---

### Step 0: Preflight and Root Cause Analysis
**Status:** ✅ Complete

- [x] Read resume.ts — task allocation reconstruction from persisted state
- [x] Read engine.ts — how expanded segments are persisted
- [x] Read execution.ts — orch branch creation per-repo in workspace mode
- [x] Trace `allocTask.task.taskFolder undefined` crash
- [x] Trace workspace orch branch gaps
- [x] Document findings

---

### Step 1: Fix Segment Expansion Resume Crash
**Status:** ✅ Complete

- [x] Fix `reconstructAllocatedLanes` to always set `taskFolder` on task stubs (resume.ts)
- [x] Add guard in `buildExecutionUnit` for missing/empty `taskFolder` (execution.ts)
- [x] Add guard in `buildMergeRequest` and merge sort for null `task` stubs (merge.ts)
- [x] Add guard in abort.ts for null task stubs
- [x] Run targeted tests: resume*.test.ts (37 pass, 0 fail)

---

### Step 2: Fix Workspace Orch Branch Coverage
**Status:** ✅ Complete

- [x] Refactor `ensureTaskFilesCommitted` to commit on orch branch, not base branch (execution.ts)
- [x] Add `runGitWithEnv` helper to git.ts for plumbing-based orch branch commits
- [x] Add orch branch existence verification in resume path (resume.ts)
- [x] Run targeted tests: workspace*.test.ts (94 pass), engine*.test.ts (78 pass)

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

- [x] FULL test suite passing (3290 tests, 0 failures)
- [x] Regression test: resume after segment expansion (3 tests in resume-segment-frontier.test.ts)
- [x] Regression test: workspace all repos have orch branch (3 tests in engine-segment-frontier.test.ts)
- [x] All failures fixed (zero failures in full suite)

---

### Step 4: Documentation & Delivery
**Status:** ✅ Complete

- [x] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Bug #1 root cause: `reconstructAllocatedLanes` in resume.ts creates task stubs without `taskFolder` when `persistedTask.taskFolder` is empty string (falsy check). The stub has other fields (segmentIds, etc.) so it's not null, but `taskFolder` is `undefined`. Crash when `buildExecutionUnit` (execution.ts:2097) or merge code accesses `task.task.taskFolder`. | Fix in Step 1 | resume.ts:161, execution.ts:2097, merge.ts:1945 |
| Bug #2 root cause: `ensureTaskFilesCommitted` (execution.ts:1399) commits task files on the primary repo's current branch (e.g. main), not the orch branch. The orch branch is updated via ff/merge afterward, but the base branch is also modified, breaking isolation. | Fix in Step 2 | execution.ts:1399-1580 |
| Bug #2 additional: In resume path, orch branch is not re-verified in all workspace repos before wave execution. If orch branch was deleted/corrupted, `resolveBaseBranch` silently falls back to repo's current branch. | Fix in Step 2 | resume.ts, waves.ts:564 |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-12 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-12 15:16 | Task started | Runtime V2 lane-runner execution |
| 2026-04-12 15:16 | Step 0 started | Preflight and Root Cause Analysis |
| 2026-04-12 15:47 | Worker iter 1 | done in 1881s, tools: 226 |
| 2026-04-12 15:47 | Task complete | .DONE created |

---

## Blockers

*None*

---

## Notes

GitHub issues: #441, #458
