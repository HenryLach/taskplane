# TP-015: Init v2: Mode Detection, Gitignore, and Artifact Cleanup — Status

**Current Step:** Step 1: Mode Auto-Detection
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-17
**Review Level:** 2
**Review Counter:** 3
**Iteration:** 2
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
**Status:** 🟨 In Progress

- [x] Detection logic implemented (git repo check, subdirectory git repo scan, mode determination)
- [x] Error path: no git repo and no git repo subdirectories → clear error message and exit
- [ ] Ambiguous case handled with prompt; preset/non-interactive mode defaults to repo mode (no prompt)
- [ ] "Already initialized" detection for Scenario B (existing config check before topology detection)
- [ ] Validate: repo mode, workspace mode, ambiguous prompt, no-repo error, preset bypass all covered

---

### Step 2: Gitignore Enforcement
**Status:** ⬜ Not Started

- [ ] Selective gitignore entries added during init
- [ ] Tracked artifact detection and `git rm --cached` offer

---

### Step 3: tmux and Environment Detection
**Status:** ⬜ Not Started

- [ ] tmux detection with spawn_mode defaulting
- [ ] Guidance message when tmux not found

---

### Step 4: Workspace Mode Init (Scenario C)
**Status:** ⬜ Not Started

- [ ] Config repo selection and `.taskplane/` creation
- [ ] Pointer file creation in workspace root
- [ ] Post-init merge guidance displayed

---

### Step 5: Workspace Join (Scenario D)
**Status:** ⬜ Not Started

- [ ] Existing `.taskplane/` discovery
- [ ] Pointer-only creation

---

### Step 6: Testing & Verification
**Status:** ⬜ Not Started

- [ ] All four scenarios verified with `--dry-run`
- [ ] Mode detection edge cases tested

---

### Step 7: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Install tutorial updated
- [ ] `.DONE` created
- [ ] Archive and push

---

## Reviews
| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Spec not in worktree — `.pi/local/` is gitignored. Canonical source: `C:\dev\taskplane\.pi\local\docs\settings-and-onboarding-spec.md` (main repo). Read successfully from there. | Noted | Step 0 |
| TP-014 contract verified: JSON filename=`taskplane-config.json`, configVersion=1, shape=`{configVersion,taskRunner,orchestrator}`. Loader: `loadProjectConfig()` in `config-loader.ts`. JSON-first, YAML fallback. spawnMode at `orchestrator.orchestrator.spawnMode`. PROMPT says keep YAML generation until JSON is validated. | Noted | Step 0 |
| No existing init-specific tests. Downstream validation: `project-config-loader.test.ts` (39 tests), CLI smoke `node bin/taskplane.mjs help`, `taskplane init --dry-run --force`. Step 6 should add init-specific tests. | Noted | Step 0 |

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
