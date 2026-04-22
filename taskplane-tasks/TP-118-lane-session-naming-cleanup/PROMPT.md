# Task: TP-118 - Lane Session Naming Cleanup

**Created:** 2026-04-02
**Size:** M

## Review Level: 2 (Plan + Code)

**Assessment:** Mechanical rename of `tmuxSessionName` → `laneSessionId` across types, persistence, dashboard, and tests. Wide blast radius but straightforward pattern replacement.
**Score:** 4/8 — Blast radius: 2 (every file with lane references), Pattern novelty: 1 (rename), Security: 0, Reversibility: 1 (rename is invertible but touches many files)

## Canonical Task Folder

```
taskplane-tasks/TP-118-lane-session-naming-cleanup/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Rename `tmuxSessionName` to `laneSessionId` throughout the codebase. This field is used as a lane identifier in Runtime V2 — it has nothing to do with TMUX anymore. The rename eliminates confusion and completes the naming transition from TMUX-era terminology.

**Strategy:** Type alias first (backward compatible), then gradual field rename, then remove alias.

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

- **Task:** TP-117 (dead code removal reduces the number of rename sites)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/types.ts` — `AllocatedLane`, `PersistedLaneRecord` types
- `extensions/taskplane/persistence.ts` — batch state serialization
- `extensions/taskplane/waves.ts` — `generateTmuxSessionName()`
- `dashboard/server.cjs` — lane state keying
- `dashboard/public/app.js` — frontend lane rendering

## File Scope

- `extensions/taskplane/types.ts`
- `extensions/taskplane/waves.ts`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/naming.ts`
- `dashboard/server.cjs`
- `dashboard/public/app.js`
- `extensions/tests/*.test.ts`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Count all `tmuxSessionName` references (expected ~100+)
- [ ] Identify the type definitions that need updating
- [ ] Plan the alias-first migration approach

### Step 1: Type alias introduction
- [ ] In types.ts, add `laneSessionId` as an alias field on `AllocatedLane` and `PersistedLaneRecord`
- [ ] Update `generateTmuxSessionName()` in waves.ts → rename to `generateLaneSessionId()`, keep old name as alias
- [ ] Ensure persisted state reads both `tmuxSessionName` and `laneSessionId` (backward compat)

### Step 2: Rename in production code
- [ ] Replace `tmuxSessionName` → `laneSessionId` in execution.ts
- [ ] Replace in engine.ts, merge.ts, extension.ts, persistence.ts, resume.ts
- [ ] Replace in dashboard server.cjs and app.js
- [ ] Update naming.ts if applicable

### Step 3: Rename in tests
- [ ] Update all test files referencing `tmuxSessionName`
- [ ] Run full suite
- [ ] Fix all failures

### Step 4: Remove aliases
- [ ] Remove `tmuxSessionName` from type definitions (keep only `laneSessionId`)
- [ ] Remove `generateTmuxSessionName` alias
- [ ] Verify full suite still passes

### Step 5: Documentation & Delivery
- [ ] Update STATUS.md with completion summary
- [ ] Log total rename count

## Do NOT

- Change the VALUE format of the session ID (still `orch-{opId}-lane-{N}`)
- Break persisted batch-state.json from prior versions (must read old field name)
- Rename in the same PR as dead code removal (TP-117)

## Git Commit Convention

- `refactor(TP-118): complete Step N — ...`

## Amendments

<!-- Workers add amendments here if issues discovered during execution. -->
