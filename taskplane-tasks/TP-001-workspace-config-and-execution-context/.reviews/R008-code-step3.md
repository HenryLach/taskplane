# R008 Code Review — Step 3: Testing & Verification

## Verdict
**CHANGES REQUESTED**

## Scope Reviewed
Changed in `17ed0ba..HEAD`:
- `extensions/taskplane/extension.ts`
- `extensions/tests/workspace-config.test.ts`
- `taskplane-tasks/TP-001-workspace-config-and-execution-context/STATUS.md`
- task review/request artifacts under `taskplane-tasks/.../.reviews/*`

Neighbor/context checked:
- `extensions/taskplane/workspace.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/tests/worktree-lifecycle.test.ts`
- `taskplane-tasks/TP-001-workspace-config-and-execution-context/PROMPT.md`

## What looks good
- Added strong targeted coverage for workspace config validation and execution context basics (38 passing tests).
- Root threading in `extension.ts` was consistently moved to `execCtx.repoRoot` for discovery/orphan/state/abort paths.
- CLI smoke checks (`help`, `doctor`) were executed and results were documented.

## Findings

### 1) Step 3 marked complete while full suite is still red (violates task contract)
- **Severity:** High
- **Files:**
  - `taskplane-tasks/TP-001-workspace-config-and-execution-context/PROMPT.md:78-85`
  - `taskplane-tasks/TP-001-workspace-config-and-execution-context/STATUS.md:66-67,120-122`
- **Issue:** PROMPT explicitly says **“ZERO test failures allowed”**, but Step 3 is marked complete while full `vitest` still has failing suites.
- **Validation evidence:** `cd extensions && npx vitest run` currently fails with 4 failed files.
- **Required fix:** Do not mark Step 3 complete until full suite is green, or explicitly mark Step 3 blocked/incomplete per prompt contract.

### 2) Regression coverage still misses known startup-safety defects
- **Severity:** High
- **Files:**
  - `extensions/taskplane/extension.ts:82-89,307-350,618-623,628-650`
  - `extensions/tests/workspace-config.test.ts:510-575`
- **Issue:** New “root-consistency” tests are source-string checks only and do not execute startup/command behavior. Two known correctness risks remain untested (and still present):
  - stale `execCtx` can persist across failed `session_start` (no reset before `buildExecutionContext`),
  - startup guard is not applied to `/orch-status`, `/orch-pause`, `/orch-sessions`.
- **Required fix:** Add behavioral tests that simulate startup failure and assert:
  1) `execCtx` is cleared on failure, and
  2) command behavior under failed init is intentional/consistent across command surface.

### 3) New git test helper is environment-dependent (can fail without global git identity)
- **Severity:** Medium
- **File:** `extensions/tests/workspace-config.test.ts:52-64`
- **Issue:** `initGitRepo()` runs `git commit --allow-empty` without setting local `user.name`/`user.email`. This can fail on clean CI/dev machines.
- **Pattern mismatch:** `extensions/tests/worktree-lifecycle.test.ts:139-140` sets local git identity explicitly.
- **Required fix:** Set repo-local git config in `initGitRepo()` before committing (or pass `-c user.name=... -c user.email=...` per command).

### 4) Root-consistency tests are brittle against comments/formatting
- **Severity:** Medium
- **File:** `extensions/tests/workspace-config.test.ts:543-549`
- **Issue:** Assertions like counting `ctx.cwd` occurrences (including comments) are fragile and can fail on harmless text edits.
- **Required fix:** Prefer behavior-level assertions (or at minimum, assert specific call-site patterns) instead of global substring counts.

## Non-blocking
- `STATUS.md` reviews table is still malformed/duplicated (`STATUS.md:142-157`, separator at end).

## Validation Notes
Commands run:
- `git diff 17ed0ba..HEAD --name-only`
- `git diff 17ed0ba..HEAD`
- `cd extensions && npx vitest run tests/workspace-config.test.ts` ✅ (38 passed)
- `cd extensions && npx vitest run` ❌ (4 failed files)
- `node bin/taskplane.mjs help` ✅ (exit 0)
- `node bin/taskplane.mjs doctor` ⚠️ expected config-missing exit 1
