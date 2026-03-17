# TP-016: Pointer File Resolution Chain — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-17
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** 🟨 In Progress

- [x] Inventory all config/agent/state resolution call sites (resolution map)
- [x] Document mode matrix: repo mode vs workspace mode (pointer present/missing/invalid)
- [x] Document env-var precedence interactions (TASKPLANE_WORKSPACE_ROOT, ORCH_SIDECAR_DIR, pointer)

---

### Step 1: Implement Pointer Resolution
**Status:** ⬜ Not Started

- [ ] `resolvePointer()` function created and validated
- [ ] Returns resolved paths for config, agents, and state

---

### Step 2: Thread Through Task-Runner
**Status:** ⬜ Not Started

- [ ] Agent and config loading uses pointer in workspace mode
- [ ] Repo mode unchanged

---

### Step 3: Thread Through Orchestrator
**Status:** ⬜ Not Started

- [ ] `buildExecutionContext()` uses pointer
- [ ] Sidecar and merge agent paths use pointer

---

### Step 4: Thread Through Dashboard
**Status:** ⬜ Not Started

- [ ] Dashboard follows pointer for state and STATUS.md

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Pointer resolution tests
- [ ] `cd extensions && npx vitest run`

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] `.DONE` created
- [ ] Archive and push

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Config resolution: `resolveConfigRoot()` checks cwd for config files, then `TASKPLANE_WORKSPACE_ROOT`, falls back to cwd | Step 1-2 input | `config-loader.ts:546-567` |
| Config loading: `loadProjectConfig()` reads `<configRoot>/.pi/taskplane-config.json` first, then YAML fallback | Step 1-2 input | `config-loader.ts:569-603` |
| Agent loading: `loadAgentDef()` looks at `<cwd>/.pi/agents/{name}.md` and `<cwd>/agents/{name}.md` | Step 2 input | `task-runner.ts:408` |
| Merge agent prompt: hard-coded `join(stateRoot ?? repoRoot, ".pi", "agents", "task-merger.md")` | Step 3 input | `merge.ts:307` |
| Sidecar dir: `ORCH_SIDECAR_DIR = join(workspaceRoot \|\| repoRoot, ".pi")` | Step 3 input | `execution.ts:138` |
| Dashboard state: `BATCH_STATE_PATH = <REPO_ROOT>/.pi/batch-state.json`, lane states from `<REPO_ROOT>/.pi/lane-state-*.json` | Step 4 input | `dashboard/server.cjs:634-636,194` |
| Pointer file shape: `{ config_repo: "<repoId>", config_path: ".taskplane" }` at `<workspaceRoot>/.pi/taskplane-pointer.json` | Step 1 input | `bin/taskplane.mjs:1072-1075` |
| `settings-and-onboarding-spec.md` does not exist in this worktree or main repo | Non-blocking | `.pi/local/docs/` |
| Dashboard conversation files at `<REPO_ROOT>/.pi/worker-conversation-*.jsonl` | Step 4 input | `dashboard/server.cjs:381` |

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-17 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-17 17:23 | Task started | Extension-driven execution |
| 2026-03-17 17:23 | Step 0 started | Preflight |
| 2026-03-17 17:23 | Task started | Extension-driven execution |
| 2026-03-17 17:23 | Step 0 started | Preflight |
| 2026-03-17 17:25 | Review R001 | plan Step 0: REVISE |
| 2026-03-17 17:25 | Review R001 | plan Step 0: REVISE |

## Blockers
*None*

## Notes

### Resolver Inventory (Step 0 Preflight)

#### Artifact → Resolver → Current Root

| # | Artifact | Resolver | File:Line | Current Root (Repo Mode) | Current Root (Workspace Mode) |
|---|----------|----------|-----------|-------------------------|-------------------------------|
| 1 | `taskplane-config.json` / YAML configs | `resolveConfigRoot()` → `loadProjectConfig()` | `config-loader.ts:557-564` | cwd | cwd → fallback `TASKPLANE_WORKSPACE_ROOT` |
| 2 | Agent prompts (`task-worker.md`, `task-reviewer.md`) | `loadAgentDef()` | `task-runner.ts:408` | `cwd/.pi/agents/` or `cwd/agents/` | same (worktree cwd) — no workspace fallback |
| 3 | Sidecar dir (lane state, conversation logs) | `getSidecarDir()` | `task-runner.ts:226-244` | Walk up to `.pi/` dir | `ORCH_SIDECAR_DIR` env (set by orchestrator) |
| 4 | `ORCH_SIDECAR_DIR` (orchestrator → worker env) | `buildLaneEnvVars()` | `execution.ts:137` | `join(repoRoot, ".pi")` | `join(workspaceRoot, ".pi")` |
| 5 | `TASKPLANE_WORKSPACE_ROOT` env propagation | `buildLaneEnvVars()` | `execution.ts:147-148` | not set | `workspaceRoot` (when != repoRoot) |
| 6 | Orch-abort signal file | monitor loop | `execution.ts:578` | `join(repoRoot, ".pi", "orch-abort-signal")` | same (uses repoRoot) |
| 7 | Orch lane log paths | `laneLogPath()` | `execution.ts:237,249` | `join(lane.worktreePath, ".pi", "orch-logs", ...)` | same |
| 8 | Merge agent prompt | `launchTmuxMerge()` | `merge.ts:307` | `join(stateRoot ?? repoRoot, ".pi", "agents", "task-merger.md")` | stateRoot = wsRoot |
| 9 | Merge request/result files | `runMergeWave()` | `merge.ts:619,621` | `join(stateRoot ?? repoRoot, ".pi", ...)` | stateRoot = wsRoot |
| 10 | Batch state (`batch-state.json`) | `batchStatePath()` | `types.ts:1168-1170` | `join(repoRoot, ".pi", BATCH_STATE_FILENAME)` | same (repoRoot from context) |
| 11 | Batch history (`batch-history.json`) | `batchHistoryPath()` | `persistence.ts:1242` | `join(repoRoot, ".pi", ...)` | same |
| 12 | Dashboard batch state | `loadLaneStates()`, startup | `dashboard/server.cjs:194,635-636` | `join(REPO_ROOT, ".pi", ...)` | same (REPO_ROOT from --root flag) |
| 13 | Dashboard conversation logs | route handler | `dashboard/server.cjs:381` | `join(REPO_ROOT, ".pi", ...)` | same |
| 14 | Workspace config | `loadWorkspaceConfig()` | `workspace.ts` via `workspaceConfigPath()` | N/A (absent = repo mode) | `join(workspaceRoot, ".pi", "taskplane-workspace.yaml")` |
| 15 | Taskplane extension install path | `resolveTaskplanePackage()` | `task-runner.ts:362` | standard node resolution | also checks `TASKPLANE_WORKSPACE_ROOT/.pi/npm/node_modules/taskplane` |

#### Key Observations
- **Config loading** (#1): Already has `TASKPLANE_WORKSPACE_ROOT` fallback via `resolveConfigRoot()`. Pointer would replace/extend this.
- **Agent loading** (#2): Does NOT have workspace fallback — only looks in worktree cwd. This is a gap for workspace mode (agents live in config repo).
- **Sidecar/state files** (#3,4,6,10,11): Use `repoRoot/.pi/` or `workspaceRoot/.pi/`. These are runtime state, NOT config — likely should stay at workspace root, not follow pointer to config repo.
- **Merge agent** (#8): Uses `stateRoot` (wsRoot in workspace mode) to find `.pi/agents/task-merger.md`. Same gap as #2 — agents should come from config repo via pointer.
- **Dashboard** (#12,13): Hardcoded to `REPO_ROOT/.pi/`. In workspace mode dashboard needs workspace root, not individual repo root.
- **Pointer file schema**: `{ config_repo: string, config_path: string }` where config_repo is a repo name (not path) and config_path is relative within that repo (e.g., ".taskplane").

### Mode Matrix (Step 0 Preflight)

| Scenario | Workspace Config | Pointer File | Config Resolution | Agent Resolution | State/Sidecar Resolution |
|----------|-----------------|--------------|-------------------|------------------|--------------------------|
| **Repo mode** | Absent | N/A (ignored) | `cwd/.pi/` (config files) → defaults | `cwd/.pi/agents/` → base package | `cwd/.pi/` (walk-up) |
| **Workspace, valid pointer** | Present | Valid JSON, valid `config_repo`+`config_path` | Resolve pointer → `<config_repo_path>/<config_path>/` for config | Resolve pointer → `<config_repo_path>/<config_path>/agents/` → base package | `workspaceRoot/.pi/` (state stays at workspace root) |
| **Workspace, pointer missing** | Present | File absent at `workspaceRoot/.pi/taskplane-pointer.json` | Fallback to `TASKPLANE_WORKSPACE_ROOT/.pi/` (current behavior) | Fallback to current worktree cwd paths (current behavior) | `workspaceRoot/.pi/` (unchanged) |
| **Workspace, pointer malformed** | Present | File exists but invalid JSON or missing fields | Warn + fallback same as "pointer missing" | Warn + fallback same as "pointer missing" | `workspaceRoot/.pi/` (unchanged) |
| **Workspace, pointer invalid config_repo** | Present | Valid JSON but `config_repo` not in workspace repos map | Error — fail-fast (config_repo must match a known repo ID) | Error — same | `workspaceRoot/.pi/` (unchanged) |

#### Design decisions:
1. **Pointer is workspace-only**: In repo mode, no pointer file is read. Even if one exists, it's ignored. This guarantees zero repo-mode behavior change.
2. **State/sidecar files never follow pointer**: Batch state, conversation logs, abort signals, lane logs — all stay at `workspaceRoot/.pi/`. Only config and agent artifacts follow the pointer to the config repo.
3. **Missing pointer = graceful fallback**: Workspace mode without a pointer is a valid (if degraded) configuration. This supports incremental adoption and the case where init v2 hasn't been run yet.
4. **Malformed pointer = warn + fallback**: Non-destructive. Log a warning but don't crash. User can fix or re-run init.
5. **Invalid config_repo = fail-fast**: If the pointer references a repo not in the workspace config, that's a hard error — the config repo path can't be resolved.

### Mode Matrix: Pointer Resolution Behavior

| Scenario | Pointer File | Config Source | Agent Source | State Source |
|----------|-------------|---------------|--------------|--------------|
| **Repo mode** (no workspace config) | Absent | `<cwd>/.pi/` (unchanged) | `<cwd>/.pi/agents/` (unchanged) | `<cwd>/.pi/` (unchanged) |
| **Workspace + pointer valid** | `{ config_repo: "myrepo", config_path: ".taskplane" }` | `<configRepoPath>/.taskplane/` | `<configRepoPath>/.taskplane/agents/` | `<wsRoot>/.pi/` (unchanged — state stays at workspace root) |
| **Workspace + pointer absent** | N/A | `<wsRoot>/.pi/` via `TASKPLANE_WORKSPACE_ROOT` (current fallback) | `<wsRoot>/.pi/agents/` (current fallback) | `<wsRoot>/.pi/` |
| **Workspace + pointer malformed** | Invalid JSON | Log warning → fall back to `TASKPLANE_WORKSPACE_ROOT` | Same fallback | `<wsRoot>/.pi/` |
| **Workspace + pointer references unknown repo** | `config_repo` not in workspace repos map | Log warning → fall back to `TASKPLANE_WORKSPACE_ROOT` | Same fallback | `<wsRoot>/.pi/` |

**Design principle:** Pointer failure is non-fatal — always fall back to existing `TASKPLANE_WORKSPACE_ROOT` behavior. State files never follow the pointer (they are workspace-scoped runtime artifacts).

### Env-Var Precedence (with pointer introduced)

```
Config resolution (new precedence):
1. cwd has config files → use cwd (existing — repo mode or worktree with local config)
2. Pointer file valid → resolve <configRepoPath>/<configPath>/ as configRoot (NEW)
3. TASKPLANE_WORKSPACE_ROOT has config files → use it (existing fallback)
4. Fall back to cwd, loaders return defaults (existing)

Agent resolution (new precedence):
1. <cwd>/.pi/agents/{name}.md or <cwd>/agents/{name}.md (existing local override)
2. Pointer → <configRepoPath>/<configPath>/agents/{name}.md (NEW — workspace config repo)
3. Package templates/agents/{name}.md (existing base agent)

State/sidecar resolution (UNCHANGED by pointer):
- ORCH_SIDECAR_DIR → walk up → create at cwd
- Dashboard: --root flag or cwd → <root>/.pi/

ORCH_SIDECAR_DIR (UNCHANGED by pointer):
- Set to join(workspaceRoot || repoRoot, ".pi") by orchestrator
- State lives at workspace root, not config repo
```
