# Task: TP-016 - Pointer File Resolution Chain

**Created:** 2026-03-17
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Threads pointer resolution through task-runner, orchestrator, and dashboard. Changes how config, agents, and state files are located in workspace mode. Moderate blast radius across multiple subsystems.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-016-pointer-file-resolution-chain/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Implement `taskplane-pointer.json` resolution so that in workspace mode, the task-runner, orchestrator, merge agent, and dashboard all find their config, agent overrides, and state files by following the pointer to the config repo. This replaces the current hard-coded `.pi/` path assumptions with a unified resolution chain.

See spec: `.pi/local/docs/settings-and-onboarding-spec.md` — Resolved Decision #1 (pointer), #4 (dashboard), and the "What lives where" polyrepo diagram.

## Dependencies

- **Task:** TP-014 (JSON config loader — pointer reads config from resolved path)
- **Task:** TP-015 (Init v2 — pointer file is created during init)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/settings-and-onboarding-spec.md` — pointer resolution design

## Environment

- **Workspace:** `extensions/taskplane/`, `extensions/task-runner.ts`, `dashboard/`
- **Services required:** None

## File Scope

- `extensions/taskplane/workspace.ts`
- `extensions/taskplane/config.ts`
- `extensions/task-runner.ts`
- `dashboard/server.cjs`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/merge.ts`

## Steps

### Step 0: Preflight

- [ ] Read current config/agent/state path resolution in workspace.ts, task-runner.ts, and dashboard
- [ ] Understand the existing `TASKPLANE_WORKSPACE_ROOT` env var pattern

### Step 1: Implement Pointer Resolution

- [ ] Create `resolvePointer()` function in workspace.ts
- [ ] Reads `<workspace-root>/.pi/taskplane-pointer.json`
- [ ] Validates `config_repo` and `config_path` fields
- [ ] Returns resolved absolute paths for config, agents, and state directories

### Step 2: Thread Through Task-Runner

- [ ] `loadAgentDef()` uses pointer to find agents in config repo (workspace mode)
- [ ] `loadConfig()` uses pointer to find project config in config repo
- [ ] Repo mode behavior unchanged (no pointer file = current paths)

### Step 3: Thread Through Orchestrator

- [ ] `buildExecutionContext()` uses pointer for config resolution
- [ ] `ORCH_SIDECAR_DIR` points to workspace root `.pi/` (for state files)
- [ ] Merge agent prompt loaded from config repo via pointer

### Step 4: Thread Through Dashboard

- [ ] Dashboard server follows pointer to find batch state
- [ ] STATUS.md resolution uses pointer for config repo paths

### Step 5: Testing & Verification

- [ ] Tests for pointer resolution with valid/invalid/missing pointer files
- [ ] Integration test: workspace mode with pointer produces same behavior
- [ ] Run: `cd extensions && npx vitest run`

### Step 6: Documentation & Delivery

- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (internal plumbing — user-facing docs don't reference pointer directly)

**Check If Affected:**
- `docs/explanation/architecture.md`

## Completion Criteria

- [ ] All steps complete
- [ ] Pointer resolution works end-to-end in workspace mode
- [ ] Repo mode behavior completely unchanged
- [ ] All tests passing
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `feat(TP-016): description`
- **Checkpoints:** `checkpoint: TP-016 description`

## Do NOT

- Break repo mode — all pointer logic must be workspace-mode only
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)
