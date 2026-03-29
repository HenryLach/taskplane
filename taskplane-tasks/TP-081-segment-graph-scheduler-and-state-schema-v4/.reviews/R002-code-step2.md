# R002 — Code Review (Step 2: Implement persistence + migration)

## Verdict
**REQUEST CHANGES**

Step 2 made solid progress on schema v4 migration/validation, but there is one **blocking persistence gap** that will cause v4 task-level metadata loss across normal state rewrites.

---

## What I reviewed
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/types.ts` (changed `ParsedTask` fields used by persistence)
- `extensions/tests/state-migration.test.ts`
- Neighbor consistency checks in existing persistence/resume patterns

Commands run:
- `git diff eb73686d7e5d5e0e4ef4919fa06e9e33e10d0cfe..HEAD --name-only`
- `git diff eb73686d7e5d5e0e4ef4919fa06e9e33e10d0cfe..HEAD`
- `cd extensions && npx vitest run tests/state-migration.test.ts`
- `cd extensions && npx vitest run tests/orch-state-persistence.test.ts`

---

## Blocking finding

### 1) v4 task-level segment metadata is not preserved for non-currently-allocated tasks
**Severity:** High

**Where:**
- `extensions/taskplane/persistence.ts:1198-1210`
- `extensions/taskplane/persistence.ts:280-289`

**Issue:**
`serializeBatchState()` writes `packetRepoId`, `packetTaskPath`, `segmentIds`, `activeSegmentId` only when a task is present in the **current** `lanes` allocation (`allocated?.allocatedTask...`).

For tasks that are:
- in future waves (in `wavePlan` but not allocated yet), or
- from previous waves (no longer in current `lanes`),

those v4 fields are dropped unless separately re-enriched.

`persistRuntimeState()` currently only re-enriches:
- `taskFolder`
- `repoId`
- `resolvedRepoId`

It does **not** re-enrich v4 task-level fields, and there is no existing-state fallback merge for per-task fields. So repeated persists can erase v4 task metadata.

**Why this matters:**
This breaks the stated v4 persistence contract for task-level segment metadata and risks resume ambiguity after subsequent writes.

**Recommended fix:**
- Add enrichment/fallback for `packetRepoId`, `packetTaskPath`, `segmentIds`, `activeSegmentId` (analogous to existing repo field enrichment), and/or
- Merge from previously loaded persisted task records when current serialized record lacks these fields.
- Add regression tests that prove these fields survive across at least two consecutive persists where the task is not present in the second persist’s `lanes`.

---

## Non-blocking note

- `validatePersistedState()` JSDoc still describes v3 behavior (`always v3`, v1→v2→v3 wording) even though implementation now upconverts to v4. (`extensions/taskplane/persistence.ts:406-417`)

This is docs-only drift, but should be updated for maintainability.

---

## Summary
Migration/version-guard work is mostly correct (v1/v2/v3 accepted, v4 validated, future versions rejected with actionable messaging). The remaining blocker is **field durability** for new v4 task metadata during ongoing persistence cycles.