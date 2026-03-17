# TP-014: JSON Config Schema and Loader — Status

**Current Step:** Step 1: Define JSON Schema
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-17
**Review Level:** 2
**Review Counter:** 3
**Iteration:** 2
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read current config loading paths
- [x] Read YAML config reference docs

---

### Step 1: Define JSON Schema
**Status:** 🟨 In Progress

- [x] TypeScript interfaces for unified `TaskplaneConfig` schema defined in `extensions/taskplane/config-schema.ts`
- [x] Schema covers all 13 task-runner sections + 7 orchestrator sections with JSON camelCase naming
- [ ] `configVersion` field with v1 semantics (required, initial value 1, unknown future versions rejected)
- [ ] Centralized defaults for the unified config (single source of truth)
- [ ] Section mapping documented in STATUS.md Discoveries table

---

### Step 2: Implement Unified Config Loader
**Status:** ⬜ Not Started

- [ ] `loadProjectConfig()` reads JSON first, falls back to YAML
- [ ] YAML fallback produces identical config shape
- [ ] task-runner and orchestrator both use unified loader

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Tests for JSON, YAML fallback, defaults, and schema validation
- [ ] Existing tests pass
- [ ] `cd extensions && npx vitest run`

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Config reference docs updated
- [ ] `.DONE` created
- [ ] Archive and push

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | APPROVE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | APPROVE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | APPROVE | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | APPROVE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | APPROVE | .reviews/R003-plan-step1.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| task-runner.ts has its own `TaskConfig` interface + `loadConfig()` that reads `.pi/task-runner.yaml` with YAML parse + defaults merge. Separate from orchestrator's config.ts. | Step 1 input | `extensions/task-runner.ts:40-190` |
| Orchestrator config.ts has `loadOrchestratorConfig()` and `loadTaskRunnerConfig()` — two separate loaders reading two YAML files | Step 1 input | `extensions/taskplane/config.ts` |
| types.ts has `OrchestratorConfig`, `TaskRunnerConfig` interfaces + `DEFAULT_ORCHESTRATOR_CONFIG`, `DEFAULT_TASK_RUNNER_CONFIG` defaults | Step 1 input | `extensions/taskplane/types.ts` |
| task-runner.ts supports `TASKPLANE_WORKSPACE_ROOT` env var fallback for config path resolution | Step 2 input | `extensions/task-runner.ts:146-149` |
| task-runner.yaml has 13 top-level sections; task-orchestrator.yaml has 7 sections. Unified schema must merge all 20 sections. | Step 1 input | docs/reference/configuration/ |

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-17 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-17 14:18 | Task started | Extension-driven execution |
| 2026-03-17 14:18 | Step 0 started | Preflight |
| 2026-03-17 14:18 | Task started | Extension-driven execution |
| 2026-03-17 14:18 | Step 0 started | Preflight |
| 2026-03-17 14:19 | Review R001 | plan Step 0: APPROVE |
| 2026-03-17 14:19 | Review R001 | plan Step 0: APPROVE |
| 2026-03-17 14:20 | Worker iter 1 | done in 86s, ctx: 19%, tools: 17 |
| 2026-03-17 14:20 | Worker iter 1 | done in 82s, ctx: 29%, tools: 16 |
| 2026-03-17 14:21 | Review R002 | code Step 0: APPROVE |
| 2026-03-17 14:21 | Step 0 complete | Preflight |
| 2026-03-17 14:21 | Step 1 started | Define JSON Schema |
| 2026-03-17 14:22 | Review R002 | code Step 0: APPROVE |
| 2026-03-17 14:22 | Step 0 complete | Preflight |
| 2026-03-17 14:22 | Step 1 started | Define JSON Schema |
| 2026-03-17 14:23 | Review R003 | plan Step 1: REVISE |
| 2026-03-17 14:23 | Review R003 | plan Step 1: APPROVE |

## Blockers
*None*

## Notes
*Reserved for execution notes*
