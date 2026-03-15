# R002 — Code Review (Step 0: Implement repo-aware reconciliation)

## Verdict
**Changes requested**

## Reviewed diff
- `extensions/taskplane/resume.ts`
- `extensions/tests/orch-state-persistence.test.ts`
- task tracking artifacts under `taskplane-tasks/TP-007-resume-reconciliation-across-repos/`

## Validation run
- `cd extensions && npx vitest run` ✅ (12 files, 290 tests passing)

## Blocking findings

### 1) Repo-root cleanup/reset set is built from **persisted** lanes only, so repos introduced during resumed execution can be missed
- **File:** `extensions/taskplane/resume.ts`
- **Lines:** around `1084`, `1119`

Both inter-wave reset and terminal cleanup build repo roots from `persistedState.lanes` only.

That is not sufficient once resume continues into later waves: later waves can allocate lanes in repos that were not present in the persisted snapshot (especially when the interruption happened in an earlier wave). In that case, worktrees in those newly-touched repos are not reset/cleaned.

**Why this matters:** recoverability + deterministic cleanup are core invariants. This can leave orphaned worktrees after a successful resume.

**Suggested fix:** build cleanup/reset roots from a union of:
- persisted lanes, and
- repos seen in resumed execution (`latestAllocatedLanes`/wave lane results/re-exec lanes),
or maintain a `seenRepoRoots` set throughout `resumeOrchBatch`.

---

### 2) `collectRepoRoots()` contract diverges from the actual reset/cleanup logic
- **File:** `extensions/taskplane/resume.ts`
- **Lines:** helper at `40+`, reset/cleanup loops at `1083+` and `1118+`

`collectRepoRoots()` says it always includes `defaultRepoRoot`, but the actual reset/cleanup code does not use this helper and only adds default root when the set is empty.

This mismatch creates behavior drift and makes the helper misleading/unverified in production flow.

**Suggested fix:** use `collectRepoRoots()` directly in both sites (or remove the helper). Keep one source of truth.

## Non-blocking

### A) Duplicate mixed-repo test blocks create unnecessary duplication/noise
- **File:** `extensions/tests/orch-state-persistence.test.ts`
- **Lines:** `4067+` (section 7.1) and `4441+` (section 8.1)

There are two large, overlapping mixed-repo sections with duplicate helper names (`resolveRepoRoot` declared twice). Tests pass, but this adds maintenance burden and can hide drift.

---

Once the blocking items are addressed, this step is close — the direction is correct and test coverage breadth improved substantially.
