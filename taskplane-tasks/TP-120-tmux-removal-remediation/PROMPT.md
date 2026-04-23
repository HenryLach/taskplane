# Task: TP-120 - TMUX Removal Remediation

**Created:** 2026-04-02
**Size:** M

## Review Level: 2 (Plan + Code)

**Assessment:** Finishing the TMUX removal that TP-119 underdelivered. Touches execution.ts, merge.ts, abort.ts, config, and waves — multiple critical files. Breaking config change (tmux_prefix → sessionPrefix).
**Score:** 5/8 — Blast radius: 2 (multiple critical files), Pattern novelty: 1 (removing/renaming), Security: 0, Reversibility: 2 (breaking config change)

## Canonical Task Folder

```
taskplane-tasks/TP-120-tmux-removal-remediation/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Complete the TMUX removal that TP-119 left unfinished. After this task, there should be zero functional TMUX code in the codebase — no TMUX helper functions, no TMUX session polling, no TMUX pane capture. The only acceptable TMUX references are in comments explaining the migration history.

This is a **breaking change** for the `tmux_prefix` config field — it will be renamed to `sessionPrefix`.

## Environment

- **Workspace:** `extensions/taskplane/`, `dashboard/`, `bin/`
- **Services required:** None
- **Submodule workspace:** `.pi/git/github.com/loopyd/taskplane` (absolute: `/mnt/PROJECTS/repos/bof3-decomp/.pi/git/github.com/loopyd/taskplane`)


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## Dependencies

- **Task:** TP-117 (dead code removal — done)
- **Task:** TP-118 (naming cleanup — done)
- **Task:** TP-119 (abort fallbacks — partially done)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/execution.ts` — TMUX helper functions to remove
- `extensions/taskplane/merge.ts` — merge health monitor TMUX polling
- `extensions/taskplane/abort.ts` — raw tmux list-sessions call
- `extensions/taskplane/config-schema.ts` — tmux_prefix / tmuxPrefix fields
- `extensions/taskplane/config-loader.ts` — tmuxPrefix config loading
- `extensions/taskplane/waves.ts` — generateLaneSessionId(tmuxPrefix, ...)

## File Scope

- `extensions/taskplane/execution.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/abort.ts`
- `extensions/taskplane/config-schema.ts`
- `extensions/taskplane/config-loader.ts`
- `extensions/taskplane/waves.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/settings-tui.ts`
- `extensions/taskplane/worktree.ts`
- `templates/config/task-orchestrator.yaml`
- `dashboard/server.cjs`
- `dashboard/public/app.js`
- `extensions/tests/*.test.ts`

## Steps

### Step 0: Preflight — Inventory remaining TMUX code
- [ ] Read PROMPT.md and STATUS.md
- [ ] Run `grep -rn "tmux" extensions/taskplane/*.ts | grep -v "test\|//" | wc -l` to count remaining refs
- [ ] Identify every remaining TMUX function exported from execution.ts
- [ ] Identify TMUX usage in merge.ts (health monitor)
- [ ] Identify TMUX usage in abort.ts (list-sessions)
- [ ] Log inventory in STATUS.md

### Step 1: Remove TMUX helper functions from execution.ts
- [ ] Remove `tmuxHasSessionAsync()` function
- [ ] Remove `tmuxKillSessionAsync()` function
- [ ] Remove `captureTmuxPaneTailAsync()` function
- [ ] Remove `captureTmuxPaneTail()` function
- [ ] Remove `toTmuxPath()` function
- [ ] Remove any other TMUX-only helper functions
- [ ] Update all import sites that referenced these functions — remove the imports
- [ ] For call sites that used these as fallbacks (e.g., `runtimeBackend === "v2" ? v2Check : tmuxCheck`), remove the entire fallback branch and keep only the V2 path

### Step 2: Remove merge health monitor TMUX polling
- [ ] In merge.ts, the `MergeHealthMonitor.poll()` method calls `tmuxHasSessionAsync` — replace with V2 registry-based liveness check or remove if the monitor is dead code
- [ ] Remove `captureTmuxPaneTail*` calls from merge health monitor
- [ ] Remove `tmuxHasSessionAsync` import from merge.ts
- [ ] If the entire merge health monitor class is legacy-only and not used by V2, remove it

### Step 3: Remove abort.ts TMUX code
- [ ] Remove `execSync('tmux list-sessions')` call in abort.ts
- [ ] Replace with V2 registry-based session discovery or remove if redundant
- [ ] Ensure V2 abort path is the only path

### Step 4: Config rename — tmux_prefix → sessionPrefix
- [ ] In config-schema.ts, rename `tmuxPrefix` → `sessionPrefix` in all schema types and defaults
- [ ] In config-loader.ts, update config loading to read `sessionPrefix` (keep `tmuxPrefix` as deprecated alias for backward compat reading)
- [ ] In waves.ts, rename `generateLaneSessionId(tmuxPrefix, ...)` parameter to `sessionPrefix`
- [ ] Update all call sites: engine.ts, execution.ts, merge.ts, extension.ts, worktree.ts
- [ ] Update settings-tui.ts if it references tmuxPrefix
- [ ] Update `templates/config/task-orchestrator.yaml` — rename field in template
- [ ] Update dashboard if it references tmux_prefix

### Step 5: Tests
- [ ] Update all test files referencing removed functions or renamed config
- [ ] Run full test suite
- [ ] Fix all failures
- [ ] Verify zero TMUX function calls remain (only comments acceptable)

### Step 6: Documentation & Delivery
- [ ] Update STATUS.md with completion summary
- [ ] Run final TMUX reference count — target: comments only, zero functional code
- [ ] Log the before/after reference count

## Do NOT

- Leave any functional TMUX code (function calls, imports, config reads) — comments about migration history are fine
- Skip the config backward-compat alias for tmuxPrefix → sessionPrefix reading
- Remove TMUX references from test fixture JSON files without updating the fixture to use new field names

## Git Commit Convention

- `feat(TP-120): complete Step N — ...`
- `fix(TP-120): ...`
- `refactor(TP-120): ...`

## Amendments

<!-- Workers add amendments here if issues discovered during execution. -->
