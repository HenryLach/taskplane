# R009 — Plan Review (Step 4: Documentation & Delivery)

## Verdict
**Changes requested** — Step 4 is currently under-specified and cannot be executed safely yet.

## Reviewed artifacts
- `taskplane-tasks/TP-001-workspace-config-and-execution-context/PROMPT.md`
- `taskplane-tasks/TP-001-workspace-config-and-execution-context/STATUS.md`
- `taskplane-tasks/TP-001-workspace-config-and-execution-context/.reviews/R008-code-step3.md`
- `extensions/taskplane/workspace.ts`
- `extensions/taskplane/extension.ts`

## Blocking findings

### 1) Step 4 is not hydrated to the required documentation contract
- Current plan is only 5 coarse checkboxes (`STATUS.md:130-137`).
- PROMPT requires explicit updates to two specific docs (`PROMPT.md:97-100`) and review of `docs/reference/commands.md` (`PROMPT.md:101-103`).
- There is no concrete plan for *what* will be recorded (schema deltas, mode contract changes, error-code behavior, root semantics).

Also, required local docs path is currently missing in this worktree (`.pi/local/...` does not exist), but plan does not account for creating/populating it.

### 2) Plan diverges from PROMPT delivery lifecycle
- STATUS uses `Archive and push` (`STATUS.md:137`), but PROMPT says archive is auto-handled by task-runner (`PROMPT.md:93`).
- This introduces out-of-scope delivery behavior and weakens deterministic completion criteria.

### 3) Step 4 ignores unresolved Step 3 blockers and failing quality gate
- PROMPT requires zero test failures and all tests passing (`PROMPT.md:80-85`, `104-109`).
- Full suite is still red (`cd extensions && npx vitest run` currently fails with 4 files).
- R008 code review is still **CHANGES REQUESTED** with unresolved high-severity items.

Step 4 should not permit `.DONE` until these blockers are resolved or explicitly dispositioned as task blockers.

### 4) “Check If Affected” docs review is not operationalized
- Plan says docs reviewed, but has no deterministic check method or output.
- Need an explicit decision record for whether `docs/reference/commands.md` changed (and why).

## Required plan updates before execution
1. **Hydrate Step 4 into concrete sub-sections** (4.1/4.2/4.3...) with file-level actions:
   - Update `.pi/local/docs/taskplane/polyrepo-support-spec.md` with delivered TP-001 contracts.
   - Update `.pi/local/docs/taskplane/polyrepo-implementation-plan.md` with status/progress alignment.
   - Review `docs/reference/commands.md` and record explicit “changed/not changed + rationale”.
2. **Replace `Archive and push`** with PROMPT-aligned completion steps:
   - discoveries logged in STATUS,
   - reviews table updated,
   - `.DONE` creation.
3. **Add a hard gate before `.DONE`**:
   - Step 3 unresolved findings cleared (including R008 high items),
   - full test gate policy reconciled with PROMPT (`ZERO test failures allowed`).
4. **Add path/bootstrap handling** for missing `.pi/local/docs/taskplane/` so required doc updates are executable in this workspace.

## Non-blocking note
- `STATUS.md` reviews table remains duplicated/malformed (`STATUS.md:141-159`); clean while touching Step 4.
