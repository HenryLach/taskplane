# R008 — Code Review (Step 3: Testing & Verification)

## Verdict
**REVISE**

Step 3 validation was run and test counts are correct, but the checkpoint has scope/control-plane issues that should be fixed before approval.

## Scope reviewed
Diff range: `1e61797..HEAD`

Changed files include:
- `taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/STATUS.md`
- TP-012 review artifacts under `.reviews/`
- **Unrelated task files:** `taskplane-tasks/TP-009-dashboard-repo-aware-observability/.DONE`, `taskplane-tasks/TP-009-dashboard-repo-aware-observability/STATUS.md`

## Validation performed
- `cd extensions && npx vitest run` ✅ (15 files, 398 passed)
- `cd extensions && npx vitest run tests/polyrepo-fixture.test.ts tests/polyrepo-regression.test.ts tests/monorepo-compat-regression.test.ts` ✅ (3 files, 108 passed)
- `node bin/taskplane.mjs help` ✅
- `node bin/taskplane.mjs doctor` ❌ exits 1 in this worktree due missing `.pi/*` config

## Findings

### 1) Blocking: step checkpoint includes out-of-scope changes to TP-009 artifacts
**Severity:** High

`TP-012` prompt file scope is limited to test/docs paths (`PROMPT.md:55-60`), but this step commit also modifies:
- `taskplane-tasks/TP-009-dashboard-repo-aware-observability/.DONE`
- `taskplane-tasks/TP-009-dashboard-repo-aware-observability/STATUS.md`

This violates scoped/reviewable change discipline and mixes task histories.

**Requested fix:** remove TP-009 changes from this step (or split into a separate task-appropriate commit).

---

### 2) Step 3 CLI verification statement does not match required command/observed behavior
**Severity:** Medium

In `STATUS.md`, Step 3 records:
- `CLI smoke checks passing (taskplane help and taskplane doctor both run correctly)` (`STATUS.md:52` in HEAD commit)

But Step 3 requirement in prompt is specifically:
- `node bin/taskplane.mjs help` (`PROMPT.md:89`)

Also, `node bin/taskplane.mjs doctor` currently exits non-zero in this repo state, so phrasing as fully “passing” is misleading unless explicitly documented as an expected non-zero diagnostic run.

**Requested fix:** record the exact required command/output (`node bin/taskplane.mjs help`, exit 0), and if doctor is included, log it as diagnostic execution with expected outcome semantics.

---

### 3) Status metadata inconsistency in the same file
**Severity:** Medium

In the reviewed HEAD content:
- `Current Step: Step 4` (`STATUS.md:3`)
- but Step 4 section says `Status: ⬜ Not Started` (`STATUS.md:57`)

This reduces operator clarity/auditability.

**Requested fix:** keep top-level step pointer and per-step status aligned.

---

### 4) Non-blocking hygiene: duplicated/malformed review table entries
**Severity:** Low

`STATUS.md` still has duplicate review rows and a misplaced table separator row (`|---|...|`) at the bottom of entries.

**Requested fix:** deduplicate rows and keep standard markdown table structure.
