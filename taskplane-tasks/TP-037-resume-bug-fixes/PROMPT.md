# Task: TP-037 — Resume Bug Fixes & State Coherence

**Created:** 2026-03-21
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Targeted bug fixes to resume logic. Well-understood failure patterns with clear reproduction steps. Low blast radius.
**Score:** 3/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-037-resume-bug-fixes/
├── PROMPT.md   ← This file
├── STATUS.md   ← Execution state
├── .reviews/   ← Reviewer output
└── .DONE       ← Created when complete
```

## Mission

Fix two critical resume bugs discovered during the v0.6.0 batch run (issue #102):

1. **Resume skips wave merge (bug #102):** When all tasks in a wave have `.DONE`
   but the merge failed (e.g., timeout), `/orch-resume` skips the wave entirely
   without retrying the merge. The resume logic checks task completion but not
   merge completion.

2. **Stale session names mark pending tasks as failed (bug #102b):** When pending
   tasks (future waves, never started) have a `sessionName` from a previous
   failed resume attempt, the reconciliation logic marks them as "failed" instead
   of "pending" because it sees a dead session name.

Also add state coherence validation: on resume, verify that `mergeResults`
aligns with `currentWaveIndex` before advancing.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/watchdog-and-recovery-tiers.md` — Section 5.2 Patterns 3 and 5, Section 13.10
- `extensions/taskplane/resume.ts` — `reconcileTaskStates()` and `computeResumePoint()`
- `extensions/taskplane/engine.ts` — wave advancement logic

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/resume.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/engine.ts`
- `extensions/tests/force-resume.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read `reconcileTaskStates()` — understand how Precedence 5 vs 6 works
- [ ] Read `computeResumePoint()` — understand how waves are skipped
- [ ] Read engine wave advancement — where `mergeResults` is checked (or not checked)
- [ ] Identify the exact code paths for both bugs

### Step 1: Fix Resume Merge Skip (Bug #102)

- [ ] In `computeResumePoint()` or the engine's wave advancement: before skipping a wave where all tasks are terminal, verify that `mergeResults` for that wave exists and has `status: "succeeded"`
- [ ] If merge is missing or failed: do NOT skip the wave — flag it for merge retry
- [ ] Add state coherence validation: on resume, check that `mergeResults.length` is consistent with completed waves

**Artifacts:**
- `extensions/taskplane/resume.ts` (modified)
- `extensions/taskplane/engine.ts` (modified)

### Step 2: Fix Stale Session Names (Bug #102b)

- [ ] In `reconcileTaskStates()` Precedence 5: relax the condition — if `task.status === "pending"` AND the session is not alive AND no worktree exists, treat as pending regardless of whether `sessionName` is set
- [ ] Clear stale `sessionName` and `laneNumber` for these tasks during reconciliation

**Artifacts:**
- `extensions/taskplane/resume.ts` (modified)

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: all wave tasks succeeded but mergeResult missing → wave flagged for merge retry, not skipped
- [ ] Test: pending task with stale sessionName + dead session → reconciled as "pending" not "mark-failed"
- [ ] Test: state coherence catches misaligned mergeResults vs waveIndex
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (internal bug fix)

**Check If Affected:**
- `docs/explanation/persistence-and-resume.md` — if resume eligibility description changes

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Bug #102: resume retries merge when tasks succeeded but merge didn't
- [ ] Bug #102b: pending tasks with stale session names stay pending
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-037): complete Step N — description`
- **Bug fixes:** `fix(TP-037): description`
- **Tests:** `test(TP-037): description`
- **Hydration:** `hydrate: TP-037 expand Step N checkboxes`

## Do NOT

- Change the merge flow itself (that's TP-038)
- Modify how tasks are executed or spawned
- Change the batch state schema (v3 is stable)

---

## Amendments (Added During Execution)
