# TP-018: /settings TUI Command — Status

**Current Step:** Step 1: Design Settings Navigation
**Status:** ✅ Complete
**Last Updated:** 2026-03-17
**Review Level:** 2
**Review Counter:** 4
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
**Status:** ✅ Complete

- [x] Final section taxonomy, ordering, and field-to-section assignment documented in STATUS.md
- [x] Source-indicator behavior rules for project/user/default (including dual-layer L1+L2 fields) documented
- [x] Schema coverage validation: every scalar field in config-schema.ts is either in navigation map or explicitly excluded with rationale
- [x] R003 fix: worker.spawnMode corrected to L1-only, non-editable field surfacing defined, field contract table with source/clear semantics added
- [x] R004 fix: Consolidate canonical navigation map (12 sections including Advanced), fix all references to section count
- [ ] R004 fix: Align source-badge rules with actual merge semantics — string prefs require non-empty, enum prefs require defined, add empty-string edge case examples

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
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
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
| 2026-03-17 17:37 | Worker iter 2 | done in 151s, ctx: 18%, tools: 21 |
| 2026-03-17 17:39 | Review R004 | code Step 1: REVISE |
| 2026-03-17 17:40 | Worker iter 2 | done in 281s, ctx: 29%, tools: 40 |

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
| | spawnMode | enum (optional) | settings-toggle | L1 | project config (R003 fix: not in L2 allowlist) |
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
| **Task Runner: Worker** | spawnMode | enum (optional) | settings-toggle | L1 | project config | NEW — R003 corrected: NOT in L2 allowlist (L2 spawnMode only maps to orchestrator.orchestrator.spawnMode) |
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
- worker.spawnMode: ["(inherit)", "subprocess", "tmux"] (optional L1-only — when unset/"(inherit)", inherits orchestrator.spawnMode)
- preWarm.autoDetect: ["true", "false"] (boolean as toggle)

**CONTEXT.md Review (R002 item 2):**
Reviewed `taskplane-tasks/CONTEXT.md` — confirms key file paths (extensions/taskplane/, .pi/ configs, tests), no additional constraints beyond what AGENTS.md and PROMPT.md specify. Task area is "General" (default). No special testing or config notes that affect /settings TUI design.

### Step 1 Design Decisions

#### Canonical Navigation Map (single source of truth)

The TUI top-level menu presents **12 sections** in this exact order. Sections 1–10 contain editable scalar/enum/boolean fields. Section 11 is user-preferences-only. Section 12 aggregates all non-editable collection/Record/array fields for discoverability.

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
| 12 | **Advanced (JSON Only)** | `(aggregated)` | Read-only listing of all collection/Record/array fields |

**Rationale for ordering:** Orchestrator settings first (most commonly tuned), then task-runner subsections, then user preferences, then Advanced at the end for discoverability. This mirrors the config file structure and groups by concern.

**Fields shown in Advanced (JSON Only) section — visible, not editable (R003 item 3):**
- `configVersion` — read-only informational
- `taskRunner.project.name` — project identity
- `taskRunner.project.description` — project identity
- `taskRunner.paths.tasks` — project structure path
- `taskRunner.paths.architecture` — project structure path (optional)
- `taskRunner.testing.commands` — Record<string, string>
- `taskRunner.standards.docs` — string[]
- `taskRunner.standards.rules` — string[]
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

Each entry shows its current value (summarized — e.g. "3 entries" for Records, first items for arrays) and instructs "Edit in .pi/taskplane-config.json".

#### Field-to-UI-Control Mapping

| UI Control | Fields |
|-----------|--------|
| **SettingsList toggle** (cycle through values) | worktreeLocation, batchIdFormat, spawnMode (orch), source, cache, autoDetect, strategy, order, onTaskFailure, onMergeFailure, spawnMode (worker) |
| **ctx.ui.input()** (free text/number) | maxLanes, worktreePrefix, tmuxPrefix, operatorId, model (merge/worker/reviewer), tools (merge/worker/reviewer), thinking (worker/reviewer), stallTimeout, maxWorkerMinutes (failure), abortGracePeriod, pollInterval, workerContextWindow, warnPercent, killPercent, maxWorkerIterations, maxReviewCycles, noProgressLimit, maxWorkerMinutes (context), dashboardPort |

**Design decision:** Use a **two-level navigation** pattern:
1. Top-level: SelectList of **12 sections** (see Canonical Navigation Map above)
2. Per-section: SettingsList showing all fields in that section, with enum fields as toggles and string/number fields using ctx.ui.input() for editing. Section 12 (Advanced) uses read-only display only.

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

**Schema Coverage Checklist (R002 item 1) — REVISED per R003:**

All scalar/enum/boolean fields in config-schema.ts categorized. **R003 fix:** `taskRunner.worker.spawnMode` corrected to L1 only (not in L2 allowlist).

✅ **Editable in TUI** (36 fields):
- orchestrator.orchestrator: maxLanes, worktreeLocation, worktreePrefix, batchIdFormat, spawnMode (L1+L2), tmuxPrefix (L1+L2), operatorId (L1+L2) — 7 fields
- orchestrator.dependencies: source, cache — 2 fields (L1 only)
- orchestrator.assignment: strategy — 1 field (L1 only)
- orchestrator.preWarm: autoDetect — 1 field (L1 only)
- orchestrator.merge: model (L1+L2), tools, order — 3 fields
- orchestrator.failure: onTaskFailure, onMergeFailure, stallTimeout, maxWorkerMinutes, abortGracePeriod — 5 fields (L1 only)
- orchestrator.monitoring: pollInterval — 1 field (L1 only)
- taskRunner.worker: model (L1+L2), tools, thinking, spawnMode — 4 fields (**spawnMode is L1 only — corrected from L1+L2**)
- taskRunner.reviewer: model (L1+L2), tools, thinking — 3 fields
- taskRunner.context: workerContextWindow, warnPercent, killPercent, maxWorkerIterations, maxReviewCycles, noProgressLimit, maxWorkerMinutes — 7 fields (L1 only)
- User preferences-only: dashboardPort — 1 field (L2 only)

📖 **Read-only / informational** (visible but not editable):
- configVersion — displayed at top of settings view as "Config Version: 1"

🔧 **JSON-only fields** (visible in section footer, not editable — R003 item 3):
Each section that has excluded fields shows a footer note: "N additional fields (edit JSON directly): field1, field2..."
- taskRunner.project: name, description — shown in a "Project" read-only section header
- taskRunner.paths: tasks, architecture — shown in "Project" read-only section
- taskRunner.testing.commands — footer in hypothetical "Testing" section (or standalone note)
- taskRunner.standards: docs, rules — string arrays
- taskRunner.standardsOverrides — Record<string, StandardsOverride>
- taskRunner.taskAreas — Record<string, TaskAreaConfig>
- taskRunner.referenceDocs — Record<string, string>
- taskRunner.neverLoad — string[]
- taskRunner.selfDocTargets — Record<string, string>
- taskRunner.protectedDocs — string[]
- orchestrator.assignment.sizeWeights — Record<string, number>
- orchestrator.preWarm.commands — Record<string, string>
- orchestrator.preWarm.always — string[]
- orchestrator.merge.verify — string[]

Rationale for exclusions: Collection/Record types don't map cleanly to single-value TUI controls. Project identity fields (name, description, paths) are rarely changed and risky to edit casually. All excluded fields can be edited directly in taskplane-config.json.

### Non-Editable Field Surfacing (R003 item 3)

The TUI shows ALL config fields for discoverability per PROMPT.md requirement. Non-editable fields are surfaced as follows:

1. **Read-only header in each section:** Sections with JSON-only fields show a dimmed footer row listing them. Example:
   ```
   ── Assignment ──────────────────────
     strategy          affinity-first    (project)
     ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
     + sizeWeights (edit JSON directly)
   ```

2. **Dedicated "Advanced (JSON Only)" section** at the bottom of the section list (section #12) that aggregates all JSON-only fields grouped by subsection. This section uses SettingsList with all items set to read-only display (no `values` array = no toggle). Selecting an item shows its current value and the instruction "Edit in .pi/taskplane-config.json".

3. **Project identity fields** (name, description, paths) are shown as a read-only banner at the top of the settings view — always visible, not editable.

### Field Contract Table (R003 suggestion)

Complete per-field specification for Step 2 implementation:

| Config Path | Display Label | Control | Layer | Write Target | Source Badge Rule | Clear/Unset |
|------------|--------------|---------|-------|-------------|-------------------|-------------|
| `orchestrator.orchestrator.maxLanes` | Max Lanes | input (number) | L1 | project | raw JSON present? → (project), else (default) | Cannot unset, always has value |
| `orchestrator.orchestrator.worktreeLocation` | Worktree Location | toggle | L1 | project | raw JSON present? → (project), else (default) | Cannot unset, always has value |
| `orchestrator.orchestrator.worktreePrefix` | Worktree Prefix | input (string) | L1 | project | raw JSON present? → (project), else (default) | Cannot unset, always has value |
| `orchestrator.orchestrator.batchIdFormat` | Batch ID Format | toggle | L1 | project | raw JSON present? → (project), else (default) | Cannot unset, always has value |
| `orchestrator.orchestrator.spawnMode` | Spawn Mode | toggle | L1+L2 | project or prefs | prefs.spawnMode set? → (user), raw JSON present? → (project), else (default) | Prefs: delete key to clear. Project: always has default |
| `orchestrator.orchestrator.tmuxPrefix` | Tmux Prefix | input (string) | L1+L2 | project or prefs | prefs.tmuxPrefix non-empty? → (user), raw JSON present? → (project), else (default) | Prefs: set "" to clear. Project: always has default |
| `orchestrator.orchestrator.operatorId` | Operator ID | input (string) | L1+L2 | project or prefs | prefs.operatorId non-empty? → (user), raw JSON present? → (project), else (default) | Prefs: set "" to clear (auto-detect). Project: "" = auto-detect |
| `orchestrator.dependencies.source` | Dep Source | toggle | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `orchestrator.dependencies.cache` | Dep Cache | toggle | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `orchestrator.assignment.strategy` | Strategy | toggle | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `orchestrator.preWarm.autoDetect` | Auto-Detect | toggle | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `orchestrator.merge.model` | Merge Model | input (string) | L1+L2 | project or prefs | prefs.mergeModel non-empty? → (user), raw JSON present? → (project), else (default) | Prefs: set "" to clear. "" = inherit session model |
| `orchestrator.merge.tools` | Merge Tools | input (string) | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `orchestrator.merge.order` | Merge Order | toggle | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `orchestrator.failure.onTaskFailure` | On Task Failure | toggle | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `orchestrator.failure.onMergeFailure` | On Merge Failure | toggle | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `orchestrator.failure.stallTimeout` | Stall Timeout (min) | input (number) | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `orchestrator.failure.maxWorkerMinutes` | Max Worker Min | input (number) | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `orchestrator.failure.abortGracePeriod` | Abort Grace (sec) | input (number) | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `orchestrator.monitoring.pollInterval` | Poll Interval (sec) | input (number) | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `taskRunner.worker.model` | Worker Model | input (string) | L1+L2 | project or prefs | prefs.workerModel non-empty? → (user), raw JSON present? → (project), else (default) | Prefs: set "" to clear. "" = inherit session model |
| `taskRunner.worker.tools` | Worker Tools | input (string) | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `taskRunner.worker.thinking` | Worker Thinking | input (string) | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `taskRunner.worker.spawnMode` | Worker Spawn Mode | toggle | L1 | project | raw JSON present? → (project), else (default=unset, inherits orch) | **Optional field:** unset means inherit from orchestrator.spawnMode. Toggle values: ["(inherit)", "subprocess", "tmux"]. Selecting "(inherit)" deletes the key from JSON. |
| `taskRunner.reviewer.model` | Reviewer Model | input (string) | L1+L2 | project or prefs | prefs.reviewerModel non-empty? → (user), raw JSON present? → (project), else (default) | Prefs: set "" to clear. "" = inherit session model |
| `taskRunner.reviewer.tools` | Reviewer Tools | input (string) | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `taskRunner.reviewer.thinking` | Reviewer Thinking | input (string) | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `taskRunner.context.workerContextWindow` | Context Window | input (number) | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `taskRunner.context.warnPercent` | Warn % | input (number) | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `taskRunner.context.killPercent` | Kill % | input (number) | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `taskRunner.context.maxWorkerIterations` | Max Iterations | input (number) | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `taskRunner.context.maxReviewCycles` | Max Review Cycles | input (number) | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `taskRunner.context.noProgressLimit` | No Progress Limit | input (number) | L1 | project | raw JSON present? → (project), else (default) | Cannot unset |
| `taskRunner.context.maxWorkerMinutes` | Max Worker Min (ctx) | input (number) | L1 | project | raw JSON present? → (project), else (default) | **Optional field:** unset means no per-worker time cap. Input accepts empty string to delete key. |
| `(preferences only) dashboardPort` | Dashboard Port | input (number) | L2 | prefs only | prefs.dashboardPort set? → (user), else (default=unset) | Delete key to unset |

**Source badge examples (R003 suggestion):**
1. **Project-set:** `Max Lanes          5              (project)` — value 5 found in `.pi/taskplane-config.json`
2. **User-override:** `Worker Model       claude-4-opus  (user)` — prefs.workerModel="claude-4-opus" overrides project value
3. **Default-only:** `Stall Timeout      30             (default)` — no override in either file, using schema default

**Disambiguation for duplicate labels (R003 missing item):**
- `spawnMode` appears in both Orchestrator and Worker sections. In Orchestrator, it's labeled "Spawn Mode"; in Worker, it's labeled "Worker Spawn Mode". The section heading provides additional context.
- `maxWorkerMinutes` appears in Failure and Context sections. Failure version is labeled "Max Worker Min"; Context version is labeled "Max Worker Min (ctx)".
- `model` appears in Merge, Worker, and Reviewer sections. Each is in its own section, providing unambiguous context.
- `tools` appears in Merge, Worker, and Reviewer. Same: section context disambiguates.
