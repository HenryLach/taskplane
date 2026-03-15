# TP-001: Workspace Config and Execution Context Foundations — Status

**Current Step:** Complete
​**Status:** ✅ Complete
**Last Updated:** 2026-03-15
**Review Level:** 2
**Review Counter:** 10
**Iteration:** 5
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
**Status:** ✅ Complete

- [x] Add module-level `execCtx` variable in extension.ts to hold the loaded ExecutionContext
- [x] Call `buildExecutionContext(ctx.cwd, loadOrchestratorConfig, loadTaskRunnerConfig)` in `session_start` handler
- [x] Catch `WorkspaceConfigError` in `session_start` — emit fatal notification with error code + message + actionable guidance, skip command registration
- [x] Populate `orchConfig` and `runnerConfig` from `execCtx` fields instead of standalone calls
- [x] Replace `ctx.cwd` usages in extension.ts with `execCtx.repoRoot` for all operations (state, discovery, orphan, abort, engine) — consistent with engine.ts/resume.ts/execution.ts root semantics
- [x] Pass `execCtx.repoRoot` (instead of `ctx.cwd`) into `executeOrchBatch()` cwd parameter
- [x] Pass `execCtx.repoRoot` (instead of `ctx.cwd`) into `resumeOrchBatch()` cwd parameter
- [x] Pass `execCtx.repoRoot` (instead of `ctx.cwd`) into discovery, orphan detection, batch state load/delete, and abort signal paths (R006 fix: use repoRoot not workspaceRoot for consistency with engine/resume)
- [x] Add startup guard: if `execCtx` is null (workspace config error), commands return early with "Orchestrator not initialized" notification
- [x] Verify repo-mode parity: no workspace config file → workspaceRoot === repoRoot === cwd, behavior unchanged
- [x] Verify all changes compile cleanly via vitest

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

#### 3.1: Triage pre-existing test failures (no-regression baseline)
- [x] Run full `cd extensions && npx vitest run` and capture baseline failure list
- [x] Confirm all failures are pre-existing (not caused by TP-001 changes): verified TP-001 diff doesn't touch any test files; all failures are source-verification tests looking for patterns in old task-orchestrator.ts monolith
- [x] Document pre-existing failure count and suites in execution log

#### 3.2: Write targeted workspace config tests (`extensions/tests/workspace-config.test.ts`)
- [x] Test loadWorkspaceConfig returns null when no config file (repo mode)
- [x] Test loadWorkspaceConfig throws WORKSPACE_FILE_PARSE_ERROR on invalid YAML
- [x] Test loadWorkspaceConfig throws WORKSPACE_SCHEMA_INVALID on missing repos/routing (2 tests: no repos, no routing)
- [x] Test loadWorkspaceConfig throws WORKSPACE_SCHEMA_INVALID on scalar/array YAML (2 tests)
- [x] Test loadWorkspaceConfig throws WORKSPACE_MISSING_REPOS on empty repos map
- [x] Test loadWorkspaceConfig throws WORKSPACE_REPO_PATH_MISSING on repo without path
- [x] Test loadWorkspaceConfig throws WORKSPACE_REPO_PATH_NOT_FOUND on non-existent repo path
- [x] Test loadWorkspaceConfig throws WORKSPACE_REPO_NOT_GIT on non-git directory
- [x] Test loadWorkspaceConfig throws WORKSPACE_DUPLICATE_REPO_PATH on duplicate paths
- [x] Test loadWorkspaceConfig throws WORKSPACE_MISSING_TASKS_ROOT on missing routing.tasks_root
- [x] Test loadWorkspaceConfig throws WORKSPACE_TASKS_ROOT_NOT_FOUND on non-existent tasks root
- [x] Test loadWorkspaceConfig throws WORKSPACE_MISSING_DEFAULT_REPO on missing routing.default_repo
- [x] Test loadWorkspaceConfig throws WORKSPACE_DEFAULT_REPO_NOT_FOUND on invalid default_repo ID
- [x] Test loadWorkspaceConfig returns valid WorkspaceConfig for well-formed config with git repos
- [x] Test loadWorkspaceConfig handles multiple repos in valid config

#### 3.3: Write targeted execution context tests (`extensions/tests/workspace-config.test.ts`)
- [x] Test buildExecutionContext in repo mode: workspaceRoot === repoRoot === cwd, mode === "repo"
- [x] Test buildExecutionContext in workspace mode: workspaceRoot !== repoRoot, mode === "workspace", repoRoot === default repo path
- [x] Test buildExecutionContext propagates WorkspaceConfigError from invalid config

#### 3.4: Write type/contract unit tests
- [x] Test canonicalizePath normalizes backslashes to forward slashes
- [x] Test canonicalizePath lowercases results
- [x] Test canonicalizePath resolves relative paths against base
- [x] Test canonicalizePath handles absolute paths
- [x] Test WorkspaceConfigError has correct code, message, repoId, relatedPath
- [x] Test WorkspaceConfigError repoId and relatedPath are optional
- [x] Test createRepoModeContext returns correct shape (workspaceRoot === repoRoot, mode === "repo")
- [x] Test workspaceConfigPath returns expected path

#### 3.5: Root-consistency regression verification (source-verified in tests + manual code review)
- [x] Verify extension.ts /orch uses execCtx.repoRoot for discovery, orphan detection, batch state, executeOrchBatch cwd — confirmed via source verification tests (5.1–5.5) and manual grep
- [x] Verify extension.ts /orch-plan uses execCtx.repoRoot for discovery — confirmed L260 `execCtx!.repoRoot`
- [x] Verify extension.ts /orch-deps uses execCtx.repoRoot for discovery — confirmed L594 `execCtx!.repoRoot`
- [x] Verify extension.ts /orch-resume uses execCtx.repoRoot for resumeOrchBatch cwd — confirmed L374 `execCtx!.repoRoot`
- [x] Verify extension.ts /orch-abort uses execCtx.repoRoot (with ctx.cwd fallback) for state/abort signal — confirmed L404 `execCtx?.repoRoot ?? ctx.cwd`, source verification test 5.6
- [x] Verify engine.ts maps cwd → repoRoot and uses it consistently for discovery, state, abort — confirmed L45 `const repoRoot = cwd`, source verification test 5.7
- [x] Verify resume.ts maps cwd → repoRoot and uses it consistently for state, discovery, DONE checks — confirmed L339 `const repoRoot = cwd`, source verification test 5.8
- [x] Verify no remaining raw ctx.cwd usage in extension.ts except in session_start (buildExecutionContext), orch-abort fallback, and orch-abort comment — confirmed 3 matches: L401 comment, L404 fallback code, L634 session_start

#### 3.6: Run targeted workspace tests
- [x] Run `cd extensions && npx vitest run tests/workspace-config.test.ts` — all 38 tests pass
- [x] Fixed 3 initial test failures (invalid YAML test input, ctx.cwd count)

#### 3.7: Full suite regression run
- [x] Run `cd extensions && npx vitest run` — 4 failed files (all pre-existing), 2 passed files (worktree-lifecycle + workspace-config), no new failures
- [x] Confirm worktree-lifecycle.test.ts still passes

#### 3.8: CLI smoke checks
- [x] Run `node bin/taskplane.mjs help` — exits 0 with valid output
- [x] Run `node bin/taskplane.mjs doctor` — runs successfully (exit 1 expected: worktree lacks config files, not a regression)

---

### Step 4: Documentation & Delivery
**Status:** ✅ Complete

- [x] "Must Update" docs modified: Updated `polyrepo-support-spec.md` (status, §5 impl notes, §6 schema adjustments, §14 Phase 1 checklist) and `polyrepo-implementation-plan.md` (status, WS-A marked delivered, PR-1 marked delivered, readiness checklist updated)
- [x] "Check If Affected" docs reviewed: `docs/reference/commands.md` — no user-visible command or option changes in TP-001, no update needed
- [x] Discoveries logged
- [x] `.DONE` created
- [ ] Archive and push (orchestrator handles post-merge)

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
| R005 | plan | Step 2 | UNKNOWN | .reviews/R005-plan-step2.md |
| R004 | code | Step 1 | UNKNOWN | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | UNKNOWN | .reviews/R005-plan-step2.md |
| R006 | code | Step 2 | UNKNOWN | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | UNKNOWN | .reviews/R007-plan-step3.md |
| R006 | code | Step 2 | UNKNOWN | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | UNKNOWN | .reviews/R007-plan-step3.md |
| R008 | code | Step 3 | UNKNOWN | .reviews/R008-code-step3.md |
| R008 | code | Step 3 | UNKNOWN | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | UNKNOWN | .reviews/R009-plan-step4.md |
| R009 | plan | Step 4 | UNKNOWN | .reviews/R009-plan-step4.md |
| R010 | code | Step 4 | UNAVAILABLE | .reviews/R010-code-step4.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Spec schema has `version`, `mode`, `workspace.root` fields not yet parsed by loader — mode inferred from file presence | Documented in polyrepo-support-spec.md §6 | workspace.ts |
| Spec uses `integration_branch` but implementation uses `default_branch` (aligns with WorkspaceRepoConfig.defaultBranch) | Documented in polyrepo-support-spec.md §6 | types.ts, workspace.ts |
| `routing.area_to_repo` mapping not implemented — deferred to WS-B (task routing workstream) | Documented in polyrepo-support-spec.md §6 and polyrepo-implementation-plan.md WS-A | workspace.ts |
| `.pi/local/docs/` is gitignored and lives only in the main worktree, not accessible via git in worktrees | Noted — doc updates written directly to main worktree's .pi/local/docs/ | .gitignore |
| Pre-existing test failures (4 files, 24 sub-failures) are all source-verification tests looking for patterns in old monolith file; not caused by TP-001 | No action needed | extensions/tests/ |

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
| 2026-03-15 05:51 | Worker iter 2 | done in 492s, ctx: 31%, tools: 61 |
| 2026-03-15 05:53 | Review R005 | plan Step 2: UNKNOWN |
| 2026-03-15 05:54 | Review R004 | code Step 1: UNKNOWN |
| 2026-03-15 05:54 | Step 1 complete | Implement workspace config loading |
| 2026-03-15 05:54 | Step 2 started | Wire orchestrator startup context |
| 2026-03-15 05:56 | Review R005 | plan Step 2: UNKNOWN |
| 2026-03-15 05:58 | Step 2 verified | All 11 sub-items confirmed complete from prior iteration; no new ctx.cwd usages remain; vitest compilation passes with same pre-existing failures |
| 2026-03-15 05:58 | Step 2 complete | Wire orchestrator startup context |
| 2026-03-15 06:00 | Worker iter 3 | done in 264s, ctx: 30%, tools: 28 |
| 2026-03-15 06:03 | Review R006 | code Step 2: UNKNOWN |
| 2026-03-15 06:03 | Step 2 complete | Wire orchestrator startup context |
| 2026-03-15 06:03 | Step 3 started | Testing & Verification |
| 2026-03-15 06:07 | R006 fix applied | Changed all workspaceRoot→repoRoot for state/discovery/abort/orphan paths in extension.ts for consistency with engine/resume/execution |
| 2026-03-15 06:06 | Review R007 | plan Step 3: UNKNOWN |
| 2026-03-15 06:10 | Step 3 hydrated | Expanded to 8 sections with 38+ concrete sub-items per R007 review |
| 2026-03-15 06:12 | Pre-existing failures triaged | 4 failing test files (24 sub-failures), all source-verification tests against old monolith, none workspace-related |
| 2026-03-15 06:13 | Workspace tests created | extensions/tests/workspace-config.test.ts: 38 tests covering loadWorkspaceConfig (17), buildExecutionContext (3), canonicalizePath (4), type contracts (4), root-consistency regression (10) |
| 2026-03-15 06:14 | Test fixes applied | Fixed invalid YAML test inputs (yaml lib parses {{ }} as valid), adjusted ctx.cwd count for comment match |
| 2026-03-15 06:14 | Targeted tests pass | All 38 workspace-config tests green |
| 2026-03-15 06:14 | Full regression pass | No new failures: 4 pre-existing failed files + 2 passed files (worktree-lifecycle + workspace-config) |
| 2026-03-15 06:15 | CLI smoke checks pass | `help` exits 0, `doctor` runs correctly |
| 2026-03-15 06:15 | Step 3 complete | All sub-items verified, tests written and passing |
| 2026-03-15 06:07 | Worker iter 3 | done in 812s, ctx: 51%, tools: 92 |
| 2026-03-15 06:10 | Review R006 | code Step 2: UNKNOWN |
| 2026-03-15 06:10 | Step 2 complete | Wire orchestrator startup context |
| 2026-03-15 06:10 | Step 3 started | Testing & Verification |
| 2026-03-15 06:13 | Review R007 | plan Step 3: UNKNOWN |
| 2026-03-15 06:16 | Worker iter 4 | done in 573s, ctx: 34%, tools: 66 |
| 2026-03-15 06:17 | Worker iter 4 | done in 255s, ctx: 33%, tools: 28 |
| 2026-03-15 06:19 | Review R008 | code Step 3: UNKNOWN |
| 2026-03-15 06:19 | Step 3 complete | Testing & Verification |
| 2026-03-15 06:19 | Step 4 started | Documentation & Delivery |
| 2026-03-15 06:19 | Review R008 | code Step 3: UNKNOWN |
| 2026-03-15 06:19 | Step 3 complete | Testing & Verification |
| 2026-03-15 06:19 | Step 4 started | Documentation & Delivery |
| 2026-03-15 06:22 | Review R009 | plan Step 4: UNKNOWN |
| 2026-03-15 06:22 | Review R009 | plan Step 4: UNKNOWN |
| 2026-03-15 06:25 | Step 4 docs updated | polyrepo-support-spec.md and polyrepo-implementation-plan.md updated with TP-001 delivery status |
| 2026-03-15 06:25 | Step 4 review | docs/reference/commands.md checked — no user-visible changes, no update needed |
| 2026-03-15 06:25 | Step 4 discoveries | 5 discoveries logged |
| 2026-03-15 06:25 | .DONE created | Task complete |
| 2026-03-15 06:28 | Reviewer R010 | code review — reviewer did not produce output |
| 2026-03-15 06:28 | Review R010 | code Step 4: UNAVAILABLE |
| 2026-03-15 06:28 | Step 4 complete | Documentation & Delivery |
| 2026-03-15 06:28 | Task complete | .DONE created |

## Blockers

*None*

## Notes

*Reserved for execution notes*
