# Task: TP-135 - Segment Persistence and Resume

**Created:** 2026-04-03
**Size:** M

## Review Level: 2 (Plan + Code)

**Assessment:** Persistence and resume must track segment-level state for crash recovery. High correctness impact — resume bugs can duplicate or skip segment execution.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-135-segment-persistence-and-resume/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Populate and maintain `PersistedTaskRecord.segments[]` during execution and teach `resume.ts` to reconstruct the segment frontier from persisted state. Currently, schema v4 has segment fields defined in types but they're never populated or consumed at runtime.

### What already exists

- `types.ts`: `PersistedSegmentRecord` with segmentId, taskId, repoId, status, laneId, sessionName, worktreePath, branch, startedAt, endedAt, retries, exitDiagnostic, exitReason, dependsOnSegmentIds
- `ParsedTask` has `segmentIds[]`, `activeSegmentId`, `packetRepoId`
- `persistence.ts`: Schema v4 migration adds `segments: []` to batch state
- `resume.ts`: Full resume algorithm exists for task-level state — no segment awareness

### What's missing

- `segments[]` array in batch state is never populated during execution
- Resume doesn't reconstruct segment frontier — it only knows task-level status
- No segment lifecycle events in persistence (start/complete/fail)
- No reconciliation of in-flight segments after crash

## Dependencies

- **Task:** TP-133 (engine segment frontier)

## Context to Read First

- `extensions/taskplane/persistence.ts` — batch state serialization, task outcome tracking
- `extensions/taskplane/resume.ts` — resume reconciliation algorithm
- `extensions/taskplane/types.ts` — PersistedSegmentRecord, schema v4 fields
- `extensions/taskplane/engine.ts` — how engine calls persistence during execution

## File Scope

- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/engine.ts` (segment lifecycle event emission)
- `extensions/taskplane/types.ts` (minor, if needed)
- `extensions/tests/orch-state-persistence.test.ts`
- `extensions/tests/*.test.ts`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Trace how persistence.ts populates task outcomes during execution
- [ ] Trace how resume.ts reconciles task state after crash
- [ ] Read PersistedSegmentRecord fields

### Step 1: Populate segments during execution
- [ ] On segment start: create/update PersistedSegmentRecord with status "running"
- [ ] On segment complete: update status to "succeeded", set endedAt
- [ ] On segment failure: update status to "failed", include exit diagnostic
- [ ] Persist segment state alongside task state in batch-state.json
- [ ] Maintain activeSegmentId on the task record

### Step 2: Resume reconstruction
- [ ] On resume, read persisted segments[] to determine segment frontier
- [ ] Identify completed segments (don't re-execute)
- [ ] Identify in-flight segments at crash time (re-execute from segment start)
- [ ] Identify pending segments (not yet started)
- [ ] Reconstruct segment DAG from persisted edges + segment plans
- [ ] Resume from the first incomplete segment

### Step 3: Reconciliation edge cases
- [ ] Handle: crash mid-segment (segment running, no .DONE) → re-execute segment
- [ ] Handle: crash between segments (segment A done, segment B not started) → start B
- [ ] Handle: crash with all segments complete → task complete
- [ ] Handle: segment failed, dependents blocked → same policy as task-level failure

### Step 4: Tests
- [ ] Test: segments populated in batch-state.json during execution
- [ ] Test: resume reconstructs segment frontier correctly
- [ ] Test: mid-segment crash resumes from correct segment
- [ ] Test: between-segment crash resumes from correct segment
- [ ] Test: repo-singleton tasks resume unchanged
- [ ] Run full suite, fix failures

### Step 5: Documentation & Delivery
- [ ] Update STATUS.md

## Do NOT

- Change PersistedSegmentRecord shape (already correct in types.ts)
- Implement dynamic expansion resume (deferred)
- Break single-repo resume behavior

## Git Commit Convention

- `feat(TP-135): complete Step N — ...`
