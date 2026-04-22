# Task: TP-054 - Deprecate /task Command

**Created:** 2026-03-24
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Low-risk change — adds deprecation warnings to existing commands, no new patterns or security concerns. One file primarily affected.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-054-deprecate-task-command/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Deprecate the `/task`, `/task-status`, `/task-pause`, and `/task-resume` commands in favor of `/orch`. Since v0.9.0 (worker-driven inline reviews), `/task` no longer provides code reviews — the `review_step` tool is only registered in orchestrated mode. `/orch` is strictly superior for all workflows (dashboard, worktree isolation, supervisor, telemetry, reviews). Users invoking `/task` should see a clear deprecation warning pointing them to `/orch`.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/task-runner.ts` — contains `/task*` command registrations (around line 3407+)
- `docs/reference/commands.md` — command reference documentation
- `README.md` — user-facing docs mentioning `/task`

## Environment

- **Workspace:** `extensions/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/task-runner.ts`
- `docs/reference/commands.md`
- `README.md`

## Steps

### Step 0: Preflight

- [ ] Read `/task` command registration in `task-runner.ts` (~line 3407+)
- [ ] Read current `/task` documentation in `commands.md` and `README.md`
- [ ] Confirm `review_step` tool is NOT registered in standalone `/task` mode

### Step 1: Add Deprecation Warnings

When `/task` is invoked:

1. Emit a visible deprecation warning via `ctx.ui.notify()` at "warning" level:
   ```
   ⚠️ /task is deprecated. Use /orch instead — it provides worktree isolation, dashboard, inline reviews, and supervisor monitoring. /task will be removed in a future major version.
   ```
2. The command should still **work normally** after the warning — this is a soft deprecation, not removal
3. Add the same pattern to `/task-status`, `/task-pause`, `/task-resume` — each should suggest the `/orch` equivalent:
   - `/task-status` → "Use the dashboard (`taskplane dashboard`) or `/orch-status`"
   - `/task-pause` → "Use `/orch-pause`"
   - `/task-resume` → "Use `/orch-resume`"

**Artifacts:**
- `extensions/task-runner.ts` (modified — deprecation warnings added)

### Step 2: Update Documentation

1. In `docs/reference/commands.md`:
   - Mark `/task`, `/task-status`, `/task-pause`, `/task-resume` as **deprecated**
   - Add note: "Deprecated in v0.10.x. Use `/orch` for all workflows."
   - Keep the documentation (don't remove) — users on older versions need it

2. In `README.md`:
   - The "Run a single task" section already recommends `/orch` — add a deprecation note to the `/task` mention:
     > **Deprecated:** The `/task` command is deprecated and will be removed in a future version. It does not provide worktree isolation, dashboard, or inline reviews.

**Artifacts:**
- `docs/reference/commands.md` (modified)
- `README.md` (modified)

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Run unit tests: `cd extensions && npx vitest run`
- [ ] Verify deprecation strings exist in source: grep for the warning text
- [ ] Build passes: `node bin/taskplane.mjs help`

### Step 4: Documentation & Delivery

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `docs/reference/commands.md` — mark /task commands as deprecated
- `README.md` — add deprecation note

**Check If Affected:**
- `docs/explanation/execution-model.md` — references /task (already updated to /orch-centric)
- `docs/tutorials/install.md` — may reference /task in getting started

## Completion Criteria

- [ ] All `/task*` commands show deprecation warning when invoked
- [ ] Commands still work after warning (soft deprecation)
- [ ] Documentation marks commands as deprecated
- [ ] All tests passing
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-054): complete Step N — description`
- **Bug fixes:** `fix(TP-054): description`
- **Hydration:** `hydrate: TP-054 expand Step N checkboxes`

## Do NOT

- Remove the `/task` commands — this is deprecation, not removal
- Break standalone mode for users who haven't migrated yet
- Change the task-runner execution engine behavior
- Modify any orchestrator code

---

## Amendments (Added During Execution)

