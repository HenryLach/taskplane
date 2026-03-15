# Plan Review — TP-006 Step 0

## Verdict: REVISE

Step 0 is not hydrated enough yet to be implementation-ready. `STATUS.md` still has only checklist bullets, but this step needs an explicit schema contract before code changes start.

## What I reviewed

- `taskplane-tasks/TP-006-persisted-state-schema-v2-repo-aware/PROMPT.md`
- `taskplane-tasks/TP-006-persisted-state-schema-v2-repo-aware/STATUS.md`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/tests/orch-state-persistence.test.ts`
- `extensions/tests/fixtures/batch-state-*.json`

## Required plan fixes before implementation

1. **Define exact v2 schema deltas (field-by-field) for lane/task records.**
   - Current state already has lane-level `repoId?: string` (`types.ts:1209-1223`, serialized in `persistence.ts:614-615`).
   - Plan must specify what *new* repo-aware task fields are added to `PersistedTaskRecord` (currently none in `types.ts:1182+`) and whether each is required/optional in repo vs workspace mode.

2. **Define source-of-truth for each new persisted field.**
   - `serializeBatchState()` currently builds tasks from wave/outcome maps and only enriches `taskFolder` later (`persistence.ts:585+`, `persistence.ts:231`).
   - Plan must state how task repo attribution is derived for:
     - allocated tasks (lane-linked), and
     - unallocated/pending tasks (not yet lane-bound).

3. **Define compatibility policy now (even if implementation is Step 2).**
   - Validator currently hard-rejects non-current schema version (`persistence.ts:304-308`).
   - If `BATCH_STATE_SCHEMA_VERSION` is bumped (`types.ts:1136`), v1 files will immediately fail unless migration path is planned.
   - Step 0 must document whether v1 is auto-upconverted or blocked with explicit guardrails, and list defaulting rules (including existing `baseBranch` backfill behavior from `persistence.ts:323` / `persistence.ts:536`).

4. **List concrete test/fixture impact in the plan.**
   - `orch-state-persistence.test.ts` hardcodes v1 (`line 97`) and asserts `schemaVersion === 1` (`line 395`).
   - All batch-state fixtures are schemaVersion 1.
   - Step 0 plan should explicitly call out which fixture files are updated for v2 and which v1 fixtures are retained for compatibility tests.

5. **Add documentation targets for schema contract.**
   - Prompt requires documenting field contracts/compatibility expectations; plan should name exact sections/files to edit (at minimum `types.ts` persistence type comments and the required local polyrepo implementation doc).

## Suggested minimal Step 0 contract text to add in STATUS

- `schemaVersion` bumped to 2.
- `PersistedTaskRecord` includes repo attribution field(s) (clearly typed and mode semantics defined).
- `PersistedLaneRecord.repoId` contract clarified for repo mode (`undefined`) vs workspace mode (non-empty repo ID).
- v1->v2 compatibility behavior declared (auto-upconvert + defaults, or explicit fail-fast policy).
- Fixture/test update map listed (v2 fixtures + retained v1 fixture coverage for Step 2).

