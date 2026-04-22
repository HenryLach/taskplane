# TP-015: Init v2: Mode Detection, Gitignore, and Artifact Cleanup — Status

**Current Step:** Step 7: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-03-17
**Review Level:** 2
**Review Counter:** 16
**Iteration:** 8
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read current `cmdInit()` implementation
- [x] Read spec auto-detection and gitignore sections
- [x] Verify spec reachability and record source path
- [x] Verify TP-014 config loader/schema contract (JSON output shape, YAML fallback expectations)
- [x] Record current `cmdInit()` behavior to preserve (--preset, YAML continuity, --tasks-root, --dry-run, --force, --no-examples)
- [x] Identify downstream validation (existing tests, CLI checks for init regressions)
- [x] R002: Revert TP-014 file changes from TP-015 commits (scope drift fix)
- [x] R002: Fix malformed STATUS.md tables (separator placement, deduplicate review rows and log entries)

---

### Step 1: Mode Auto-Detection
**Status:** ✅ Complete

- [x] Detection logic implemented (git repo check, subdirectory git repo scan, mode determination)
- [x] Error path: no git repo and no git repo subdirectories → clear error message and exit
- [x] Ambiguous case handled with prompt; preset/non-interactive mode defaults to repo mode (no prompt)
- [x] "Already initialized" detection for Scenario B (existing config check before topology detection)
- [x] Validate: repo mode, workspace mode, ambiguous prompt, no-repo error, preset bypass all covered
- [x] R004: Fix `findSubdirectoryGitRepos()` — must check for actual nested repo roots (`.git` entry + `git rev-parse --show-toplevel` matching child), not just "inside work tree"
- [x] R004: Fix `existingConfigPath` mismatch — when ambiguous mode resolves to workspace, recompute workspace-specific existing-config detection instead of reusing monorepo `.pi` path

---

### Step 2: Gitignore Enforcement
**Status:** ✅ Complete

- [x] Define required gitignore entries as a reusable constant (for Step 4 reuse)
- [x] Implement `ensureGitignoreEntries()` helper — idempotent: creates file if needed, skips existing entries, respects dry-run
- [x] Integrate gitignore enforcement into `cmdInit()` repo-mode flow (after scaffolding, before auto-commit)
- [x] Implement tracked-artifact detection (`git ls-files`) and `git rm --cached` offer — isolated from auto-commit staging, respects dry-run and non-interactive modes
- [x] Update `printFileList()` dry-run output to show gitignore entries that would be added
- [x] R006: Fix `patternToRegex()` — directory patterns (trailing `/`) must be prefix matches; switch `git rm --cached` to `execFileSync` for shell-safety
- [x] R006: Remove unused `buildGitignoreBlock()` function
- [x] R006: Add test coverage for tracked-artifact pattern matching (directories, wildcards)

---

### Step 3: tmux and Environment Detection
**Status:** ✅ Complete

- [x] Implement `detectSpawnMode()` reusable helper that returns `{ spawnMode, hasTmux }` — reusable for Step 4 workspace init
- [x] Wire detected spawn_mode into `generateOrchestratorYaml()` via init vars (replace hardcoded `"subprocess"`)
- [x] Show guidance message when tmux not found; silent when present. Skip message for runner-only preset (no orchestrator). Respect dry-run output.
- [x] Verify: preset/dry-run/runner-only compatibility; tmux-present and tmux-absent branches

---

### Step 4: Workspace Mode Init (Scenario C)
**Status:** ✅ Complete

- [x] Config repo selection prompt and workspace interactive/preset vars gathering
- [x] Scaffold `.taskplane/` in config repo (config JSON, workspace.json, agents, version tracker, CONTEXT.md, examples)
- [x] Gitignore enforcement in config repo with `.taskplane/`-scoped prefix; tracked-artifact detection
- [x] Pointer file creation (`taskplane-pointer.json`) in workspace root `.pi/`
- [x] Dry-run/preset/force/non-interactive compatibility for workspace mode
- [x] Post-init merge guidance and auto-commit in config repo
- [x] R010: Pass `prefix: ".taskplane/"` to `ensureGitignoreEntries()` and extend tracked-artifact detection with prefix-aware scanning
- [x] R010: Include `.gitignore` in workspace auto-commit staging alongside `.taskplane/`
- [x] R010: Fix overwrite confirmation — track user confirmation to set `skipIfExists` accordingly

---

### Step 5: Workspace Join (Scenario D)
**Status:** ✅ Complete

- [x] Scenario D early-return branch: when existing `.taskplane/` is detected, skip Scenario C scaffolding/prompts/gitignore/auto-commit and create pointer only
- [x] Pointer idempotency: handle existing `.pi/taskplane-pointer.json` (overwrite prompt, --force semantics, dry-run output)
- [x] User confirmation messaging: show which config repo was found and what was created
- [x] Scenario C preservation: verify Scenario C flow is unbroken when no existing `.taskplane/` is found
- [x] R012: Fix control-flow bug — `--force` must not bypass Scenario D; separate Scenario D detection from `!force` gate, apply `force` only to pointer overwrite
- [x] R012: Wrap pointer JSON.parse in try/catch — malformed pointer should prompt overwrite, not crash

---

### Step 6: Testing & Verification
**Status:** ✅ Complete

- [x] Baseline validation gates pass (`cd extensions && npx vitest run`, `node bin/taskplane.mjs help`, `node bin/taskplane.mjs doctor`)
- [x] Scenario A (repo mode, fresh init) dry-run works: `node bin/taskplane.mjs init --dry-run --force --preset full`
- [x] Preset compatibility verified: `--preset minimal`, `--preset full`, `--preset runner-only` all work with `--dry-run --force`
- [x] YAML output still generated alongside JSON (constraint from PROMPT)
- [x] Mode detection edge cases and regression coverage: add init-focused automated test file covering mode detection, gitignore enforcement, and scenario branching
- [x] R014: Fix mirrored `isGitRepoRoot()` in test to include `fs.realpathSync.native()` normalization matching production code, and add regression case for path-canonicalization mismatch
- [x] R014: Re-run vitest to confirm all tests pass after fix

---

### Step 7: Documentation & Delivery
**Status:** ✅ Complete

- [x] Update `docs/tutorials/install.md` — document init-v2 flow: mode auto-detection (repo vs workspace), gitignore enforcement + tracked artifact cleanup, tmux-based spawn_mode defaulting, JSON config output with YAML transition note
- [x] Check/update `docs/reference/commands.md` — verify `taskplane init` section reflects new behavior
- [x] Check/update `README.md` — verify install/quickstart section is consistent with new init flow
- [x] Final verification: commits use TP-015 prefix, all tests pass
- [x] `.DONE` created in task folder

---

## Reviews
| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R007 | plan | Step 3 | APPROVE | .reviews/R007-plan-step3.md |
| R008 | code | Step 3 | APPROVE | .reviews/R008-code-step3.md |
| R008 | code | Step 3 | APPROVE | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
| R010 | code | Step 4 | REVISE | .reviews/R010-code-step4.md |
| R010 | code | Step 4 | REVISE | .reviews/R010-code-step4.md |
| R011 | plan | Step 5 | REVISE | .reviews/R011-plan-step5.md |
| R011 | plan | Step 5 | APPROVE | .reviews/R011-plan-step5.md |
| R012 | code | Step 5 | REVISE | .reviews/R012-code-step5.md |
| R012 | code | Step 5 | REVISE | .reviews/R012-code-step5.md |
| R013 | plan | Step 6 | REVISE | .reviews/R013-plan-step6.md |
| R013 | plan | Step 6 | REVISE | .reviews/R013-plan-step6.md |
| R014 | code | Step 6 | REVISE | .reviews/R014-code-step6.md |
| R014 | code | Step 6 | REVISE | .reviews/R014-code-step6.md |
| R015 | plan | Step 7 | REVISE | .reviews/R015-plan-step7.md |
| R015 | plan | Step 7 | REVISE | .reviews/R015-plan-step7.md |
| R016 | code | Step 7 | UNAVAILABLE | .reviews/R016-code-step7.md |

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Spec not in worktree — `.pi/local/` is gitignored. Canonical source: `C:\dev\taskplane\.pi\local\docs\settings-and-onboarding-spec.md` (main repo). Read successfully from there. | Noted | Step 0 |
| TP-014 contract verified: JSON filename=`taskplane-config.json`, configVersion=1, shape=`{configVersion,taskRunner,orchestrator}`. Loader: `loadProjectConfig()` in `config-loader.ts`. JSON-first, YAML fallback. spawnMode at `orchestrator.orchestrator.spawnMode`. PROMPT says keep YAML generation until JSON is validated. | Noted | Step 0 |
| No existing init-specific tests. Downstream validation: `project-config-loader.test.ts` (39 tests), CLI smoke `node bin/taskplane.mjs help`, `taskplane init --dry-run --force`. Step 6 should add init-specific tests. | Noted | Step 0 |
| Windows 8.3 short path bug in `isGitRepoRoot()`: `path.resolve(dir)` could return `HENRYL~1` while git returns `HenryLach`, causing path comparison to fail. Fixed with `fs.realpathSync.native()`. | Fixed | Step 6 |

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-17 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-17 15:23 | Task started | Extension-driven execution |
| 2026-03-17 15:23 | Step 0 started | Preflight |
| 2026-03-17 15:25 | Review R001 | plan Step 0: REVISE |
| 2026-03-17 15:29 | Worker iter 1 | done in 242s, ctx: 31%, tools: 49 |
| 2026-03-17 15:31 | Review R002 | code Step 0: REVISE |
| 2026-03-17 15:34 | Worker iter 1 | done in 75s, ctx: 9%, tools: 11 |
| 2026-03-17 15:34 | Step 0 complete | Preflight |
| 2026-03-17 15:34 | Step 1 started | Mode Auto-Detection |
| 2026-03-17 15:35 | Worker iter 1 | done in 190s, ctx: 14%, tools: 31 |
| 2026-03-17 15:35 | Step 0 complete | Preflight |
| 2026-03-17 15:35 | Step 1 started | Mode Auto-Detection |
| 2026-03-17 15:36 | Review R003 | plan Step 1: REVISE |
| 2026-03-17 15:36 | Review R003 | plan Step 1: REVISE |
| 2026-03-17 15:44 | Worker iter 2 | done in 461s, ctx: 26%, tools: 63 |
| 2026-03-17 15:44 | Worker iter 2 | done in 450s, ctx: 28%, tools: 50 |
| 2026-03-17 15:46 | Review R004 | code Step 1: REVISE |
| 2026-03-17 15:47 | Review R004 | code Step 1: REVISE |
| 2026-03-17 15:51 | Worker iter 2 | done in 296s, ctx: 16%, tools: 37 |
| 2026-03-17 15:51 | Step 1 complete | Mode Auto-Detection |
| 2026-03-17 15:51 | Step 2 started | Gitignore Enforcement |
| 2026-03-17 15:52 | Worker iter 2 | done in 345s, ctx: 16%, tools: 39 |
| 2026-03-17 15:52 | Step 1 complete | Mode Auto-Detection |
| 2026-03-17 15:52 | Step 2 started | Gitignore Enforcement |
| 2026-03-17 15:53 | Review R005 | plan Step 2: REVISE |
| 2026-03-17 15:54 | Review R005 | plan Step 2: REVISE |
| 2026-03-17 16:01 | Worker iter 3 | done in 454s, ctx: 23%, tools: 60 |
| 2026-03-17 16:02 | Worker iter 3 | done in 484s, ctx: 29%, tools: 55 |
| 2026-03-17 16:04 | Review R006 | code Step 2: REVISE |
| 2026-03-17 16:04 | Review R006 | code Step 2: REVISE |
| 2026-03-17 16:10 | Worker iter 3 | done in 342s, ctx: 19%, tools: 48 |
| 2026-03-17 16:10 | Step 2 complete | Gitignore Enforcement |
| 2026-03-17 16:10 | Step 3 started | tmux and Environment Detection |
| 2026-03-17 16:12 | Review R007 | plan Step 3: REVISE |
| 2026-03-17 16:12 | Worker iter 3 | done in 501s, ctx: 23%, tools: 68 |
| 2026-03-17 16:12 | Step 2 complete | Gitignore Enforcement |
| 2026-03-17 16:12 | Step 3 started | tmux and Environment Detection |
| 2026-03-17 16:13 | Review R007 | plan Step 3: APPROVE |
| 2026-03-17 16:16 | Worker iter 4 | done in 189s, ctx: 23%, tools: 23 |
| 2026-03-17 16:17 | Worker iter 4 | done in 333s, ctx: 21%, tools: 54 |
| 2026-03-17 16:19 | Review R008 | code Step 3: APPROVE |
| 2026-03-17 16:19 | Step 3 complete | tmux and Environment Detection |
| 2026-03-17 16:19 | Step 4 started | Workspace Mode Init (Scenario C) |
| 2026-03-17 16:19 | Review R008 | code Step 3: APPROVE |
| 2026-03-17 16:19 | Step 3 complete | tmux and Environment Detection |
| 2026-03-17 16:19 | Step 4 started | Workspace Mode Init (Scenario C) |
| 2026-03-17 16:21 | Review R009 | plan Step 4: REVISE |
| 2026-03-17 16:21 | Review R009 | plan Step 4: REVISE |
| 2026-03-17 16:28 | Worker iter 5 | done in 411s, ctx: 30%, tools: 70 |
| 2026-03-17 16:30 | Worker iter 5 | done in 592s, ctx: 33%, tools: 71 |
| 2026-03-17 16:32 | Review R010 | code Step 4: REVISE |
| 2026-03-17 16:34 | Review R010 | code Step 4: REVISE |
| 2026-03-17 16:37 | Worker iter 5 | done in 194s, ctx: 21%, tools: 33 |
| 2026-03-17 16:37 | Step 4 complete | Workspace Mode Init (Scenario C) |
| 2026-03-17 16:37 | Step 5 started | Workspace Join (Scenario D) |
| 2026-03-17 16:38 | Review R011 | plan Step 5: REVISE |
| 2026-03-17 16:39 | Worker iter 5 | done in 432s, ctx: 23%, tools: 56 |
| 2026-03-17 16:39 | Step 4 complete | Workspace Mode Init (Scenario C) |
| 2026-03-17 16:39 | Step 5 started | Workspace Join (Scenario D) |
| 2026-03-17 16:40 | Review R011 | plan Step 5: APPROVE |
| 2026-03-17 16:45 | Worker iter 6 | done in 314s, ctx: 18%, tools: 32 |
| 2026-03-17 16:47 | Worker iter 6 | done in 525s, ctx: 23%, tools: 43 |
| 2026-03-17 16:47 | Review R012 | code Step 5: REVISE |
| 2026-03-17 16:49 | Review R012 | code Step 5: REVISE |
| 2026-03-17 16:51 | Worker iter 6 | done in 248s, ctx: 14%, tools: 20 |
| 2026-03-17 16:51 | Step 5 complete | Workspace Join (Scenario D) |
| 2026-03-17 16:51 | Step 6 started | Testing & Verification |
| 2026-03-17 16:51 | Worker iter 6 | done in 159s, ctx: 16%, tools: 23 |
| 2026-03-17 16:51 | Step 5 complete | Workspace Join (Scenario D) |
| 2026-03-17 16:51 | Step 6 started | Testing & Verification |
| 2026-03-17 16:53 | Review R013 | plan Step 6: REVISE |
| 2026-03-17 16:53 | Review R013 | plan Step 6: REVISE |
| 2026-03-17 17:06 | Worker iter 7 | done in 763s, ctx: 44%, tools: 73 |
| 2026-03-17 17:06 | Worker iter 7 | done in 794s, ctx: 36%, tools: 55 |
| 2026-03-17 17:09 | Review R014 | code Step 6: REVISE |
| 2026-03-17 17:10 | Review R014 | code Step 6: REVISE |
| 2026-03-17 17:13 | Worker iter 7 | done in 197s, ctx: 15%, tools: 16 |
| 2026-03-17 17:13 | Step 6 complete | Testing & Verification |
| 2026-03-17 17:13 | Step 7 started | Documentation & Delivery |
| 2026-03-17 17:14 | Worker iter 7 | done in 268s, ctx: 19%, tools: 30 |
| 2026-03-17 17:14 | Step 6 complete | Testing & Verification |
| 2026-03-17 17:14 | Step 7 started | Documentation & Delivery |
| 2026-03-17 17:15 | Review R015 | plan Step 7: REVISE |
| 2026-03-17 17:15 | Review R015 | plan Step 7: REVISE |
| 2026-03-17 17:23 | Reviewer R016 | code review — reviewer did not produce output |
| 2026-03-17 17:23 | Review R016 | code Step 7: UNAVAILABLE |
| 2026-03-17 17:23 | Step 7 complete | Documentation & Delivery |
| 2026-03-17 17:23 | Task complete | .DONE created |

## Blockers
*None*

## Notes

### Current `cmdInit()` behavior to preserve (Step 0 preflight)

1. **Flags**: `--force`, `--dry-run`, `--no-examples`, `--include-examples`, `--preset <name>`, `--tasks-root <path>`
2. **Presets**: `minimal`, `full`, `runner-only` — call `getPresetVars()`, skip interactive prompts
3. **Interactive mode**: prompts for project name, max lanes, tasks directory, area name, prefix, test/build commands
4. **Config check**: detects existing `.pi/task-runner.yaml` or `.pi/task-orchestrator.yaml`; prompts to overwrite if `--force` not set
5. **Files created**: agent prompts (3), task-runner.yaml, task-orchestrator.yaml (unless runner-only), taskplane.json, CONTEXT.md, example tasks
6. **Auto-commit**: `autoCommitTaskFiles()` commits tasks dir to git after scaffolding
7. **Stack detection**: `detectStack()` checks package.json/go.mod/Cargo.toml etc. for test/build commands
8. **YAML generation**: `generateTaskRunnerYaml()` and `generateOrchestratorYaml()` — currently YAML-only output, no JSON output yet
9. **Template interpolation**: `{{variables}}` in CONTEXT.md and example tasks
10. **`--tasks-root`**: validates relative, non-empty, no `..`; disables examples unless `--include-examples`

### Key constraints for v2

- PROMPT: "Do NOT break existing `--preset` flags"
- PROMPT: "Do NOT remove YAML config generation until JSON is fully validated"
- Spec: init should output `taskplane-config.json` (JSON) — but YAML must remain as fallback during transition
- Spec: `spawnMode` is a project setting, defaulted based on tmux detection
