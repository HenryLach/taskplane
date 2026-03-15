# TP-008: Workspace-Aware Doctor Diagnostics and Validation — Status

**Current Step:** Step 1: Validate repo and routing topology
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-15
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
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
**Status:** ⬜ Not Started

- [ ] Check each configured repo path exists and is a git repo
- [ ] Validate area/default routing targets reference known repos

---

### Step 2: Improve operator guidance
**Status:** ⬜ Not Started

- [ ] Emit actionable remediation hints for missing repos/mappings
- [ ] Keep existing repo-mode doctor output unchanged

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
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| `polyrepo-execution-backlog.md` referenced in PROMPT but does not exist in this worktree | Non-blocking — doc update in Step 4 will be skipped for this file | PROMPT.md Context |
| `lane-agent-design.md` referenced in PROMPT but does not exist in this worktree | Non-blocking — only loaded if needed | PROMPT.md Context |

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

## Blockers

*None*

## Notes

*Reserved for execution notes*
