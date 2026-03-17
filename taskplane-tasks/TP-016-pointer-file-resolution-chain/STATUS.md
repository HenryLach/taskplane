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
- [ ] Document mode matrix: repo mode vs workspace mode (pointer present/missing/invalid)
- [ ] Document env-var precedence interactions (TASKPLANE_WORKSPACE_ROOT, ORCH_SIDECAR_DIR, pointer)

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
*Reserved for execution notes*
