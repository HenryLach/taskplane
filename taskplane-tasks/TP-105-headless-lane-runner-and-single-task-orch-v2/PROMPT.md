# Task: TP-105 - Headless Lane Runner and Single-Task /orch Runtime V2

**Created:** 2026-03-30
**Size:** L

## Review Level: 3 (Full)

**Assessment:** This creates the first usable vertical slice of Runtime V2 by connecting the new executor core and agent host into a single-task `/orch` flow. High coordination risk across engine, extension, and execution modules.
**Score:** 7/8 — Blast radius: 2, Pattern novelty: 2, Security: 1, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-105-headless-lane-runner-and-single-task-orch-v2/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Implement the headless `lane-runner` and route single-task `/orch <PROMPT.md>` execution through Runtime V2. After this task, Taskplane should have a real no-TMUX, no-`/task` execution slice that can run one task end-to-end on the new foundation.

## Dependencies

- **Task:** TP-102 (Runtime V2 contracts defined)
- **Task:** TP-103 (executor core extracted)
- **Task:** TP-104 (direct agent host and registry available)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/framework/taskplane-runtime-v2/01-architecture.md` — lane-runner role in the target architecture
- `docs/specifications/framework/taskplane-runtime-v2/02-runtime-process-model.md` — required lifecycle and ownership rules
- `docs/specifications/framework/taskplane-runtime-v2/08-implementation-workpackages.md` — lane-runner work package expectations
- `extensions/taskplane/engine.ts` — current orchestration start path that needs a new backend

## Environment

- **Workspace:** `extensions/taskplane/`, `extensions/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/lane-runner.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/extension.ts`
- `extensions/task-runner.ts`
- `extensions/tests/*orch*`

## Steps

### Step 0: Preflight

- [ ] Trace current single-task `/orch` execution through engine, execution helpers, lane sessions, and task-runner autostart
- [ ] Identify every place the current path still depends on TMUX sessions, `TASK_AUTOSTART`, or `/task` semantics

### Step 1: Implement Headless Lane Runner

- [ ] Add a lane-runner process/module that owns one lane's execution lifecycle using the shared executor core and direct agent host
- [ ] Define the lane-runner launch contract, control signals, and lane snapshot outputs
- [ ] Keep worktree/orch-branch semantics intact while changing the runtime host

### Step 2: Cut Over Single-Task `/orch`

- [ ] Route `/orch <PROMPT.md>` through the lane-runner backend
- [ ] Remove mission-critical dependence on `TASK_AUTOSTART` and lane Pi session startup hooks for this path
- [ ] Ensure no part of the single-task Runtime V2 flow requires `/task` or TMUX

### Step 3: Testing & Verification

- [ ] Add or update tests for lane-runner launch, single-task `/orch` execution, and new backend lifecycle behavior
- [ ] Run the full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Run CLI smoke checks: `node bin/taskplane.mjs help && node bin/taskplane.mjs doctor`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Update architecture and command docs for the new single-task Runtime V2 path
- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/explanation/architecture.md`
- `docs/reference/commands.md`
- `docs/specifications/framework/taskplane-runtime-v2/02-runtime-process-model.md`

**Check If Affected:**
- `README.md`
- `docs/explanation/execution-model.md`
- `docs/explanation/waves-lanes-and-worktrees.md`

## Completion Criteria

- [ ] Single-task `/orch` runs end-to-end on Runtime V2 without TMUX
- [ ] The new lane-runner owns task execution instead of a lane Pi extension session
- [ ] `/task` is no longer required anywhere in the critical path for the first v2 slice

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-105): complete Step N — description`
- **Bug fixes:** `fix(TP-105): description`
- **Tests:** `test(TP-105): description`
- **Hydration:** `hydrate: TP-105 expand Step N checkboxes`

## Do NOT

- Keep `TASK_AUTOSTART` as a hidden dependency in the new backend
- Add a new Runtime V2 path that still shells out through TMUX
- Claim batch parity before the batch migration task lands

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
