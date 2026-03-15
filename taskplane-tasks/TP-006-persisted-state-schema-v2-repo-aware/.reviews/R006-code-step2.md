# Code Review — TP-006 Step 2

## Verdict: APPROVE

Step 2 is in good shape for its stated scope (schema v1 compatibility hardening via regression coverage on the load path).

## What I reviewed

- Diff range: `c13e2db..HEAD`
- Changed files:
  - `extensions/tests/orch-state-persistence.test.ts`
  - `taskplane-tasks/TP-006-persisted-state-schema-v2-repo-aware/STATUS.md`
  - task review metadata files under `.reviews/`
- Neighboring source files for consistency checks:
  - `extensions/taskplane/persistence.ts`
  - `extensions/taskplane/resume.ts`

## Validation run

- `cd extensions && npx vitest run tests/orch-state-persistence.test.ts` ✅
- `cd extensions && npx vitest run` ✅ (207 passed)

## Assessment

The newly added Step 2 tests in `extensions/tests/orch-state-persistence.test.ts` correctly exercise the intended compatibility policy through `loadBatchState()`:

- v1 accepted and upconverted in-memory to v2 defaults (`schemaVersion=2`, `mode="repo"`, `baseBranch=""`)
- no implicit on-disk rewrite during load
- explicit save after load persists v2
- v2 repo/workspace fixtures remain valid
- guardrails for unsupported versions, malformed JSON, and missing required v2 `mode`
- compatibility across resume-path helpers (eligibility/reconcile/resume-point/orphan decision flow)

These expectations are consistent with current runtime behavior in `extensions/taskplane/persistence.ts` (`validatePersistedState`, `upconvertV1toV2`, `loadBatchState`) and `extensions/taskplane/resume.ts` (`computeResumePoint` semantics).

## Non-blocking note

- There is substantial overlap between the new section `1.4` and sections `7.1–7.3` in `extensions/tests/orch-state-persistence.test.ts` (many scenarios are effectively duplicated). This is not incorrect, but it does increase maintenance burden and risk drift. Consider consolidating in a follow-up cleanup.
