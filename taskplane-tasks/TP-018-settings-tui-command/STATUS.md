# TP-018: /settings TUI Command — Status

**Current Step:** Step 1: Design Settings Navigation
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

- [x] Read pi's `ctx.ui` API capabilities
- [x] Read config schema from TP-014
- [x] Review Layer 2 allowlist and preferences boundary (R001 item 2)
- [x] Review config root/path semantics in workspace mode (R001 item)
- [x] Review JSON-first + YAML fallback behavior for write-back alignment (R001 item)
- [x] Produce preflight findings: field/source inventory with UI control types + layer mapping (R001 item 3)
- [x] R002: Record CONTEXT.md review in preflight and add missing fields (worker.spawnMode, context.maxWorkerMinutes, preWarm.autoDetect) to inventory with explicit categorizations

---

### Step 1: Design Settings Navigation
**Status:** 🟨 In Progress

- [x] Final section taxonomy, ordering, and field-to-section assignment documented in STATUS.md
- [ ] Source-indicator behavior rules for project/user/default (including dual-layer L1+L2 fields) documented
- [ ] Schema coverage validation: every scalar field in config-schema.ts is either in navigation map or explicitly excluded with rationale

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
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
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
| 2026-03-17 17:28 | Worker iter 1 | done in 235s, ctx: 31%, tools: 42 |
| 2026-03-17 17:29 | Worker iter 1 | done in 254s, ctx: 33%, tools: 42 |
| 2026-03-17 17:30 | Review R002 | code Step 0: REVISE |
| 2026-03-17 17:30 | Review R002 | code Step 0: REVISE |
| 2026-03-17 17:32 | Worker iter 1 | done in 128s, ctx: 13%, tools: 20 |
| 2026-03-17 17:32 | Step 0 complete | Preflight |
| 2026-03-17 17:32 | Step 1 started | Design Settings Navigation |
| 2026-03-17 17:33 | Worker iter 1 | done in 171s, ctx: 15%, tools: 27 |
| 2026-03-17 17:33 | Step 0 complete | Preflight |
| 2026-03-17 17:33 | Step 1 started | Design Settings Navigation |
| 2026-03-17 17:34 | Review R003 | plan Step 1: REVISE |
| 2026-03-17 17:35 | Review R003 | plan Step 1: REVISE |

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
| **Pre-Warm** | autoDetect | boolean | settings-toggle | L1 | project config |
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
| | spawnMode | enum (optional) | settings-toggle | L1+L2 | project or prefs |
| **Task Runner: Reviewer** | model | string | input | L1+L2 | project or prefs |
| | tools | string | input | L1 | project config |
| | thinking | string | input | L1 | project config |
| **Task Runner: Context** | workerContextWindow | number | input | L1 | project config |
| | warnPercent | number | input | L1 | project config |
| | killPercent | number | input | L1 | project config |
| | maxWorkerIterations | number | input | L1 | project config |
| | maxReviewCycles | number | input | L1 | project config |
| | noProgressLimit | number | input | L1 | project config |
| | maxWorkerMinutes | number (optional) | input | L1 | project config |
| **User Preferences** | dashboardPort | number | input | L2 | prefs only |

**Layer 2 writable fields (allowlist):**
operatorId, tmuxPrefix, spawnMode, workerModel, reviewerModel, mergeModel, dashboardPort

**CONTEXT.md Review (R002 item 2):**
- Reviewed `taskplane-tasks/CONTEXT.md` — confirms key files map, no additional constraints beyond what AGENTS.md provides. No impact on /settings design beyond confirming config paths (`.pi/task-runner.yaml`, `.pi/task-orchestrator.yaml`) and extension location (`extensions/taskplane/`).

**Missing Fields Added (R002 item 1):**

| Section | Field | Type | UI Control | Layer | Write Target | Status |
|---------|-------|------|------------|-------|-------------|--------|
| **Task Runner: Worker** | spawnMode | enum (optional) | settings-toggle | L1+L2 | project or prefs | NEW — maps to same L2 allowlist as orchestrator.spawnMode |
| **Task Runner: Context** | maxWorkerMinutes | number (optional) | input | L1 | project config | NEW — was missing |
| **Pre-Warm** | autoDetect | boolean | settings-toggle | L1 | project config | NEW — was missing |

**Schema Coverage Checklist — All Scalar/Enum/Boolean Fields:**

✅ = editable in TUI, 🏠 = prefs-only (L2), 🚫 = intentionally hidden

*Orchestrator Core:*
- ✅ maxLanes, worktreeLocation, worktreePrefix, batchIdFormat, spawnMode, tmuxPrefix, operatorId

*Dependencies:*
- ✅ source, cache

*Assignment:*
- ✅ strategy
- 🚫 sizeWeights (Record — edit JSON directly)

*Pre-Warm:*
- ✅ autoDetect
- 🚫 commands (Record), always (array) — edit JSON directly

*Merge:*
- ✅ model, tools, order
- 🚫 verify (array) — edit JSON directly

*Failure:*
- ✅ onTaskFailure, onMergeFailure, stallTimeout, maxWorkerMinutes, abortGracePeriod

*Monitoring:*
- ✅ pollInterval

*Task Runner Worker:*
- ✅ model, tools, thinking, spawnMode

*Task Runner Reviewer:*
- ✅ model, tools, thinking

*Task Runner Context:*
- ✅ workerContextWindow, warnPercent, killPercent, maxWorkerIterations, maxReviewCycles, noProgressLimit, maxWorkerMinutes

*Task Runner Project:*
- 🚫 name, description — project identity fields, edit JSON directly

*Task Runner Paths:*
- 🚫 tasks, architecture — project structure, edit JSON directly

*Task Runner Collections (all 🚫 — edit JSON directly):*
- testing.commands, standards.docs, standards.rules, standardsOverrides, taskAreas, referenceDocs, neverLoad, selfDocTargets, protectedDocs

*User Preferences (🏠):*
- 🏠 dashboardPort

**Enum value maps for settings-toggle fields:**
- worktreeLocation: ["sibling", "subdirectory"]
- batchIdFormat: ["timestamp", "sequential"]
- spawnMode: ["tmux", "subprocess"] (both orchestrator.orchestrator.spawnMode AND worker.spawnMode)
- dependencies.source: ["prompt", "agent"]
- assignment.strategy: ["affinity-first", "round-robin", "load-balanced"]
- merge.order: ["fewest-files-first", "sequential"]
- onTaskFailure: ["skip-dependents", "stop-wave", "stop-all"]
- onMergeFailure: ["pause", "abort"]
- cache: ["true", "false"] (boolean as toggle)
- worker.spawnMode: ["subprocess", "tmux"] (optional — when unset, inherits orchestrator.spawnMode)
- preWarm.autoDetect: ["true", "false"] (boolean as toggle)

**CONTEXT.md Review (R002 item 2):**
Reviewed `taskplane-tasks/CONTEXT.md` — confirms key file paths (extensions/taskplane/, .pi/ configs, tests), no additional constraints beyond what AGENTS.md and PROMPT.md specify. Task area is "General" (default). No special testing or config notes that affect /settings TUI design.

### Step 1 Design Decisions

#### Section Taxonomy and Menu Order

The TUI top-level menu presents these sections in order. Each section maps to a config schema path and contains only scalar/enum/boolean fields suitable for TUI editing.

| # | Menu Section | Config Path | Fields |
|---|-------------|-------------|--------|
| 1 | **Orchestrator** | `orchestrator.orchestrator` | maxLanes, worktreeLocation, worktreePrefix, batchIdFormat, spawnMode, tmuxPrefix, operatorId |
| 2 | **Dependencies** | `orchestrator.dependencies` | source, cache |
| 3 | **Assignment** | `orchestrator.assignment` | strategy |
| 4 | **Pre-Warm** | `orchestrator.preWarm` | autoDetect |
| 5 | **Merge** | `orchestrator.merge` | model, tools, order |
| 6 | **Failure Policy** | `orchestrator.failure` | onTaskFailure, onMergeFailure, stallTimeout, maxWorkerMinutes, abortGracePeriod |
| 7 | **Monitoring** | `orchestrator.monitoring` | pollInterval |
| 8 | **Worker** | `taskRunner.worker` | model, tools, thinking, spawnMode |
| 9 | **Reviewer** | `taskRunner.reviewer` | model, tools, thinking |
| 10 | **Context Limits** | `taskRunner.context` | workerContextWindow, warnPercent, killPercent, maxWorkerIterations, maxReviewCycles, noProgressLimit, maxWorkerMinutes |
| 11 | **User Preferences** | `(preferences only)` | dashboardPort |

**Rationale for ordering:** Orchestrator settings first (most commonly tuned), then task-runner subsections, then user preferences at the end. This mirrors the config file structure and groups by concern.

**Excluded from TUI navigation (intentionally — complex/collection types, edit JSON directly):**
- `taskRunner.project` (name, description) — project identity
- `taskRunner.paths` (tasks, architecture) — project structure
- `taskRunner.testing.commands` — Record<string, string>
- `taskRunner.standards` (docs, rules) — string arrays
- `taskRunner.standardsOverrides` — Record<string, StandardsOverride>
- `taskRunner.taskAreas` — Record<string, TaskAreaConfig>
- `taskRunner.referenceDocs` — Record<string, string>
- `taskRunner.neverLoad` — string[]
- `taskRunner.selfDocTargets` — Record<string, string>
- `taskRunner.protectedDocs` — string[]
- `orchestrator.assignment.sizeWeights` — Record<string, number>
- `orchestrator.preWarm.commands` — Record<string, string>
- `orchestrator.preWarm.always` — string[]
- `orchestrator.merge.verify` — string[]
- `configVersion` — read-only, not user-editable

#### Field-to-UI-Control Mapping

| UI Control | Fields |
|-----------|--------|
| **SettingsList toggle** (cycle through values) | worktreeLocation, batchIdFormat, spawnMode (orch), source, cache, autoDetect, strategy, order, onTaskFailure, onMergeFailure, spawnMode (worker) |
| **ctx.ui.input()** (free text/number) | maxLanes, worktreePrefix, tmuxPrefix, operatorId, model (merge/worker/reviewer), tools (merge/worker/reviewer), thinking (worker/reviewer), stallTimeout, maxWorkerMinutes (failure), abortGracePeriod, pollInterval, workerContextWindow, warnPercent, killPercent, maxWorkerIterations, maxReviewCycles, noProgressLimit, maxWorkerMinutes (context), dashboardPort |

**Design decision:** Use a **two-level navigation** pattern:
1. Top-level: SelectList of sections (11 items)
2. Per-section: SettingsList showing all fields in that section, with enum fields as toggles and string/number fields using ctx.ui.input() for editing

**Keybindings:**
- ↑↓ navigate sections/fields
- Enter: select section / enter edit mode for input fields
- ←→ or Space: cycle toggle values (SettingsList built-in)
- Esc: back to section list / exit settings
- `/` or search: filter fields (SettingsList built-in search)

#### Source-Indicator Behavior

Each field displays a **source label** showing where its current value comes from:

| Source Label | Meaning | Display |
|-------------|---------|---------|
| `(default)` | No override in any config file; using schema default | dim/muted text |
| `(project)` | Value set in `.pi/taskplane-config.json` (or YAML fallback) | normal text |
| `(user)` | Value set in `~/.pi/agent/taskplane/preferences.json` | accent text |

**Rules for dual-layer (L1+L2) fields:**
These fields can be set in either project config or user preferences. The effective value uses Layer 2 merge semantics from TP-017:

1. If the user preference is set (non-undefined), show the **user preference value** with `(user)` label
2. If user preference is undefined but project config has a value, show the **project config value** with `(project)` label
3. If neither is set, show the **default value** with `(default)` label

**Edit destination for L1+L2 fields:**
When the user edits an L1+L2 field, the TUI offers a choice:
- **"Save to user preferences"** — writes to `~/.pi/agent/taskplane/preferences.json` (affects only this user)
- **"Save to project config"** — writes to `.pi/taskplane-config.json` (shared, requires confirmation)

For **L1-only fields**, edits always go to project config (with confirmation).
For **L2-only fields** (dashboardPort), edits always go to user preferences (no confirmation needed).

**Source detection logic:**
To determine source, the TUI reads both raw config files (before merge) and compares:
1. Load raw project config JSON (or YAML) — fields present here are `(project)` sourced
2. Load raw user preferences JSON — fields present here are `(user)` sourced
3. Fields not in either file are `(default)` sourced
4. For L1+L2 fields: if both project AND user have a value, the effective value is from user (L2 wins), but both sources exist — show `(user)` as the active source

**Schema Coverage Checklist (R002 item 1):**
All scalar/enum/boolean fields in config-schema.ts categorized:

✅ **Editable in TUI** (36 fields):
- orchestrator.orchestrator: maxLanes, worktreeLocation, worktreePrefix, batchIdFormat, spawnMode, tmuxPrefix, operatorId (7)
- orchestrator.dependencies: source, cache (2)
- orchestrator.assignment: strategy (1)
- orchestrator.preWarm: autoDetect (1)
- orchestrator.merge: model, tools, order (3)
- orchestrator.failure: onTaskFailure, onMergeFailure, stallTimeout, maxWorkerMinutes, abortGracePeriod (5)
- orchestrator.monitoring: pollInterval (1)
- taskRunner.worker: model, tools, thinking, spawnMode (4)
- taskRunner.reviewer: model, tools, thinking (3)
- taskRunner.context: workerContextWindow, warnPercent, killPercent, maxWorkerIterations, maxReviewCycles, noProgressLimit, maxWorkerMinutes (7)
- User preferences-only: dashboardPort (1)
- configVersion: (read-only display, not editable) (1 — excluded from editable count)

🚫 **Intentionally excluded** (complex/collection types — edit JSON directly):
- taskRunner.project: name, description (project identity — dangerous to change casually)
- taskRunner.paths: tasks, architecture (project identity)
- taskRunner.testing.commands (Record<string, string>)
- taskRunner.standards: docs, rules (arrays)
- taskRunner.standardsOverrides (Record<string, StandardsOverride>)
- taskRunner.taskAreas (Record<string, TaskAreaConfig>)
- taskRunner.referenceDocs (Record<string, string>)
- taskRunner.neverLoad (string[])
- taskRunner.selfDocTargets (Record<string, string>)
- taskRunner.protectedDocs (string[])
- orchestrator.assignment.sizeWeights (Record<string, number>)
- orchestrator.preWarm.commands (Record<string, string>)
- orchestrator.preWarm.always (string[])
- orchestrator.merge.verify (string[])

Rationale for exclusions: Collection/Record types don't map cleanly to single-value TUI controls. Project identity fields (name, description, paths) are rarely changed and risky to edit casually. All excluded fields can be edited directly in taskplane-config.json.
