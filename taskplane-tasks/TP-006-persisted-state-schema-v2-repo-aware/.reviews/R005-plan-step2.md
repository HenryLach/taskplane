# Plan Review — TP-006 Step 2

## Verdict: REVISE

Step 2 is not hydrated enough yet for implementation. The current Step 2 plan in `STATUS.md` is still too coarse for a Level 3 review task.

## What I reviewed

- `taskplane-tasks/TP-006-persisted-state-schema-v2-repo-aware/PROMPT.md`
- `taskplane-tasks/TP-006-persisted-state-schema-v2-repo-aware/STATUS.md`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/orch-state-persistence.test.ts`
- `extensions/tests/fixtures/batch-state-v1-valid.json`
- `extensions/tests/fixtures/batch-state-valid.json`
- `extensions/tests/fixtures/batch-state-v2-workspace.json`

## Blocking plan gaps

1. **Step 2 checklist is not granular enough.**
   - It still has only the two prompt-level bullets.
   - For this task/review level, Step 2 needs explicit implementation/test sub-items.

2. **No explicit scope boundary for migration behavior.**
   - `persistence.ts` already contains v1→v2 upconversion (`upconvertV1toV2`) and v1 acceptance in `validatePersistedState()`.
   - The plan must explicitly state whether Step 2 is: (a) hardening existing path, or (b) adding new migration logic.

3. **“v1 and v2 loading paths” are not concretely defined in the plan.**
   - The step should explicitly require **file-load path** coverage (`loadBatchState()`), not only validator-path coverage.
   - It should also call out the intended no-rewrite behavior for v1 files (in-memory upconversion only).

## Required plan fixes before implementation

Add a hydrated Step 2 checklist in `STATUS.md` like:

- [ ] Confirm compatibility policy in code path: `loadBatchState()` → `validatePersistedState()` → `upconvertV1toV2()` (in-memory only, no auto-rewrite).
- [ ] Add regression test: loading `batch-state-v1-valid.json` through **load path** yields v2 in memory (`schemaVersion=2`, `mode="repo"`, `baseBranch=""`) while preserving existing task/lane records.
- [ ] Add regression test: v1 file is **not rewritten on load** (on-disk schema remains 1 until an explicit save path runs).
- [ ] Add regression tests for v2 load paths (repo-mode fixture and workspace-mode fixture) to ensure no compatibility regressions.
- [ ] Add guardrail test for unsupported schema versions (`>2`) returning `STATE_SCHEMA_INVALID` with actionable message.
- [ ] Run targeted persistence tests and full extension test suite.

## Non-blocking note

- `STATUS.md` header metadata is inconsistent (`Status: ✅ Complete` while Step 2 is marked in progress). Clean this up for operator clarity.
