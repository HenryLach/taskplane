# Task: TP-117 - TMUX Deprecation Messaging and Dead Code Removal

**Created:** 2026-04-02
**Size:** M

## Review Level: 2 (Plan + Code)

**Assessment:** Removing dead TMUX code paths that are never called in V2. Wide file scope but mechanical removal with clear keep/remove boundaries.
**Score:** 4/8 — Blast radius: 2 (multiple files), Pattern novelty: 1 (removing, not creating), Security: 0, Reversibility: 1 (hard to undo bulk removal)

## Canonical Task Folder

```
taskplane-tasks/TP-117-tmux-deprecation-messaging-and-dead-code-removal/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Remove dead TMUX backend code and add deprecation messaging. Since `selectRuntimeBackend()` always returns `"v2"`, the legacy TMUX execution paths are never called. This task removes them cleanly while preserving the `tmuxSessionName` naming (deferred to TP-118) and TMUX abort fallbacks (deferred to TP-119).

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

- None (V2 is already the only backend)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/execution.ts` — contains `executeLane()`, `spawnLaneSession()`, TMUX helpers
- `extensions/taskplane/merge.ts` — contains `spawnMergeAgent()` (TMUX version)
- `extensions/taskplane/engine.ts` — imports both legacy and V2 executors
- `extensions/taskplane/config-schema.ts` — `spawn_mode` field
- `extensions/taskplane/sessions.ts` — TMUX session helpers

## File Scope

- `extensions/taskplane/execution.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/sessions.ts`
- `extensions/taskplane/config-schema.ts`
- `extensions/taskplane/config-loader.ts`
- `extensions/tests/*.test.ts` (update tests that reference removed functions)

## Steps

### Step 0: Preflight — Inventory dead code
- [ ] Read this PROMPT.md and STATUS.md
- [ ] Identify all functions/exports in execution.ts that are ONLY used by the legacy TMUX path (executeLane, spawnLaneSession, buildTmuxSpawnArgs, etc.)
- [ ] Identify TMUX-only merge functions (spawnMergeAgent TMUX version vs spawnMergeAgentV2)
- [ ] Identify TMUX session helpers in sessions.ts that are only used by legacy paths
- [ ] Log the dead code inventory in STATUS.md

### Step 1: Config deprecation messaging
- [ ] In config-schema.ts, mark `spawn_mode: "tmux"` as deprecated
- [ ] In config-loader.ts, emit a deprecation warning when `spawn_mode` is set to `"tmux"`
- [ ] In extension.ts doctor/preflight, add V2-first messaging (TMUX is legacy only)

### Step 2: Remove dead execution functions
- [ ] Remove `executeLane()` (legacy TMUX lane execution)
- [ ] Remove `spawnLaneSession()` and related TMUX spawn helpers
- [ ] Remove `buildTmuxSpawnArgs()` if only used by legacy path
- [ ] Remove legacy `spawnMergeAgent()` (TMUX version) — keep `spawnMergeAgentV2()`
- [ ] Update engine.ts imports to remove references to deleted functions
- [ ] Update any other files that import removed functions
- [ ] **DO NOT remove**: `tmuxHasSession`, `tmuxKillSession`, `tmuxAsync` — these are still used by abort fallbacks (TP-119)
- [ ] **DO NOT remove**: `tmuxSessionName` field — naming cleanup is TP-118
- [ ] **DO NOT remove**: TMUX abort/cleanup paths — safety shim removal is TP-119

### Step 3: Remove dead session helpers
- [ ] Review sessions.ts for functions only used by legacy paths
- [ ] Remove dead functions, keep any used by abort/cleanup

### Step 4: Tests
- [ ] Update tests that reference removed functions (may need to delete or update structural tests)
- [ ] Run full test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures
- [ ] Verify test count is reasonable (some tests for removed code should be deleted)

### Step 5: Documentation & Delivery
- [ ] Update STATUS.md with completion summary
- [ ] Log any discoveries about code that was unexpectedly still referenced

## Do NOT

- Remove `tmuxSessionName` field or rename it (TP-118)
- Remove TMUX abort/cleanup fallbacks (TP-119)
- Remove TMUX helper functions still used by abort paths (`tmuxHasSession`, `tmuxKillSession`, etc.)
- Break persisted batch-state.json compatibility

## Git Commit Convention

- `feat(TP-117): complete Step N — ...`
- `fix(TP-117): ...`
- `test(TP-117): ...`

## Amendments

<!-- Workers add amendments here if issues discovered during execution. -->
