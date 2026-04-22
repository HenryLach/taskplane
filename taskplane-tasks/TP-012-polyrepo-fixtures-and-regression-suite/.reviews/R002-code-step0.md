# R002 — Code Review (Step 0: Build polyrepo fixture workspace)

## Verdict
**REVISE**

The implementation is close and test coverage is solid, but there is one blocking topology mismatch and one consistency issue that should be fixed before treating Step 0 as complete.

## Scope reviewed
Diff range: `cf37326..HEAD`

Files:
- `extensions/tests/fixtures/polyrepo-builder.ts`
- `extensions/tests/fixtures/batch-state-v2-polyrepo.json`
- `extensions/tests/polyrepo-fixture.test.ts`
- `taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/STATUS.md`

## Validation performed
- `cd extensions && npx vitest run tests/polyrepo-fixture.test.ts` ✅ (32 passed)
- `cd extensions && npx vitest run` ✅ (322 passed)

## Findings

### 1) Blocking: fixture does not implement the stated “docs repo task root” contract
**Severity:** High

**Evidence**
- Step requirement explicitly says: “docs repo task root” (`taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/PROMPT.md:69`).
- Builder currently places tasks at workspace root:
  - `const tasksRoot = join(workspaceRoot, "tasks");` (`extensions/tests/fixtures/polyrepo-builder.ts:310`)
- Meanwhile, comments and static fixture imply docs-hosted task root:
  - topology comment: `tasks/ ... (in docs repo)` (`extensions/tests/fixtures/polyrepo-builder.ts:15`)
  - static task folders under `/workspace/repos/docs/tasks/...` (`extensions/tests/fixtures/batch-state-v2-polyrepo.json:52,64,76,89,101,114`)

**Why this matters**
- The runtime fixture and static fixture currently model different workspace layouts.
- This weakens Step 0’s “canonical fixture” goal and can hide path-sensitive regressions.

**Requested change**
- Make topology consistent with the Step 0 contract (recommended: set `tasksRoot` under docs repo, e.g. `join(repoPaths.docs, "tasks")`), **or** explicitly amend Step 0 contract/comments to define external tasks root as intentional.
- Add one acceptance assertion that `fixture.tasksRoot` is (or is not) under `fixture.repoPaths.docs`, depending on intended design.

---

### 2) Consistency: helper ParsedTask review level diverges from on-disk prompt parsing
**Severity:** Medium

**Evidence**
- Discovery parser defaults `reviewLevel` to 2 when no `## Review Level` section exists (`extensions/taskplane/discovery.ts:130`).
- Generated fixture prompts do not include a review-level section (`extensions/tests/fixtures/polyrepo-builder.ts`, `generatePrompt(...)`).
- Helper builder hardcodes `reviewLevel: 1` (`extensions/tests/fixtures/polyrepo-builder.ts:449`).

**Why this matters**
- `buildFixtureParsedTasks()` is intended as a discovery substitute, but it currently produces a different `ParsedTask` contract than `runDiscovery()` for the same fixture content.
- This can create subtle false positives/negatives in downstream tests.

**Requested change**
- Align helper with parser behavior (set review level to 2), or include `## Review Level: 1` in generated prompts and keep helper at 1.

---

### 3) Non-blocking hygiene: STATUS.md contains duplicated review/log rows
**Severity:** Low

**Evidence**
- Duplicate review row and malformed table structure (`taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/STATUS.md:66-69`).
- Duplicated “Task started / Step 0 started” events (`STATUS.md:79-82`).

**Requested change**
- Deduplicate entries and restore the table separator/header ordering.
