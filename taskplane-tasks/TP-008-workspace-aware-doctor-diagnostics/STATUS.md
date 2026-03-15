# TP-008: Workspace-Aware Doctor Diagnostics and Validation — Status

**Current Step:** Step 3: Testing & Verification
**Status:** 🟨 In Progress
**Last Updated:** 2026-03-15
**Review Level:** 2
**Review Counter:** 7
**Iteration:** 4
**Size:** M

> **Hydration:** Checkboxes below must be granular — one per unit of work.
> Steps marked `⚠️ Hydrate` will be expanded by the worker.

---

### Step 0: Detect workspace mode in doctor
**Status:** ✅ Complete

#### Mode detection behavior
- **No config file** (`.pi/taskplane-workspace.yaml` absent) → repo mode. All existing doctor checks unchanged.
- **Config file present + valid** → workspace mode. Doctor branches into workspace-specific output section.
- **Config file present + invalid** → workspace mode (degraded). Doctor reports the config error as FAIL with actionable hint but continues remaining common checks.

#### Non-git workspace root rule
In workspace mode, the workspace root (`cwd`) is intentionally non-git. The existing "git installed" prerequisite check remains (git is still required), but no check should verify `cwd` itself is a git repo. Git-repo checks apply only to configured repos in Step 1.

#### Doctor check matrix (Step 0 scope)
| Check | Repo Mode | Workspace Mode |
|-------|-----------|----------------|
| pi installed | ✅ common | ✅ common |
| Node.js >= 20 | ✅ common | ✅ common |
| git installed | ✅ common | ✅ common |
| tmux installed (optional) | ✅ common | ✅ common |
| taskplane package installed | ✅ common | ✅ common |
| project config files | ✅ common | ✅ common |
| task areas from config | ✅ common | ✅ common |
| workspace mode banner + config summary | ❌ skip | ✅ workspace only |
| workspace config load error | ❌ skip | ✅ workspace only (FAIL) |

#### Implementation checklist
- [x] Add `loadWorkspaceConfigForDoctor()` helper in `bin/taskplane.mjs` that detects workspace config presence, reads/parses YAML, and returns `{ mode, config, error }` without throwing
- [x] Add workspace mode banner in `cmdDoctor()` after prerequisites, showing mode and config summary (repo count, default repo, tasks root)
- [x] Branch diagnostics: when workspace mode is active, skip any future git-on-cwd checks (currently none exist, but guard placement matters)
- [x] Handle config-present-but-invalid: report the specific error as FAIL with remediation hint, increment `issues`, continue remaining checks
- [x] Verify repo mode output is byte-identical (no visible changes when no workspace config exists)

#### Step 0 verification plan
- [x] Repo mode baseline: run `node bin/taskplane.mjs doctor` in a project without `.pi/taskplane-workspace.yaml` — output must be unchanged
- [x] Workspace mode detection: create a valid `.pi/taskplane-workspace.yaml` and verify doctor shows workspace mode banner with repo summary
- [x] Invalid workspace config: create a malformed `.pi/taskplane-workspace.yaml` and verify doctor reports FAIL with error code and hint

---

### Step 1: Validate repo and routing topology
**Status:** ✅ Complete

#### Step 1 gating rules
| Condition | Step 1 behavior |
|-----------|----------------|
| Repo mode (no workspace config) | Step 1 skipped entirely — no repo topology to validate |
| Workspace mode + valid config (`wsResult.config` non-null) | Step 1 runs: repo checks + routing checks |
| Workspace mode + invalid config (`wsResult.error` non-null) | Step 1 skipped — config error already reported as FAIL in Step 0 banner |

#### Repo path validation behavior
- Iterate `Object.keys(wsResult.config.repos).sort()` (deterministic, matches workspace.ts key order).
- For each repo: resolve path relative to `projectRoot` using `path.resolve(projectRoot, repo.path)`.
- **Existence check:** `fs.existsSync(resolvedPath)` → FAIL if missing with code `WORKSPACE_REPO_PATH_NOT_FOUND`.
- **Git check:** `git rev-parse --git-dir` executed in `resolvedPath` → FAIL if non-zero exit with code `WORKSPACE_REPO_NOT_GIT`.
- Subdirectory-of-repo paths do NOT fail — the lightweight doctor check validates only that the path is a git repo (not necessarily the root). The full root-vs-subdirectory check is the orchestrator's responsibility.
- Each failed repo increments `issues` count.

#### Routing-target validation behavior
- **`routing.default_repo`:** Already validated in `loadWorkspaceConfigForDoctor()` (Step 0). No additional check needed in Step 1.
- **Area `repo_id` values:** Extend `discoverTaskAreaMetadata()` to also extract `repo_id` fields from `task-runner.yaml`. For each area that declares a `repo_id`, validate it references a key in `wsResult.config.repos`. FAIL if unknown with code `AREA_REPO_ID_UNKNOWN`.
- **`routing.tasks_root`:** Existence already checked in Step 0 loader. Step 1 adds no additional check.

#### Doctor output shape (Step 1 section)
When Step 1 runs, emit a new "Workspace repos" section after the workspace banner:
```
  ✅ repo: api (C:\path\to\api-repo)
  ✅ repo: frontend (C:\path\to\frontend-repo)
  ❌ repo: backend — path not found: C:\path\to\backend-repo
     → Check repos.backend.path in .pi/taskplane-workspace.yaml
  ❌ repo: shared — not a git repository: C:\path\to\shared
     → Initialize git in the directory or fix repos.shared.path
```

For area routing errors:
```
  ❌ area 'mobile-tasks' repo_id 'mobile' does not match any workspace repo
     → Available repos: api, frontend. Fix repo_id in .pi/task-runner.yaml
```

#### Implementation checklist
- [x] Extend `discoverTaskAreaMetadata()` to extract `repo_id` per area from task-runner.yaml
- [x] Add repo-path validation block in `cmdDoctor()` after workspace banner (gated on workspace mode + valid config)
- [x] Add area `repo_id` routing validation in `cmdDoctor()` after repo checks
- [x] Verify repo mode output is unchanged (no visible changes when no workspace config exists)

#### Step 1 verification plan
- [x] Repo mode baseline: run `node bin/taskplane.mjs doctor` without workspace config — output unchanged
- [x] Valid workspace + all repos exist and are git repos → all repo checks pass
- [x] Repo path missing on disk → FAIL with actionable hint
- [x] Repo path exists but not git → FAIL with hint
- [x] Area `repo_id` references unknown repo → FAIL with hint listing available repos
- [x] Area with no `repo_id` → no error (falls through to default_repo at runtime)

---

### Step 2: Improve operator guidance
**Status:** ✅ Complete

#### Diagnostics → Hint coverage table
All workspace-mode failures must include: (a) error code on the status line, (b) `→` remediation hint on the next line with specific file/key reference.

| Diagnostic | Code | Remediation hint |
|-----------|------|-------------------|
| Workspace config invalid (all schema errors) | varies per error | `→ Fix .pi/taskplane-workspace.yaml or remove it to use repo mode` |
| Repo path not found | `WORKSPACE_REPO_PATH_NOT_FOUND` | `→ Check repos.<id>.path in .pi/taskplane-workspace.yaml` |
| Repo not a git repo | `WORKSPACE_REPO_NOT_GIT` | `→ Run: git init <path> or fix repos.<id>.path in .pi/taskplane-workspace.yaml` |
| Area repo_id unknown | `AREA_REPO_ID_UNKNOWN` | `→ Available repos: <sorted list>. Fix repo_id in .pi/task-runner.yaml` |
| Task area path missing | (no code — common check) | `→ Run: mkdir -p <path>` |
| Config file missing (required) | (no code — common check) | `→ Run: taskplane init` |

#### R004 false-positive fix (repo_id trim alignment)
Align `discoverTaskAreaMetadata()` with orchestrator `config.ts:93` behavior: only store `repo_id` when the trimmed value is non-empty (truthy). This prevents whitespace-only `repo_id: " "` from producing a spurious `AREA_REPO_ID_UNKNOWN` failure.

#### Repo-mode regression guard
Repo mode output must remain unchanged. Verification: run `node bin/taskplane.mjs doctor` without `.pi/taskplane-workspace.yaml` and confirm common checks are byte-identical.

#### Implementation checklist
- [x] Fix `discoverTaskAreaMetadata()` to skip empty/whitespace-only `repo_id` values (R004)
- [x] Sort `knownRepoIds` in area `repo_id` hint for deterministic output
- [x] Add `→ Run: taskplane init` hint for missing required config files
- [x] Standardize `WORKSPACE_REPO_NOT_GIT` hint to include both `git init` and config fix options
- [x] Verify repo-mode output is unchanged (no visible changes when no workspace config exists)
- [x] Verify all workspace-mode failure hints match coverage table

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

- [x] Unit/regression tests passing (full suite: 4 pre-existing failures unrelated to TP-008 confirmed via git stash comparison; 5 test files pass)
- [x] Targeted tests for changed modules passing (workspace-config: 108 pass, discovery-routing: included, execution-path-resolution: 30 pass, worktree-lifecycle: 1 pass)
- [x] All failures fixed (no TP-008-introduced failures; all 4 failing suites fail identically on main branch)
- [x] CLI smoke checks passing (`help` ✅, `doctor` in workspace mode ✅, `doctor` in repo mode ✅ — no regression)

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
| R005 | plan | Step 2 | UNKNOWN | .reviews/R005-plan-step2.md |
| R004 | code | Step 1 | UNKNOWN | .reviews/R004-code-step1.md |
| R006 | code | Step 2 | UNKNOWN | .reviews/R006-code-step2.md |
| R006 | code | Step 2 | UNKNOWN | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | UNKNOWN | .reviews/R007-plan-step3.md |
| R007 | plan | Step 3 | UNKNOWN | .reviews/R007-plan-step3.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| `polyrepo-execution-backlog.md` referenced in PROMPT but does not exist in this worktree | Non-blocking — doc update in Step 4 will be skipped for this file | PROMPT.md Context |
| `lane-agent-design.md` referenced in PROMPT but does not exist in this worktree | Non-blocking — only loaded if needed | PROMPT.md Context |
| 4 test files (orch-pure-functions, orch-state-persistence, task-runner-orchestration, orch-direct-implementation) fail on main branch due to task-orchestrator.ts being refactored to a thin facade; tests still look for functions/patterns in the facade file | Pre-existing — not caused by TP-008; tech debt for separate fix | extensions/tests/ |

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-15 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-15 08:07 | Task started | Extension-driven execution |
| 2026-03-15 08:07 | Step 0 started | Detect workspace mode in doctor |
| 2026-03-15 08:10 | Review R001 | plan Step 0: Changes requested |
| 2026-03-15 | Step 0 plan hydrated | Addressed R001 findings: mode detection behavior, check matrix, non-git rule, verification plan |
| 2026-03-15 | Step 0 implemented | loadWorkspaceConfigForDoctor + parseWorkspaceYaml added, cmdDoctor workspace branch, all 3 verification scenarios passed |
| 2026-03-15 | Step 0 complete | All implementation and verification items checked off |
| 2026-03-15 08:22 | Worker iter 1 | done in 749s, ctx: 40%, tools: 86 |
| 2026-03-15 08:24 | Worker iter 1 | done in 841s, ctx: 50%, tools: 120 |
| 2026-03-15 08:25 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-15 08:25 | Step 0 complete | Detect workspace mode in doctor |
| 2026-03-15 08:25 | Step 1 started | Validate repo and routing topology |
| 2026-03-15 08:27 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-15 08:27 | Step 0 complete | Detect workspace mode in doctor |
| 2026-03-15 08:27 | Step 1 started | Validate repo and routing topology |
| 2026-03-15 08:27 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-15 | Step 1 plan hydrated | Addressed R003: gating matrix, validation behavior, output shape, implementation checklist, verification plan |
| 2026-03-15 | Step 1 implemented | discoverTaskAreaMetadata extended for repo_id, cmdDoctor repo topology validation + area routing validation added |
| 2026-03-15 | Step 1 verified | All 6 verification scenarios passed, repo mode baseline unchanged, all workspace/routing tests pass |
| 2026-03-15 | Step 1 complete | Validate repo and routing topology |
| 2026-03-15 08:29 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-15 08:33 | Worker iter 2 | done in 338s, ctx: 29%, tools: 47 |
| 2026-03-15 08:34 | Review R004 | code Step 1: UNKNOWN |
| 2026-03-15 08:34 | Step 1 complete | Validate repo and routing topology |
| 2026-03-15 08:34 | Step 2 started | Improve operator guidance |
| 2026-03-15 08:35 | Worker iter 2 | done in 371s, ctx: 26%, tools: 51 |
| 2026-03-15 08:35 | Review R005 | plan Step 2: UNKNOWN |
| 2026-03-15 | Step 2 plan hydrated | Diagnostics coverage table, R004 fix scope, repo-mode regression guard, implementation checklist |
| 2026-03-15 | Step 2 implemented | R004 false-positive fix, sorted knownRepoIds, config file missing hint, WORKSPACE_REPO_NOT_GIT improved hint |
| 2026-03-15 | Step 2 verified | Repo-mode baseline confirmed (common checks unchanged when all pass), workspace-mode hints match coverage table, whitespace repo_id ignored |
| 2026-03-15 | Step 2 complete | Improve operator guidance |
| 2026-03-15 08:38 | Review R004 | code Step 1: UNKNOWN |
| 2026-03-15 08:38 | Step 1 complete | Validate repo and routing topology |
| 2026-03-15 08:38 | Step 2 started | Improve operator guidance |
| 2026-03-15 08:40 | Worker iter 3 | done in 302s, ctx: 26%, tools: 38 |
| 2026-03-15 08:41 | Worker iter 3 | done in 131s, ctx: 20%, tools: 24 |
| 2026-03-15 08:43 | Review R006 | code Step 2: UNKNOWN |
| 2026-03-15 08:43 | Step 2 complete | Improve operator guidance |
| 2026-03-15 08:43 | Step 3 started | Testing & Verification |
| 2026-03-15 08:44 | Review R006 | code Step 2: UNKNOWN |
| 2026-03-15 08:44 | Step 2 complete | Improve operator guidance |
| 2026-03-15 08:44 | Step 3 started | Testing & Verification |
| 2026-03-15 08:46 | Review R007 | plan Step 3: UNKNOWN |
| 2026-03-15 | Step 3 executed | Full suite: 4 pre-existing failures (confirmed via stash), 5 pass; targeted: 139 assertions pass; CLI smoke: help + doctor (workspace + repo mode) all pass |
| 2026-03-15 | Step 3 complete | Testing & Verification — no TP-008-introduced regressions |
| 2026-03-15 08:47 | Review R007 | plan Step 3: UNKNOWN |

## Blockers

*None*

## Notes

*Reserved for execution notes*
