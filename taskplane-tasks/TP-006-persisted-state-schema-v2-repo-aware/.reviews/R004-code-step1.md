# Code Review — TP-006 Step 1

## Verdict: REVISE

Step 1 is not ready to mark complete yet. The diff adds useful fixture/test coverage, but there are blocking gaps against the stated step goal (**implement serialization and validation**) and one important test/source drift issue.

## What I reviewed

- Diff range: `e50e7c7..HEAD`
- Changed files:
  - `extensions/tests/fixtures/batch-state-v2-bad-repo-fields.json`
  - `extensions/tests/orch-state-persistence.test.ts`
  - task tracking/review metadata files under `taskplane-tasks/TP-006-persisted-state-schema-v2-repo-aware/`
- Neighboring implementation files for consistency:
  - `extensions/taskplane/persistence.ts`
  - `extensions/taskplane/resume.ts`
- Validation run:
  - `cd extensions && npx vitest run tests/orch-state-persistence.test.ts` ✅

## Blocking findings

### 1) Step objective says “implement serialization and validation”, but this checkpoint contains no runtime implementation changes

**Why this blocks:** Step 1 status claims implementation complete, but in this commit range there are no edits to runtime files (notably `extensions/taskplane/persistence.ts` / `types.ts`), only tests/fixtures and task metadata. If implementation was intended in this step, it is not present in the reviewed diff.

**Evidence:** `git diff e50e7c7..HEAD --name-only` contains no `extensions/taskplane/*.ts` runtime files.

---

### 2) Added “workspace mode” serialization tests do not actually validate runtime mode propagation and diverge from source behavior

**Why this blocks:** New tests are being used as proof for Step 1 serialization correctness, but the reimplemented serializer logic in test file is not aligned with source in key places. This can yield false confidence.

**Examples:**

- Test serializer hardcodes mode to repo:
  - `extensions/tests/orch-state-persistence.test.ts:1242` → `mode: "repo"`
- Runtime serializer uses state mode:
  - `extensions/taskplane/persistence.ts:734` → `mode: state.mode ?? "repo"`

And the updated E2E/pending semantics in test reimplementation diverge from source resume logic:

- Test treats `mark-failed` as pending:
  - `extensions/tests/orch-state-persistence.test.ts:2391`
- Runtime only includes `reconnect` / `re-execute` / specific `skip+pending` as pending:
  - `extensions/taskplane/resume.ts:305-311`

Because this step is being validated primarily through these tests, this mismatch is material.

## Non-blocking notes

- New malformed fixture (`batch-state-v2-bad-repo-fields.json`) is useful and appropriately targets type invalidity for repo fields.
- Added null/object/array/invalid-mode checks improve schema guard coverage.

## Required fixes

1. If Step 1 truly requires implementation in this checkpoint, include the actual runtime changes in the diff (or re-baseline the step if implementation already landed earlier).
2. Align `orch-state-persistence.test.ts` reimplemented logic with current runtime source for:
   - serializer `mode` handling,
   - pending-task categorization in resume logic,
   - (ideally) merge results mapping source as well.
3. Re-run targeted tests after alignment.

