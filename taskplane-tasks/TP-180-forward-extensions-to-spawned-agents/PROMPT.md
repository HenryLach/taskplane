# Task: TP-180 - Forward Project and Global Extensions to Spawned Agents

**Created:** 2026-04-20
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Touches all three agent spawn paths plus config schema, settings TUI, and a new utility module. No auth/security, but broad blast radius across spawn infrastructure.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-180-forward-extensions-to-spawned-agents/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Taskplane spawns worker, reviewer, and merge agents with `--no-extensions` to prevent cwd-based auto-discovery from causing duplicate extension loading in worktree contexts. However, this also prevents third-party pi extensions installed by the user (project-level or global) from loading in spawned agents.

This task adds extension forwarding: read packages from `.pi/settings.json` (project and global), filter out taskplane itself, apply per-agent-type exclusions from config, and pass remaining packages as explicit `-e` flags to all three spawn points. The `--no-extensions` flag stays — explicit `-e` entries are honored alongside it (this is how the bridge extension already loads).

Additionally, add a Settings TUI submenu where users can toggle specific extensions on/off per agent type, with extensions discovered automatically (no manual text entry).

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/agent-host.ts` — `spawnAgent()` function, `--no-extensions` + `-e` wiring
- `extensions/taskplane/lane-runner.ts` — Worker spawn at line ~580 (`extensions: [bridgeExtensionPath]`)
- `extensions/taskplane/agent-bridge-extension.ts` — Reviewer spawn at line ~442 (hardcoded args)
- `extensions/taskplane/merge.ts` — Merge agent spawn at line ~719 (`AgentHostOptions`)
- `extensions/taskplane/settings-tui.ts` — Existing settings TUI for submenu pattern
- `extensions/taskplane/config-schema.ts` — Config type definitions
- `extensions/taskplane/config-loader.ts` — Config loading and merging
- `extensions/taskplane/types.ts` — `TaskRunnerConfig`, `OrchestratorConfig`

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/settings-loader.ts` (new)
- `extensions/taskplane/lane-runner.ts`
- `extensions/taskplane/agent-bridge-extension.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/config-schema.ts`
- `extensions/taskplane/config-loader.ts`
- `extensions/taskplane/settings-tui.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/settings-loader.test.ts` (new)
- `extensions/tests/extension-forwarding.test.ts` (new)

## Steps

### Step 0: Preflight

- [ ] Required files and paths exist
- [ ] Dependencies satisfied
- [ ] Read `agent-host.ts` to confirm `--no-extensions` + `-e` pattern
- [ ] Read all three spawn points to understand current extension wiring

### Step 1: Create settings-loader utility

Create `extensions/taskplane/settings-loader.ts` to read and merge extension packages from project and global `.pi/settings.json` files.

- [ ] Implement `loadPiSettingsPackages(stateRoot)` that reads project `.pi/settings.json` packages array
- [ ] Implement global packages loading from `~/.pi/agent/settings.json` (use `os.homedir()` for cross-platform, respect `PI_CODING_AGENT_DIR` env var)
- [ ] Merge: union of both lists, deduplicated by package specifier, project entries first
- [ ] Always filter out any package containing "taskplane" (already loaded as bridge extension)
- [ ] Return `string[]` of package specifiers (e.g., `["npm:@samfp/pi-memory", "npm:pi-smart-fetch"]`) or empty array
- [ ] Handle gracefully: missing files, malformed JSON, missing `packages` key, empty arrays

**Important:** Do NOT resolve `npm:` prefixed packages to filesystem paths. Return the original specifiers as-is — pi's own resolution handles path mapping when processing `-e` flags.

**Artifacts:**
- `extensions/taskplane/settings-loader.ts` (new)

### Step 2: Add per-agent-type exclusion config

Add `excludeExtensions` arrays to the config schema for worker, reviewer, and merge agent types.

- [ ] Add `excludeExtensions?: string[]` to worker config in `config-schema.ts` and `types.ts`
- [ ] Add `excludeExtensions?: string[]` to reviewer config in `config-schema.ts` and `types.ts`
- [ ] Add `excludeExtensions?: string[]` to merge config in `config-schema.ts` and `types.ts`
- [ ] Update `config-loader.ts` to load and default `excludeExtensions` to `[]`
- [ ] Implement `filterExcludedExtensions(packages: string[], exclusions: string[]): string[]` in `settings-loader.ts`

The filter should match by package specifier (exact match). Example config:
```json
{
  "taskRunner": {
    "worker": { "excludeExtensions": ["npm:pi-smart-fetch"] },
    "reviewer": { "excludeExtensions": [] }
  },
  "orchestrator": {
    "merge": { "excludeExtensions": [] }
  }
}
```

**Artifacts:**
- `extensions/taskplane/config-schema.ts` (modified)
- `extensions/taskplane/types.ts` (modified)
- `extensions/taskplane/config-loader.ts` (modified)
- `extensions/taskplane/settings-loader.ts` (modified)

### Step 3: Wire extensions into all three spawn points

Inject discovered (non-excluded) packages as `-e` flags at each agent spawn point.

**Worker** (`lane-runner.ts` ~line 580):
- [ ] Call `loadPiSettingsPackages(config.stateRoot)` and `filterExcludedExtensions()` with worker exclusions
- [ ] Append result to existing `extensions: [bridgeExtensionPath]` array
- [ ] Pass worker exclusions through from config (may need threading via `LaneRunnerConfig` or env)

**Reviewer** (`agent-bridge-extension.ts` ~line 442):
- [ ] Call `loadPiSettingsPackages(cwd)` and `filterExcludedExtensions()` with reviewer exclusions
- [ ] Add `-e` flags for each package after `--no-extensions` in the args array
- [ ] Reviewer exclusions available via `TASKPLANE_REVIEWER_EXCLUDE_EXTENSIONS` env var (same pattern as `TASKPLANE_REVIEWER_MODEL`)

**Merge agent** (`merge.ts` ~line 719):
- [ ] Call `loadPiSettingsPackages(stateRoot)` and `filterExcludedExtensions()` with merge exclusions
- [ ] Add `extensions` field to `AgentHostOptions` with bridge extension + project packages

**Artifacts:**
- `extensions/taskplane/lane-runner.ts` (modified)
- `extensions/taskplane/agent-bridge-extension.ts` (modified)
- `extensions/taskplane/merge.ts` (modified)

### Step 4: Add Settings TUI submenu

Add an "Agent Extensions" section to `/taskplane-settings` where users can toggle extensions per agent type.

- [ ] Discover all installed packages by calling `loadPiSettingsPackages()` (merged project + global)
- [ ] Display a submenu per agent type (Worker, Reviewer, Merger) showing each package as a toggle
- [ ] Toggling off adds the package to that agent type's `excludeExtensions` array
- [ ] Toggling on removes it from `excludeExtensions`
- [ ] Save changes to `taskplane-config.json` (project-level config)
- [ ] Follow existing settings-tui patterns for save/reload behavior

**Artifacts:**
- `extensions/taskplane/settings-tui.ts` (modified)

### Step 5: Testing & Verification

- [ ] Create `extensions/tests/settings-loader.test.ts`:
  - Reads project packages from `.pi/settings.json`
  - Reads global packages from homedir settings
  - Merges and deduplicates correctly
  - Filters out taskplane packages
  - Handles missing/malformed files gracefully
  - `filterExcludedExtensions()` removes exact matches
- [ ] Create `extensions/tests/extension-forwarding.test.ts`:
  - Worker spawn args include `--no-extensions` plus `-e` for each package
  - Reviewer spawn args include `-e` flags
  - Merge agent opts include extensions
  - Excluded extensions are not passed
  - Empty package list produces no `-e` flags
- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 6: Documentation & Delivery

- [ ] Update `docs/how-to/configure-task-runner.md` — document `excludeExtensions` config
- [ ] Update `docs/reference/commands.md` if `/taskplane-settings` section exists — mention extension toggles
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/how-to/configure-task-runner.md` — new `excludeExtensions` config keys

**Check If Affected:**
- `docs/explanation/architecture.md` — agent spawning model description
- `docs/reference/configuration/task-orchestrator.yaml.md` — if merge config documented there

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing (existing + new)
- [ ] Third-party extensions available in worker/reviewer/merge agents
- [ ] Extensions toggleable per agent type in `/taskplane-settings`
- [ ] Documentation updated

## Testing & Verification

- `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`

## Git Commit Convention

- **Step completion:** `feat(TP-180): complete Step N — description`
- **Bug fixes:** `fix(TP-180): description`
- **Tests:** `test(TP-180): description`
- **Hydration:** `hydrate: TP-180 expand Step N checkboxes`

## Do NOT

- Remove or change `--no-extensions` flag on spawned agents — it stays
- Resolve `npm:` package specifiers to filesystem paths — pass specifiers as-is to `-e`
- Add hardcoded extension names or paths
- Change `execLog` signature or other unrelated APIs
- Modify persistence/resume/integration behavior
- Make `review_step` parameters optional or add inference logic
- Add blanket optional chaining to existing code

---

## Amendments (Added During Execution)
