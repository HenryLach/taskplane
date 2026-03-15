# Code Review — TP-006 Step 0 (Define schema v2)

## Verdict: REVISE

## What I reviewed
- Diff range: `89f3123..HEAD`
- Changed runtime/types:
  - `extensions/taskplane/types.ts`
  - `extensions/taskplane/persistence.ts`
- Changed tests/fixtures:
  - `extensions/tests/orch-state-persistence.test.ts`
  - `extensions/tests/fixtures/batch-state-*.json`
- Neighboring consistency checks:
  - `extensions/taskplane/engine.ts`
  - `extensions/taskplane/resume.ts`
  - `extensions/taskplane/extension.ts`

## Findings

### 1) `mode` is documented as required in v2, but validator still accepts missing `mode` in v2 files
**Severity:** Medium  
**Location:** `extensions/taskplane/persistence.ts:377-383`, `extensions/taskplane/persistence.ts:614`

`validatePersistedState()` only validates `mode` *if present*:
- `if (obj.mode !== undefined && typeof obj.mode !== "string") ...`
- `if (obj.mode !== undefined && obj.mode !== "repo" && obj.mode !== "workspace") ...`

Then `upconvertV1toV2()` is called unconditionally and defaults `mode` when falsy (`if (!obj.mode) obj.mode = "repo"`).
That means a **schemaVersion=2** file with missing `mode` is accepted and silently defaulted, which conflicts with the step’s stated v2 contract (“mode required”).

**Suggested fix:**
- Enforce `mode` presence when `schemaVersion === 2`.
- Keep defaulting behavior only for v1 upconversion path.

---

### 2) New migration/workspace fixtures are added but not exercised by tests
**Severity:** Medium  
**Location:**
- Added fixtures: `extensions/tests/fixtures/batch-state-v1-valid.json`, `extensions/tests/fixtures/batch-state-v2-workspace.json`
- Test usage scan: `extensions/tests/orch-state-persistence.test.ts:423,454,464,474,484`

The new fixtures for critical behaviors (v1→v2 upconversion and workspace-mode repo-aware records) are present but not referenced by assertions. Current tests still only load:
- `batch-state-valid.json`
- `batch-state-wrong-version.json`
- `batch-state-missing-fields.json`
- `batch-state-bad-enums.json`
- `batch-state-bad-task-status.json`

So the new compatibility contract is not actually regression-tested yet.

**Suggested fix:**
- Add assertions that:
  - loading `batch-state-v1-valid.json` returns `schemaVersion===2`, `mode==="repo"`, `baseBranch===""`;
  - loading `batch-state-v2-workspace.json` preserves `mode==="workspace"` and validates task/lane repo fields.

## Validation run
- `cd extensions && npx vitest run` ✅ (11 files, 207 tests passed)

