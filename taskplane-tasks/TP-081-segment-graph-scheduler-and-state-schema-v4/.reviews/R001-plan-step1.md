# R001 — Plan Review (Step 1: Add schema v4 contracts)

## Verdict
**Approved with minor adjustments** — Step 1 contract planning is aligned with the TP-081 prompt and the v4 spec, and is ready to proceed.

## Reviewed artifacts
- `taskplane-tasks/TP-081-segment-graph-scheduler-and-state-schema-v4/PROMPT.md`
- `taskplane-tasks/TP-081-segment-graph-scheduler-and-state-schema-v4/STATUS.md`
- `docs/specifications/taskplane/multi-repo-task-execution.md`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/tests/orch-state-persistence.test.ts`
- `extensions/tests/state-migration.test.ts`

## What looks good
1. **Spec-field coverage is present in contracts**
   - v4 task-level fields from spec are represented in `PersistedTaskRecord`: `packetRepoId`, `packetTaskPath`, `segmentIds`, `activeSegmentId` (`types.ts:2448-2475`).
   - v4 segment-level record includes required operational fields (`segmentId`, `repoId`, `status`, lane/session/worktree/branch, timestamps, retries, deps, diagnostics) (`types.ts:2504-2539`).
   - This matches the v4 persistence requirements (`multi-repo-task-execution.md:352-367`).

2. **Schema-level contract is explicit**
   - `BATCH_STATE_SCHEMA_VERSION` is set to 4 with version history and compatibility notes (`types.ts:2297-2328`).
   - `PersistedBatchState` includes required `segments: PersistedSegmentRecord[]` with migration intent documented (`types.ts:2655-2730`).

3. **Runtime handoff hook exists**
   - `OrchBatchRuntimeState` has a `segments?` field for resume/persistence carry-forward (`types.ts:1019-1023`).

## Minor adjustments requested (non-blocking)
1. **Prefer `SegmentId` aliases over raw `string` where possible**
   - In v4 persisted contracts, `segmentId`, `segmentIds`, `activeSegmentId`, and `dependsOnSegmentIds` are currently plain strings (`types.ts:2468-2475`, `2505-2531`).
   - Using `SegmentId`/`SegmentId[]` improves compile-time safety and reduces accidental format drift.

2. **Capture source-of-truth mapping for new task-level fields before Step 2**
   - Explicitly note where each v4 task field is sourced during serialization (`packetRepoId`, `packetTaskPath`, `segmentIds`, `activeSegmentId`) to avoid ad hoc defaults in `persistence.ts`.

3. **STATUS metadata consistency**
   - `STATUS.md` shows Step 1 complete, but header still says `Current Step: Step 0` (`STATUS.md:3`, `22-27`).

## Critical handoff notes for Step 2 (not Step 1 blockers)
1. **v3 compatibility must remain accepted during v4 rollout**
   - Current validation version gate is `const ACCEPTED_VERSIONS = [1, 2, BATCH_STATE_SCHEMA_VERSION]` (`persistence.ts:415`).
   - With schema version 4, this currently excludes v3 unless explicitly added.

2. **`segments` is not yet first-class in persistence validation/serialization**
   - `segments` is missing from known top-level fields (`persistence.ts:937-945`) and not emitted in serialized output (`persistence.ts:1097-1125`).
   - This is expected for Step 2, but should be treated as required work before marking migration complete.

3. **Legacy persistence tests are version-pinned and will need v4 migration updates**
   - `orch-state-persistence.test.ts` hardcodes `BATCH_STATE_SCHEMA_VERSION = 2` (`orch-state-persistence.test.ts:97`).
   - `state-migration.test.ts` still asserts schema constant is 3 (`state-migration.test.ts:710-712`).

Overall: Step 1 contract planning is sound and aligned; proceed, with the above clarifications captured before Step 2 implementation.