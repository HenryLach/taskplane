# TP-001: Workspace Config and Execution Context Foundations — Status

**Current Step:** Step 2: Wire orchestrator startup context
​**Status:** ✅ Step 1 Complete
**Last Updated:** 2026-03-15
**Review Level:** 2
**Review Counter:** 4
**Iteration:** 2
**Size:** M

> **Hydration:** Checkboxes below must be granular — one per unit of work.
> Steps marked `⚠️ Hydrate` will be expanded by the worker.

---

### Step 0: Define workspace/runtime contracts
**Status:** ✅ Complete

- [x] Add WorkspaceMode union type ("repo" | "workspace") in types.ts
- [x] Add WorkspaceRepoConfig interface (repo ID → path + optional branch) in types.ts
- [x] Add WorkspaceRoutingConfig interface (tasks_root, default_repo) in types.ts
- [x] Add WorkspaceConfig interface (mode, repos map, routing, raw file path) in types.ts
- [x] Add ExecutionContext interface (workspaceRoot, repoRoot, mode, workspaceConfig, taskRunnerConfig, orchestratorConfig) in types.ts
- [x] Add WorkspaceConfigErrorCode union with stable codes for validation failures in types.ts
- [x] Add WorkspaceConfigError typed error class in types.ts
- [x] Add createRepoModeContext() factory for repo-mode defaults in types.ts
- [x] Document mode behavior invariants as JSDoc: no file → repo mode, file + invalid → fatal, file + valid → workspace mode
- [x] Verify all new types compile cleanly (vitest imports succeed, no new failures)

---

### Step 1: Implement workspace config loading
**Status:** ✅ Complete

- [x] Create extensions/taskplane/workspace.ts with canonicalizePath() helper reusing worktree.ts normalizePath pattern
- [x] Implement YAML file reading with WORKSPACE_FILE_READ_ERROR on I/O failure
- [x] Implement YAML parsing with WORKSPACE_FILE_PARSE_ERROR on invalid YAML
- [x] Implement top-level schema validation (repos object, routing object) with WORKSPACE_SCHEMA_INVALID
- [x] Implement repos validation: WORKSPACE_MISSING_REPOS if no repos defined
- [x] Implement per-repo validation: WORKSPACE_REPO_PATH_MISSING, WORKSPACE_REPO_PATH_NOT_FOUND, WORKSPACE_REPO_NOT_GIT (via git rev-parse)
- [x] Implement duplicate repo path detection with WORKSPACE_DUPLICATE_REPO_PATH (after canonicalization)
- [x] Implement routing.tasks_root validation: WORKSPACE_MISSING_TASKS_ROOT, WORKSPACE_TASKS_ROOT_NOT_FOUND
- [x] Implement routing.default_repo validation: WORKSPACE_MISSING_DEFAULT_REPO, WORKSPACE_DEFAULT_REPO_NOT_FOUND
- [x] Implement loadWorkspaceConfig(workspaceRoot: string): WorkspaceConfig | null — returns null when no config file (repo mode), throws WorkspaceConfigError on present+invalid
- [x] Verify workspace.ts compiles cleanly and exports are importable

---

### Step 2: Wire orchestrator startup context
**Status:** 🟨 In Progress

- [ ] Load execution context during session start in extension.ts
- [ ] Thread execution context into engine entry points without changing repo-mode defaults

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Unit/regression tests passing
- [ ] Targeted tests for changed modules passing
- [ ] All failures fixed
- [ ] CLI smoke checks passing

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged
- [ ] `.DONE` created
- [ ] Archive and push

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | UNKNOWN | .reviews/R004-code-step1.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-15 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-15 05:31 | Task started | Extension-driven execution |
| 2026-03-15 05:31 | Step 0 started | Define workspace/runtime contracts |
| 2026-03-15 05:31 | Task started | Extension-driven execution |
| 2026-03-15 05:31 | Step 0 started | Define workspace/runtime contracts |
| 2026-03-15 05:33 | Review R001 | plan Step 0: UNKNOWN |
| 2026-03-15 05:36 | Step 0 hydrated | Expanded to 10 concrete sub-items per R001 review |
| 2026-03-15 05:37 | Step 0 implemented | Added workspace mode types, error codes, ExecutionContext, createRepoModeContext to types.ts |
| 2026-03-15 05:38 | Step 0 verified | All types compile cleanly, vitest loads without new failures |
| 2026-03-15 05:34 | Review R001 | plan Step 0: UNKNOWN |
| 2026-03-15 05:37 | Worker iter 1 | done in 255s, ctx: 33%, tools: 36 |
| 2026-03-15 05:38 | Worker iter 1 | done in 238s, ctx: 30%, tools: 40 |
| 2026-03-15 05:41 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-15 05:41 | Step 0 complete | Define workspace/runtime contracts |
| 2026-03-15 05:41 | Step 1 started | Implement workspace config loading |
| 2026-03-15 05:41 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-15 05:41 | Step 0 complete | Define workspace/runtime contracts |
| 2026-03-15 05:41 | Step 1 started | Implement workspace config loading |
| 2026-03-15 05:42 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-15 05:47 | Step 1 hydrated | Expanded to 11 concrete sub-items per R003 review |
| 2026-03-15 05:48 | Step 1 implemented | workspace.ts: loadWorkspaceConfig, canonicalizePath, buildExecutionContext with full validation chain |
| 2026-03-15 05:48 | Step 1 verified | Imports and compilation verified via vitest, repo mode fallback tested |
| 2026-03-15 05:48 | Step 1 complete | Implement workspace config loading |
| 2026-03-15 05:43 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-15 05:47 | Worker iter 2 | done in 300s, ctx: 26%, tools: 40 |
| 2026-03-15 05:50 | Step 1 iter 2 verified | All workspace.ts validation paths confirmed working, barrel export committed |
| 2026-03-15 05:51 | Review R004 | code Step 1: UNKNOWN |
| 2026-03-15 05:51 | Step 1 complete | Implement workspace config loading |
| 2026-03-15 05:51 | Step 2 started | Wire orchestrator startup context |

## Blockers

*None*

## Notes

*Reserved for execution notes*
