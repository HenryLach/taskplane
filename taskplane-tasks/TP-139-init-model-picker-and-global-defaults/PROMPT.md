# Task: TP-139 - Init Model Picker and Global Defaults

**Created:** 2026-04-05
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** New interactive UX in CLI init flow plus new config infrastructure for global defaults. Touches CLI entrypoint and config loading chain.
**Score:** 4/8 — Blast radius: 2 (CLI init, config-loader, preferences), Pattern novelty: 1 (adapting existing picker), Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-139-init-model-picker-and-global-defaults/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Bring the interactive model picker UX to `taskplane init` and add global agent config defaults infrastructure.

Currently `taskplane init` does not offer model selection — users must manually edit `.pi/taskplane-config.json` after init. This task adds:

1. **Interactive model/thinking selection during init** — the same provider → model picker UX from `/taskplane-settings` (v0.24.17), adapted for the standalone CLI context where pi's model registry may not be directly available.

2. **Global defaults** — extend `~/.pi/agent/taskplane/preferences.json` so users can save preferred agent configs once and have them pre-populate future project inits. Add `taskplane config --save-as-defaults` command.

## Dependencies

- **Task:** TP-138 (inherit defaults and thinking picker must be complete so "inherit" semantics are established)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `extensions/taskplane/settings-tui.ts` — model picker implementation (reuse pattern, not code — init is CLI not pi extension)
- `extensions/taskplane/config-schema.ts` — `UserPreferences` interface, config defaults
- `extensions/taskplane/config-loader.ts` — `loadUserPreferences()`, `resolveUserPreferencesPath()`
- `bin/taskplane.mjs` — init flow, CLI command structure

## Environment

- **Workspace:** `bin/taskplane.mjs`, `extensions/taskplane/config-loader.ts`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `bin/taskplane.mjs`
- `extensions/taskplane/config-schema.ts`
- `extensions/taskplane/config-loader.ts`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read bin/taskplane.mjs init flow (the `init` command handler)
- [ ] Read config-loader.ts `loadUserPreferences()` and `resolveUserPreferencesPath()`
- [ ] Read config-schema.ts `UserPreferences` interface
- [ ] Understand how settings-tui.ts pickModel works (pattern reference)
- [ ] Determine how to access model list from CLI context (pi subprocess, models.json, or library import)

### Step 1: Model registry access from CLI
- [ ] Investigate available approaches to query pi's model registry from standalone CLI:
  - Option A: Spawn `pi` subprocess with JSON output to query models
  - Option B: Read `~/.pi/models.json` or equivalent config directly
  - Option C: Import pi's ModelRegistry as a library
- [ ] Implement the chosen approach with graceful fallback if models unavailable
- [ ] Return structured list: `{ provider, id, displayName }[]`
- [ ] Run targeted tests

**Artifacts:**
- `bin/taskplane.mjs` (modified — model query helper)

### Step 2: Interactive model selection in init
- [ ] Add model selection prompt after project init scaffolding
- [ ] Show provider → model picker (adapting the pattern from settings-tui.ts for CLI readline context)
- [ ] "inherit from session" as the default/first option
- [ ] Allow per-agent-type selection (worker, reviewer, merger) or a single "use same for all" option
- [ ] After model selection, prompt for thinking mode (on/off/inherit)
- [ ] Write selections to the generated `.pi/taskplane-config.json`
- [ ] Fall back gracefully if model list unavailable (skip picker, use inherit defaults)
- [ ] Run targeted tests

**Artifacts:**
- `bin/taskplane.mjs` (modified — init flow)

### Step 3: Global defaults infrastructure
- [ ] Extend `UserPreferences` in config-schema.ts with agent config defaults section (workerThinking, reviewerThinking, etc. if not already present)
- [ ] During `taskplane init`, check for existing global defaults and pre-populate config
- [ ] Add `taskplane config --save-as-defaults` CLI command
- [ ] Read current project's agent settings from `.pi/taskplane-config.json`
- [ ] Write to preferences path (`~/.pi/agent/taskplane/preferences.json`)
- [ ] Detect global vs local install — suppress save-as-defaults guidance for local installs
- [ ] Show user what was saved and where
- [ ] Run targeted tests

**Artifacts:**
- `bin/taskplane.mjs` (modified — new command)
- `extensions/taskplane/config-schema.ts` (modified — preferences schema)
- `extensions/taskplane/config-loader.ts` (modified — if needed for new prefs fields)

### Step 4: Testing & Verification

> ZERO test failures allowed. Full suite quality gate.

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Test: `taskplane init` with no global defaults → all inherit
- [ ] Test: `taskplane init` with global defaults → pre-populated
- [ ] Test: `taskplane config --save-as-defaults` writes to correct path
- [ ] Test: model picker degrades gracefully when model list unavailable
- [ ] CLI smoke: `node bin/taskplane.mjs help` and `node bin/taskplane.mjs doctor`
- [ ] Fix all failures

### Step 5: Documentation & Delivery
- [ ] Update `docs/reference/commands.md` with `taskplane config --save-as-defaults`
- [ ] Update README if init flow changed
- [ ] Update STATUS.md
- [ ] Discoveries logged

## Documentation Requirements

**Must Update:**
- `docs/reference/commands.md` — add `taskplane config --save-as-defaults`

**Check If Affected:**
- `README.md` — init instructions may need updating
- `docs/reference/configuration/task-orchestrator.yaml.md` — global defaults mention

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Documentation updated

## Git Commit Convention

- `feat(TP-139): complete Step N — description`
- `fix(TP-139): description`
- `test(TP-139): description`

## Do NOT

- Reimplement the model picker from scratch — adapt the pattern from settings-tui.ts
- Hardcode any specific model names as defaults
- Break existing `taskplane init` behavior for users who skip the picker
- Make model selection mandatory during init (must be skippable)
- Touch `/taskplane-settings` (that's TP-138's scope)

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
