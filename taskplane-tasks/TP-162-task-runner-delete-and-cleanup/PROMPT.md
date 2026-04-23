# Task: TP-162 - Delete task-runner.ts and clean up all references

**Created:** 2026-04-11
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** Deletion + manifest changes are straightforward but broad-reaching. Plan review ensures no reference is missed before the file is gone. Blast radius is medium — touches package.json, docs, templates, and extension files.
**Score:** 3/8 — Blast radius: 2, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-162-task-runner-delete-and-cleanup/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Second and final phase of the task-runner consolidation. TP-161 has already created the new utility modules and updated all test imports. This task:

1. Removes `task-runner.ts` from `package.json` (both `pi.extensions` and `files`)
2. Deletes `extensions/task-runner.ts`
3. Removes dead code from `execution.ts` (`resolveTaskRunnerExtensionPath`)
4. Updates all docs, templates, and other references
5. Verifies the full test suite still passes and the CLI still works
6. Bumps to version 0.26.0

## Dependencies

- **Task:** TP-161 (new utility modules must exist and tests must be passing before this task runs)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/task-runner-consolidation.md` — full spec
- `extensions/task-runner.ts` — read to confirm nothing was missed by TP-161
- `extensions/taskplane/execution.ts` — find `resolveTaskRunnerExtensionPath`

## Environment

- **Workspace:** project root
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/task-runner.ts` ← **deleted**
- `package.json` ← remove from `pi.extensions` and `files`
- `extensions/taskplane/execution.ts` ← remove `resolveTaskRunnerExtensionPath`
- `extensions/task-orchestrator.ts` ← update comment
- `docs/maintainers/development-setup.md` ← update
- `docs/maintainers/package-layout.md` ← update
- `docs/explanation/architecture.md` ← update
- `AGENTS.md` ← update
- `templates/agents/task-worker.md` ← audit and update if needed
- `bin/taskplane.mjs` ← audit for any `/task and /orch` messaging

## Steps

### Step 0: Preflight

- [ ] Confirm TP-161 is complete: `sidecar-telemetry.ts`, `context-window.ts` exist; test suite passes
- [ ] Run: `grep -rn "task-runner" extensions/ docs/ templates/ AGENTS.md bin/ package.json` — document every remaining reference
- [ ] Categorize each reference: dead code to remove, comment to update, or doc to update
- [ ] Run test baseline: `cd extensions && npm run test:fast`

### Step 1: Remove from package.json

- [ ] Remove `"./extensions/task-runner.ts"` from `package.json["pi"]["extensions"]` array
- [ ] Remove `"extensions/task-runner.ts"` from `package.json["files"]` array (check exact format — may include a glob pattern)
- [ ] Verify `package.json` is valid JSON after edits: `node -e "require('./package.json')"`

### Step 2: Remove dead code from execution.ts

- [ ] Delete the `resolveTaskRunnerExtensionPath()` function (it is private and never called — confirmed dead)
- [ ] Scan `execution.ts` for any TASK_AUTOSTART comments referencing the legacy session path and remove/update them (comments only, not code — the code was removed in Runtime V2)

### Step 3: Delete task-runner.ts

Before deleting, do a final check:
- [ ] Confirm no remaining imports: `grep -rn "from.*task-runner\|require.*task-runner" extensions/`
- [ ] Confirm no source-reading references remain: `grep -rn "task-runner\.ts" extensions/tests/`

Then:
- [ ] **Delete `extensions/task-runner.ts`**

### Step 4: Update docs and templates

For each file, find and remove/update references. Do NOT leave "deprecated" or "removed" notices — write as if task-runner.ts never existed, consistent with the project policy on removed features.

- [ ] `extensions/task-orchestrator.ts` — remove the comment that says to load both extensions together
- [ ] `docs/maintainers/development-setup.md` — remove any reference to loading `task-runner.ts` or separate task-runner extension. Development command is now just: `pi -e extensions/task-orchestrator.ts`
- [ ] `docs/maintainers/package-layout.md` — remove `task-runner.ts` from the package layout description
- [ ] `docs/explanation/architecture.md` — update module description if task-runner is listed as a user-facing module
- [ ] `AGENTS.md` — remove any reference to loading task-runner.ts
- [ ] `templates/agents/task-worker.md` — audit for task-runner-specific language; remove if found
- [ ] `bin/taskplane.mjs` — audit for any messaging that references `/task` command or the task-runner extension; remove if found

### Step 5: Testing & Verification

- [ ] Run full test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Run CLI smoke checks: `node bin/taskplane.mjs help && node bin/taskplane.mjs version && node bin/taskplane.mjs init --preset full --dry-run --force && node bin/taskplane.mjs doctor`
- [ ] All tests that passed in Step 0 baseline still pass — no regressions
- [ ] Fix all failures

### Step 6: Version bump and delivery

- [ ] Bump version to `0.26.0` in `package.json` (minor bump — structural change)
- [ ] Update `package-lock.json` if needed
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- All files listed in Step 4

**Check If Affected:**
- `docs/tutorials/install-from-source.md` — may reference loading both extensions
- Any other doc not in the explicit list that shows up in the Step 0 grep

## Completion Criteria

- [ ] All steps complete
- [ ] `extensions/task-runner.ts` does not exist
- [ ] `task-runner.ts` not in `package.json["pi"]["extensions"]`
- [ ] `task-runner.ts` not in `package.json["files"]`
- [ ] `resolveTaskRunnerExtensionPath` not in `execution.ts`
- [ ] Full test suite passes
- [ ] CLI smoke checks pass
- [ ] Version is `0.26.0`

## Git Commit Convention

- **Step completion:** `refactor(TP-162): complete Step N — description`
- **Deletion:** `refactor(TP-162): delete task-runner.ts`
- **Version bump:** `chore(TP-162): bump to v0.26.0`
- **Hydration:** `hydrate: TP-162 expand Step N checkboxes`

## Do NOT

- Add deprecation notices or "removed" comments — write as if task-runner.ts never existed
- Touch `task-executor-core.ts`, `lane-runner.ts`, `agent-host.ts`, or `agent-bridge-extension.ts` — not in scope
- Modify test files (those were handled by TP-161)
- Delete `task-orchestrator.ts` — it's still needed (it's the user-loaded extension facade)
- Publish to npm — that happens after local testing by the operator
- Commit without the task ID prefix

---

## Amendments (Added During Execution)
