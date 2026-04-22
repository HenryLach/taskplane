# Task: TP-119 - Remove TMUX Abort Fallbacks

**Created:** 2026-04-02
**Size:** S

## Review Level: 2 (Plan + Code)

**Assessment:** Removing dual TMUX+V2 abort/cleanup paths. Small scope but touches safety-critical abort and recovery flows.
**Score:** 4/8 — Blast radius: 1 (abort/cleanup only), Pattern novelty: 1 (removing fallbacks), Security: 0, Reversibility: 2 (abort failures are hard to recover from)

## Canonical Task Folder

```
taskplane-tasks/TP-119-remove-tmux-abort-fallbacks/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Remove the TMUX abort/cleanup fallback paths that run alongside V2 registry-based cleanup. After TP-117 removes dead execution code and TP-118 cleans up naming, these fallback paths are the last TMUX coupling. They check for TMUX sessions that no longer exist in V2 — the checks always return false and the fallback code never activates.

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

- **Task:** TP-117 (dead code removal)
- **Task:** TP-118 (naming cleanup)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/abort.ts`
- `extensions/taskplane/execution.ts` — TMUX kill helpers used by abort
- `extensions/taskplane/merge.ts` — dual kill paths in merge cleanup
- `extensions/taskplane/resume.ts` — session reconnect fallbacks

## File Scope

- `extensions/taskplane/abort.ts`
- `extensions/taskplane/execution.ts` (TMUX helper functions)
- `extensions/taskplane/merge.ts` (dual kill paths)
- `extensions/taskplane/resume.ts` (TMUX reconnect fallbacks)
- `extensions/taskplane/sessions.ts` (remaining TMUX helpers)
- `extensions/tests/*.test.ts`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Inventory all remaining `tmuxHasSession`, `tmuxKillSession`, `tmuxAsync` call sites
- [ ] Classify each as: abort fallback, legacy reconnect, or other
- [ ] Log inventory in STATUS.md

### Step 1: Remove abort TMUX fallbacks
- [ ] In abort.ts, remove TMUX session kill alongside V2 registry kill
- [ ] In execution.ts, remove TMUX fallback from `executeWithStopAll` and stall kill paths
- [ ] In merge.ts, remove TMUX fallback kill paths (keep V2 `killMergeAgentV2` only)

### Step 2: Remove resume TMUX fallbacks
- [ ] In resume.ts, remove TMUX session reconnect paths
- [ ] Ensure V2 reconnect (re-execute via `executeLaneV2`) is the only path

### Step 3: Remove dead TMUX helpers
- [ ] Remove `tmuxHasSession`, `tmuxKillSession`, `tmuxAsync` and related functions from execution.ts
- [ ] Remove remaining helpers from sessions.ts
- [ ] Remove TMUX-related imports

### Step 4: Tests
- [ ] Update tests that reference removed TMUX functions
- [ ] Run full suite
- [ ] Fix all failures

### Step 5: Documentation & Delivery
- [ ] Update STATUS.md with summary
- [ ] Update Runtime V2 migration docs to reflect TMUX fully removed

## Do NOT

- Remove functions still referenced by other code (verify all call sites first)
- Skip testing abort/pause/resume flows after removal
- Assume TMUX helpers are dead without checking all import sites

## Git Commit Convention

- `feat(TP-119): complete Step N — ...`

## Amendments

<!-- Workers add amendments here if issues discovered during execution. -->
