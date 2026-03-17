# TP-014: JSON Config Schema and Loader — Status

**Current Step:** Step 4: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-03-17
**Review Level:** 2
**Review Counter:** 9
**Iteration:** 5
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
**Status:** ✅ Complete

- [x] TypeScript interfaces for unified `TaskplaneConfig` schema defined in `extensions/taskplane/config-schema.ts`
- [x] Schema covers all 13 task-runner sections + 7 orchestrator sections with JSON camelCase naming
- [x] `configVersion` field with v1 semantics (required, initial value 1, unknown future versions rejected)
- [x] Centralized defaults for the unified config (single source of truth)
- [x] Section mapping documented in STATUS.md Discoveries table

---

### Step 2: Implement Unified Config Loader
**Status:** ✅ Complete

- [x] `loadProjectConfig()` implemented: reads `.pi/taskplane-config.json` first, falls back to both YAML files, respects `TASKPLANE_WORKSPACE_ROOT`, validates `configVersion`, errors on malformed JSON/unsupported version
- [x] YAML-to-camelCase mapping: snake_case keys from both YAML files mapped to unified `TaskplaneConfig` shape with deep merge + cloned defaults (non-mutating)
- [x] Backward-compatible adapter functions: `loadOrchestratorConfig()` and `loadTaskRunnerConfig()` in `config.ts` become thin wrappers over unified loader, returning existing snake_case shapes unchanged; task-runner's `loadConfig()` also wraps the unified loader
- [x] All existing consumers unaffected: `buildExecutionContext()`, `extension.ts`, task-runner command handlers produce identical runtime behavior
- [x] R006-fix: `resolveConfigRoot()` uses per-file precedence (check for actual config files, not just `.pi/` dir), prefer `TASKPLANE_WORKSPACE_ROOT` when target config files missing in cwd
- [x] R006-fix: Replace generic recursive `convertKeysToSnake()` in `toOrchestratorConfig()` with explicit field mapping that preserves record/dictionary keys verbatim (sizeWeights S/M/L, preWarm.commands, etc.)
- [x] R006-fix: `convertKeysToCamel()` only converts structural keys; preserves user-defined keys in record-valued sections (taskAreas, standardsOverrides, referenceDocs, selfDocTargets, etc.)

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

- [x] Create `extensions/tests/project-config-loader.test.ts` with loader precedence/error matrix (valid JSON, malformed JSON, missing configVersion, unsupported configVersion, JSON+YAML present uses JSON, YAML-only fallback, neither present returns defaults)
- [x] Workspace root resolution tests: cwd has `.pi` but no config → falls back to TASKPLANE_WORKSPACE_ROOT with config files
- [x] Key-preservation and adapter regression tests: record keys preserved (sizeWeights S/M/L, preWarm.commands, taskAreas IDs), snake_case adapters produce correct shapes, repoId trim/drop behavior
- [x] Defaults cloned/non-mutating across multiple calls + backward-compat wrappers (loadOrchestratorConfig, loadTaskRunnerConfig, task-runner loadConfig)
- [x] Existing tests pass: `cd extensions && npx vitest run` (16 files, 434 tests, all green)
- [x] R008-fix: Test 4.5 reworked to exercise actual `loadProjectConfig` throw on malformed JSON + verify `toTaskConfig` default shape (both halves of task-runner error-swallowing contract)
- [x] R008-fix: Export task-runner's `loadConfig()` and add a real failure-path test with malformed JSON that verifies default fallback behavior
- [x] R008-fix: All tests still green after changes

---

### Step 4: Documentation & Delivery
**Status:** ✅ Complete

- [x] Update `docs/reference/configuration/task-runner.yaml.md` — add JSON alternative section with precedence semantics, example JSON snippet, camelCase key mapping, and error behavior
- [x] Update `docs/reference/configuration/task-orchestrator.yaml.md` — add JSON alternative section with precedence semantics, example JSON snippet, camelCase key mapping, and error behavior
- [x] Check `docs/tutorials/install.md` — update or explicitly no-op references to YAML scaffolding (lines mentioning `.pi/task-runner.yaml` / `.pi/task-orchestrator.yaml`) — NO-OP: `taskplane init` still scaffolds YAML files, JSON config is an opt-in alternative, so YAML references in the install tutorial remain correct
- [x] `.DONE` created

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | APPROVE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | APPROVE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | APPROVE | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | APPROVE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | APPROVE | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | APPROVE | .reviews/R004-code-step1.md |
| R004 | code | Step 1 | APPROVE | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R008 | code | Step 3 | REVISE | .reviews/R008-code-step3.md |
| R008 | code | Step 3 | REVISE | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| task-runner.ts has its own `TaskConfig` interface + `loadConfig()` that reads `.pi/task-runner.yaml` with YAML parse + defaults merge. Separate from orchestrator's config.ts. | Step 1 input | `extensions/task-runner.ts:40-190` |
| Orchestrator config.ts has `loadOrchestratorConfig()` and `loadTaskRunnerConfig()` — two separate loaders reading two YAML files | Step 1 input | `extensions/taskplane/config.ts` |
| types.ts has `OrchestratorConfig`, `TaskRunnerConfig` interfaces + `DEFAULT_ORCHESTRATOR_CONFIG`, `DEFAULT_TASK_RUNNER_CONFIG` defaults | Step 1 input | `extensions/taskplane/types.ts` |
| task-runner.ts supports `TASKPLANE_WORKSPACE_ROOT` env var fallback for config path resolution | Step 2 input | `extensions/task-runner.ts:146-149` |
| task-runner.yaml has 13 top-level sections; task-orchestrator.yaml has 7 sections. Unified schema must merge all 20 sections. | Step 1 input | docs/reference/configuration/ |
| Section mapping (YAML→JSON): task-runner: project→taskRunner.project, paths→taskRunner.paths, testing→taskRunner.testing, standards→taskRunner.standards, standards_overrides→taskRunner.standardsOverrides, worker→taskRunner.worker, reviewer→taskRunner.reviewer, context→taskRunner.context, task_areas→taskRunner.taskAreas, reference_docs→taskRunner.referenceDocs, never_load→taskRunner.neverLoad, self_doc_targets→taskRunner.selfDocTargets, protected_docs→taskRunner.protectedDocs. Orchestrator: orchestrator→orchestrator.orchestrator, dependencies→orchestrator.dependencies, assignment→orchestrator.assignment, pre_warm→orchestrator.preWarm, merge→orchestrator.merge, failure→orchestrator.failure, monitoring→orchestrator.monitoring | Step 2 input | `extensions/taskplane/config-schema.ts` |
| Key naming policy: JSON uses camelCase (maxLanes, workerContextWindow, etc). YAML snake_case keys (max_lanes, worker_context_window) mapped in loader. Inner keys also camelCase: onTaskFailure (was on_task_failure), sizeWeights (was size_weights), etc. | Step 2 input | `extensions/taskplane/config-schema.ts` |

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
| 2026-03-17 14:29 | Worker iter 2 | done in 377s, ctx: 30%, tools: 57 |
| 2026-03-17 14:30 | Worker iter 2 | done in 414s, ctx: 29%, tools: 51 |
| 2026-03-17 14:33 | Review R004 | code Step 1: APPROVE |
| 2026-03-17 14:33 | Step 1 complete | Define JSON Schema |
| 2026-03-17 14:33 | Step 2 started | Implement Unified Config Loader |
| 2026-03-17 14:33 | Review R004 | code Step 1: APPROVE |
| 2026-03-17 14:33 | Step 1 complete | Define JSON Schema |
| 2026-03-17 14:33 | Step 2 started | Implement Unified Config Loader |
| 2026-03-17 14:35 | Review R005 | plan Step 2: REVISE |
| 2026-03-17 14:36 | Review R005 | plan Step 2: REVISE |
| 2026-03-17 14:46 | Worker iter 3 | done in 587s, ctx: 32%, tools: 63 |
| 2026-03-17 14:46 | Worker iter 3 | done in 679s, ctx: 30%, tools: 47 |
| 2026-03-17 14:53 | Review R006 | code Step 2: REVISE |
| 2026-03-17 14:53 | Review R006 | code Step 2: REVISE |
| 2026-03-17 14:58 | Worker iter 3 | done in 329s, ctx: 28%, tools: 38 |
| 2026-03-17 14:58 | Step 2 complete | Implement Unified Config Loader |
| 2026-03-17 14:58 | Step 3 started | Testing & Verification |
| 2026-03-17 14:59 | Worker iter 3 | done in 367s, ctx: 25%, tools: 38 |
| 2026-03-17 14:59 | Step 2 complete | Implement Unified Config Loader |
| 2026-03-17 14:59 | Step 3 started | Testing & Verification |
| 2026-03-17 15:00 | Review R007 | plan Step 3: REVISE |
| 2026-03-17 15:01 | Review R007 | plan Step 3: REVISE |
| 2026-03-17 15:07 | Worker iter 4 | done in 396s, ctx: 28%, tools: 41 |
| 2026-03-17 15:07 | Worker iter 4 | done in 342s, ctx: 26%, tools: 32 |
| 2026-03-17 15:09 | Review R008 | code Step 3: REVISE |
| 2026-03-17 15:10 | Review R008 | code Step 3: REVISE |
| 2026-03-17 15:15 | Worker iter 4 | done in 313s, ctx: 17%, tools: 42 |
| 2026-03-17 15:15 | Step 3 complete | Testing & Verification |
| 2026-03-17 15:15 | Step 4 started | Documentation & Delivery |
| 2026-03-17 15:16 | Worker iter 4 | done in 380s, ctx: 21%, tools: 40 |
| 2026-03-17 15:16 | Step 3 complete | Testing & Verification |
| 2026-03-17 15:16 | Step 4 started | Documentation & Delivery |
| 2026-03-17 15:17 | Review R009 | plan Step 4: REVISE |
| 2026-03-17 15:18 | Review R009 | plan Step 4: REVISE |

## Blockers
*None*

## Notes
*Reserved for execution notes*
