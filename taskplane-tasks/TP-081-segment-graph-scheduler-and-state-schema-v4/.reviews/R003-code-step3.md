# R003 — Code Review (Step 3: Testing & Verification)

## Verdict
**REQUEST CHANGES**

Step 3 adds substantial v4 migration/validation coverage and updates older fixtures for schema v4 compatibility, but it still misses the key regression that protects v4 task-level metadata durability across normal persistence cycles.

---

## What I reviewed
- `extensions/tests/schema-v4-migration.test.ts` (new)
- Updated fixtures in:
  - `extensions/tests/force-resume.test.ts`
  - `extensions/tests/merge-failure-phase.test.ts`
  - `extensions/tests/partial-progress.integration.test.ts`
  - `extensions/tests/supervisor-force-merge.test.ts`
  - `extensions/tests/supervisor-recovery-tools.test.ts`
  - `extensions/tests/workspace-config.integration.test.ts`
- Neighbor consistency in `extensions/taskplane/persistence.ts` (serialize + enrichment paths)

Commands run:
- `git diff cf64871edc97b9abade558168a763bd8f118329a..HEAD --name-only`
- `git diff cf64871edc97b9abade558168a763bd8f118329a..HEAD`
- `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/schema-v4-migration.test.ts tests/force-resume.test.ts tests/merge-failure-phase.test.ts tests/partial-progress.integration.test.ts tests/supervisor-force-merge.test.ts tests/supervisor-recovery-tools.test.ts tests/workspace-config.integration.test.ts`
  - Result: **350 pass, 0 fail**

---

## Blocking finding

### 1) Missing regression for known v4 task-field durability gap (non-allocated tasks)
**Severity:** High

**Why this blocks Step 3:**
The task prompt requires regression tests, and this is the highest-risk persistence hole from Step 2.

**Evidence:**
- New round-trip section only validates `segments` persistence (`extensions/tests/schema-v4-migration.test.ts:617-773`).
- The helper used for round-trip rebuild (`buildRuntimeFromPersisted`) creates lane tasks from a dummy ParsedTask that omits v4 task-level fields (`packetRepoId`, `packetTaskPath`, `segmentIds`, `activeSegmentId`) (`extensions/tests/schema-v4-migration.test.ts:624-647`), so it cannot catch metadata loss.
- No test exercises `persistRuntimeState()` enrichment behavior for unallocated/future-wave tasks.

**Neighbor consistency check (still-uncovered behavior):**
- `serializeBatchState()` writes v4 task-level fields only from currently allocated lane tasks (`extensions/taskplane/persistence.ts:1199-1209`).
- `persistRuntimeState()` enrichment still only backfills `taskFolder`, `repoId`, `resolvedRepoId` (`extensions/taskplane/persistence.ts:280-289`), not the v4 task-level fields.

I also reproduced this behavior with a one-off runtime script: task-level v4 fields persisted for allocated TP-001, but dropped for unallocated TP-002 despite discovery containing packet metadata.

**Requested fix:**
Add a regression test that persists state across at least two writes where a task is not in current `lanes` on the second write, and assert `packetRepoId`, `packetTaskPath`, `segmentIds`, and `activeSegmentId` are preserved.

---

## Non-blocking note

- Test name mismatch: `"accepts v1, v2, v3, and v4"` currently asserts only v3/v4 in that case (`extensions/tests/schema-v4-migration.test.ts:788-794`). (v1 is covered elsewhere; v2 still not explicitly asserted in that block.)

---

## Summary
Great progress on schema v4 validation coverage and fixture compatibility updates. However, the most important regression guard (task-level v4 metadata durability across normal persistence rewrites) is still missing, so Step 3 is not complete yet.