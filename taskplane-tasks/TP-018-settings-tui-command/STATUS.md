# TP-018: /settings TUI Command — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-17
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read pi's `ctx.ui` API capabilities
- [x] Read config schema from TP-014
- [x] Review Layer 2 allowlist and preferences boundary (R001 item 2)
- [x] Review config root/path semantics in workspace mode (R001 item)
- [x] Review JSON-first + YAML fallback behavior for write-back alignment (R001 item)
- [x] Produce preflight findings: field/source inventory with UI control types + layer mapping (R001 item 3)

---

### Step 1: Design Settings Navigation
**Status:** ⬜ Not Started

- [ ] Section groupings and field types defined
- [ ] Layer 1 vs Layer 2 fields identified

---

### Step 2: Implement /settings Command
**Status:** ⬜ Not Started

- [ ] Command registered, section navigation working
- [ ] Field editing with validation
- [ ] Source indicators (project/user/default) displayed

---

### Step 3: Implement Write-Back
**Status:** ⬜ Not Started

- [ ] Layer 1 → project config, Layer 2 → user preferences
- [ ] Confirmation prompt for project config changes

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Settings load/display tested
- [ ] Write-back tested
- [ ] `cd extensions && npx vitest run`

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Commands reference updated
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
| `resolveConfigRoot` not exported from config-loader.ts | Export in Step 2/3 | config-loader.ts |
| settings-and-onboarding-spec.md not found at expected path | Non-blocking, spec content derived from code | .pi/local/docs/ |

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-17 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-17 17:23 | Task started | Extension-driven execution |
| 2026-03-17 17:23 | Step 0 started | Preflight |
| 2026-03-17 17:23 | Task started | Extension-driven execution |
| 2026-03-17 17:23 | Step 0 started | Preflight |
| 2026-03-17 17:24 | Review R001 | plan Step 0: REVISE |
| 2026-03-17 17:24 | Review R001 | plan Step 0: REVISE |

## Blockers
*None*

## Notes

### Preflight Findings (Step 0)

**Source files:**
- Config schema: `extensions/taskplane/config-schema.ts`
- Config loader: `extensions/taskplane/config-loader.ts`
- Extension entry: `extensions/taskplane/extension.ts`
- Pi TUI docs: tui.md (SettingsList, SelectList, custom components)

**ctx.ui capabilities relevant to /settings:**
- `SettingsList` — cycling through predefined values (ideal for enums/booleans)
- `SelectList` — selection from list (for section navigation)
- `ctx.ui.custom()` — full TUI with keyboard input
- `ctx.ui.input()` — free text input (for strings/numbers)
- `ctx.ui.confirm()` — yes/no (for Layer 1 write confirmation)
- `getSettingsListTheme()` — pre-built theme for SettingsList
- `DynamicBorder` — border framing

**Write-back targets:**
- Layer 1 → `resolveConfigRoot(cwd)/.pi/taskplane-config.json` (always JSON, creates if absent)
- Layer 2 → `resolveUserPreferencesPath()` (~/.pi/agent/taskplane/preferences.json)
- `resolveConfigRoot` is not exported — must export or add helper for write-back

**Config root in workspace mode:**
- `resolveConfigRoot(cwd)` checks cwd for config files first, then TASKPLANE_WORKSPACE_ROOT
- Write-back MUST use the same resolution to avoid writing to worktree instead of workspace root

**Field Inventory — TUI-Editable Fields:**

| Section | Field | Type | UI Control | Layer | Write Target |
|---------|-------|------|------------|-------|-------------|
| **Orchestrator** | maxLanes | number | input | L1 | project config |
| | worktreeLocation | enum | settings-toggle | L1 | project config |
| | worktreePrefix | string | input | L1 | project config |
| | batchIdFormat | enum | settings-toggle | L1 | project config |
| | spawnMode | enum | settings-toggle | L1+L2 | project or prefs |
| | tmuxPrefix | string | input | L1+L2 | project or prefs |
| | operatorId | string | input | L1+L2 | project or prefs |
| **Dependencies** | source | enum | settings-toggle | L1 | project config |
| | cache | boolean | settings-toggle | L1 | project config |
| **Assignment** | strategy | enum | settings-toggle | L1 | project config |
| **Merge** | model | string | input | L1+L2 | project or prefs |
| | tools | string | input | L1 | project config |
| | order | enum | settings-toggle | L1 | project config |
| **Failure** | onTaskFailure | enum | settings-toggle | L1 | project config |
| | onMergeFailure | enum | settings-toggle | L1 | project config |
| | stallTimeout | number | input | L1 | project config |
| | maxWorkerMinutes | number | input | L1 | project config |
| | abortGracePeriod | number | input | L1 | project config |
| **Monitoring** | pollInterval | number | input | L1 | project config |
| **Task Runner: Worker** | model | string | input | L1+L2 | project or prefs |
| | tools | string | input | L1 | project config |
| | thinking | string | input | L1 | project config |
| **Task Runner: Reviewer** | model | string | input | L1+L2 | project or prefs |
| | tools | string | input | L1 | project config |
| | thinking | string | input | L1 | project config |
| **Task Runner: Context** | workerContextWindow | number | input | L1 | project config |
| | warnPercent | number | input | L1 | project config |
| | killPercent | number | input | L1 | project config |
| | maxWorkerIterations | number | input | L1 | project config |
| | maxReviewCycles | number | input | L1 | project config |
| | noProgressLimit | number | input | L1 | project config |
| **User Preferences** | dashboardPort | number | input | L2 | prefs only |

**Layer 2 writable fields (allowlist):**
operatorId, tmuxPrefix, spawnMode, workerModel, reviewerModel, mergeModel, dashboardPort

**Fields NOT shown in TUI (complex/collection types — edit JSON directly):**
- taskAreas (Record), referenceDocs (Record), neverLoad (array), selfDocTargets (Record)
- protectedDocs (array), standards (docs/rules arrays), standardsOverrides (Record)
- testing.commands (Record), preWarm.commands (Record), preWarm.always (array)
- assignment.sizeWeights (Record), merge.verify (array)
- project.name, project.description, paths.tasks, paths.architecture (simple but project-identity)

**Enum value maps for settings-toggle fields:**
- worktreeLocation: ["sibling", "subdirectory"]
- batchIdFormat: ["timestamp", "sequential"]
- spawnMode: ["tmux", "subprocess"]
- dependencies.source: ["prompt", "agent"]
- assignment.strategy: ["affinity-first", "round-robin", "load-balanced"]
- merge.order: ["fewest-files-first", "sequential"]
- onTaskFailure: ["skip-dependents", "stop-wave", "stop-all"]
- onMergeFailure: ["pause", "abort"]
- cache: ["true", "false"] (boolean as toggle)
