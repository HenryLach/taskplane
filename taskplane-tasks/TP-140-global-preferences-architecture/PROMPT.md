# Task: TP-140 - Global Preferences Architecture

**Created:** 2026-04-05
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Fundamental config loading semantics change. Touches config-loader, config-schema, settings-tui, types, and init flow. High blast radius but clear design.
**Score:** 5/8 — Blast radius: 2 (config-loader, settings TUI, CLI init, types), Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-140-global-preferences-architecture/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Redesign the config loading architecture so that:

1. **Schema defaults** are internal code values used only to seed global preferences — never visible to users as a "source".
2. **Global preferences** (`~/.pi/agent/taskplane/preferences.json`) are the user's baseline configuration for all projects.
3. **Project config** (`.pi/taskplane-config.json`) contains only sparse overrides — fields the user explicitly set for this project.
4. **Precedence**: schema defaults → global preferences → project overrides (project wins).

Currently the precedence is reversed: project config is the full document and user preferences override it. This task flips the model.

### Specific deliverables

**A. Rename "user preferences" → "global preferences" throughout:**
- `UserPreferences` interface → `GlobalPreferences`
- `loadUserPreferences()` → `loadGlobalPreferences()`
- `applyUserPreferences()` → logic changes (see below)
- `resolveUserPreferencesPath()` → `resolveGlobalPreferencesPath()`
- Variable names, comments, docs, settings TUI labels
- The file path stays the same: `~/.pi/agent/taskplane/preferences.json`

**B. Flip config loading precedence:**
- Current: `loadProjectConfig()` → merge schema defaults with project JSON → apply user prefs on top
- New: `loadProjectConfig()` → merge schema defaults with global prefs → apply project overrides on top
- Project config is sparse: only fields explicitly set by the user for this project
- Missing fields in project config fall through to global → schema defaults

**C. Sparse project config:**
- `taskplane init` stops writing the full config — writes only project-specific fields: `configVersion`, `taskRunner.project`, `taskRunner.paths`, `taskRunner.testing`, `taskRunner.taskAreas`, and any explicit overrides the user chose during init
- Agent model/thinking settings are NOT written to project config (they come from global)
- Deep merge logic: project overrides are merged field-by-field into the global+defaults base, not shallow-replaced

**D. Settings TUI changes:**
- Source badges: only `(global)` and `(project)` — no `(default)` badge
- Default save target: global preferences (currently asks "User preferences or Project config?")
- "Save to project" is the exception — only when user explicitly chooses project override
- When saving to project, write ONLY that specific field override, not the entire config
- When a project override exists and user wants to remove it (revert to global), provide a "Remove project override" option

**E. Global preferences schema expansion:**
- All fields that can be in project config should also be valid in global preferences (model, thinking, tools, max lanes, stall timeout, etc.)
- The current `GlobalPreferences` interface only has a subset (model overrides, operator ID, session prefix). Expand to cover all settings.

## Dependencies

- None

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `extensions/taskplane/config-loader.ts` — current loading chain, `loadProjectConfig()`, `applyUserPreferences()`
- `extensions/taskplane/config-schema.ts` — `UserPreferences`, `DEFAULT_PROJECT_CONFIG`, defaults
- `extensions/taskplane/settings-tui.ts` — source badges, save destination logic, field layers
- `extensions/taskplane/types.ts` — `OrchestratorConfig` runtime type
- `bin/taskplane.mjs` — `generateProjectConfig()`, init flow

## Environment

- **Workspace:** `extensions/taskplane/`, `bin/`
- **Services required:** None

## File Scope

- `extensions/taskplane/config-schema.ts`
- `extensions/taskplane/config-loader.ts`
- `extensions/taskplane/settings-tui.ts`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/extension.ts`
- `extensions/task-runner.ts`
- `bin/taskplane.mjs`
- `extensions/tests/project-config-loader.test.ts`
- `extensions/tests/user-preferences.test.ts` (rename to global-preferences.test.ts)
- `extensions/tests/settings-tui.test.ts`
- `docs/reference/configuration/*`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read config-loader.ts: understand current `loadProjectConfig()` merge chain
- [ ] Read config-schema.ts: understand `UserPreferences` interface and defaults
- [ ] Read settings-tui.ts: understand source detection, save destination, field layers
- [ ] Map all references to `UserPreferences`, `loadUserPreferences`, `applyUserPreferences` across codebase

### Step 1: Rename user preferences → global preferences
- [ ] Rename `UserPreferences` → `GlobalPreferences` in config-schema.ts
- [ ] Rename `loadUserPreferences()` → `loadGlobalPreferences()` in config-loader.ts
- [ ] Rename `resolveUserPreferencesPath()` → `resolveGlobalPreferencesPath()` in config-loader.ts
- [ ] Rename `applyUserPreferences()` → rework in next step
- [ ] Update all imports and references across codebase (extension.ts, settings-tui.ts, tests, etc.)
- [ ] Update variable names, comments, JSDoc
- [ ] Run targeted tests to verify rename is clean

**Artifacts:**
- `extensions/taskplane/config-schema.ts` (modified)
- `extensions/taskplane/config-loader.ts` (modified)
- `extensions/taskplane/settings-tui.ts` (modified)
- `extensions/taskplane/extension.ts` (modified)

### Step 2: Expand global preferences schema
- [ ] Expand `GlobalPreferences` to cover all configurable fields (not just model/operator/session)
- [ ] Include: all model/thinking fields, tools, max lanes, stall timeout, merge timeout, merge order, failure policy, assignment strategy, monitoring, review settings, context limits, etc.
- [ ] Structure mirrors `TaskplaneConfig` but all fields optional (missing = use schema default)
- [ ] Update `extractAllowlistedPreferences()` to handle expanded fields
- [ ] Update `applyGlobalPreferences()` (formerly `applyUserPreferences()`) for all new fields

**Artifacts:**
- `extensions/taskplane/config-schema.ts` (modified)
- `extensions/taskplane/config-loader.ts` (modified)

### Step 3: Flip config loading precedence
- [ ] Rewrite `loadProjectConfig()`: schema defaults → merge global prefs → merge project overrides
- [ ] Implement deep merge for sparse project config (field-by-field, not shallow replace)
- [ ] Project config is treated as sparse: only fields present in the JSON are overrides
- [ ] Missing project config fields fall through to global prefs → schema defaults
- [ ] Preserve `normalizeInheritanceAliases()` at the end of the chain
- [ ] Update `loadLayer1Config()` similarly
- [ ] Run targeted tests — many will need updating for new precedence

**Artifacts:**
- `extensions/taskplane/config-loader.ts` (modified)
- `extensions/tests/project-config-loader.test.ts` (modified)

### Step 4: Settings TUI — source badges and save behavior
- [ ] Source detection: only `(global)` and `(project)` badges
- [ ] A value is `(project)` if present in project config JSON; otherwise `(global)`
- [ ] Default save destination: global preferences (not project)
- [ ] "Save to project override" as explicit secondary option
- [ ] When saving to project, write ONLY that specific field to project JSON (sparse write)
- [ ] Add "Remove project override" option when a project override exists
- [ ] Update field layer annotations if needed (current L1/L2/L1+L2 may need revision)
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/settings-tui.ts` (modified)
- `extensions/tests/settings-tui.test.ts` (modified)

### Step 5: Sparse project config in taskplane init
- [ ] `generateProjectConfig()` writes only project-specific fields: configVersion, project name/description, paths, testing commands, task areas
- [ ] Agent model/thinking/tools NOT included (come from global)
- [ ] Orchestrator settings NOT included unless explicitly chosen during init
- [ ] Existing full project configs continue to work (all fields treated as overrides)

**Artifacts:**
- `bin/taskplane.mjs` (modified)

### Step 6: Testing & Verification

> ZERO test failures allowed. Full suite quality gate.

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Test: sparse project config with global prefs → correct merge
- [ ] Test: project override takes precedence over global
- [ ] Test: removing project override reverts to global value
- [ ] Test: settings TUI shows correct source badges
- [ ] Test: settings TUI saves to global by default
- [ ] Test: taskplane init produces sparse config
- [ ] CLI smoke: `node bin/taskplane.mjs help` and `node bin/taskplane.mjs doctor`
- [ ] Fix all failures

### Step 7: Documentation & Delivery
- [ ] Update `docs/reference/configuration/task-runner.yaml.md`
- [ ] Update `docs/reference/configuration/taskplane-settings.md`
- [ ] Update any docs referencing "user preferences"
- [ ] Update STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/reference/configuration/taskplane-settings.md` — new save behavior, source badges
- `docs/reference/configuration/task-runner.yaml.md` — sparse config, global prefs

**Check If Affected:**
- `docs/how-to/configure-task-runner.md`
- `docs/explanation/architecture.md`
- `README.md`

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] "user preferences" renamed to "global preferences" everywhere
- [ ] Config precedence: schema → global → project
- [ ] Project config is sparse (init writes only project-specific fields)
- [ ] Settings TUI defaults to saving to global

## Git Commit Convention

- `feat(TP-140): complete Step N — description`
- `fix(TP-140): description`
- `refactor(TP-140): description`

## Do NOT

- Change the file path for global preferences (`~/.pi/agent/taskplane/preferences.json`)
- Remove support for full project config files (existing projects must continue working)
- Hardcode any model names
- Break the config auto-migration pipeline
- Touch first-install bootstrap or cross-provider guidance (that's TP-141)

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
