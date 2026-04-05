# Task: TP-138 - Agent Model/Thinking UX and Global Defaults

**Created:** 2026-04-04
**Size:** L

## Review Level: 2 (Plan + Code)

**Assessment:** Touches init flow, config schema, CLI UX, and user preferences. Multiple interacting changes across the scaffolding and configuration surface.
**Score:** 5/8 — Blast radius: 2 (init, config schema, CLI, preferences), Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-138-agent-model-thinking-ux-and-global-defaults/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Overhaul the agent model and thinking configuration UX to be interactive, intelligent, and inheritable. Currently:
- Model defaults to empty string (inherit) ✅ but reviewer hardcodes `openai/gpt-5.3-codex` ❌
- Thinking defaults to `"off"` for workers ❌ — should inherit from session
- Model selection requires exact manual typing — error-prone
- No way to save preferred agent config as global defaults for future projects
- No interactive model picker during `taskplane init`

### Goals

1. **All agent defaults to inherit** — model and thinking for worker, reviewer, and merger should default to `""` (inherit from session). No assumptions about which models the user has access to.

2. **Interactive model selection** — during `taskplane init`, show pi's model list with enabled models highlighted. User picks from a list, not free-text. Reference implementation: `C:/dev/sage` project's model selection UX.

3. **Auto-thinking based on model** — when user selects a thinking-capable model, default thinking to `"on"` (high budget if available). Show thinking setting immediately below model so user sees it update. User can override.

4. **Thinking level options** — show available thinking options for the selected model (varies by provider). Default to highest available.

5. **Global defaults** — extend `~/.pi/agent/taskplane/preferences.json` with agent config defaults. Add `taskplane config --save-as-defaults` command to save current project's agent settings as global defaults. Suppress this option for local (non-global) installs.

## Dependencies

- None

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `bin/taskplane.mjs` — init flow, CLI commands
- `extensions/taskplane/config-schema.ts` — defaults for all agent configs
- `extensions/taskplane/config-loader.ts` — config loading chain, user preferences
- `C:/dev/sage/` — reference implementation for interactive model selection
- Pi docs on model registry API — how to query available/enabled models

## File Scope

- `bin/taskplane.mjs`
- `extensions/taskplane/config-schema.ts`
- `extensions/taskplane/config-loader.ts`
- `templates/config/task-runner.yaml`
- `templates/config/taskplane-config.json` (if exists)

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read current `taskplane init` flow in bin/taskplane.mjs
- [ ] Read config-schema.ts defaults for worker, reviewer, merger
- [ ] Read config-loader.ts user preferences loading chain
- [ ] Read Sage project's model selection implementation (C:/dev/sage)
- [ ] Understand pi's model registry API — how to list models, check enabled, check thinking support

### Step 1: Fix defaults to inherit
- [ ] config-schema.ts: worker.thinking `"off"` → `""` (inherit)
- [ ] config-schema.ts: reviewer.model `"openai/gpt-5.3-codex"` → `""` (inherit)
- [ ] Support explicit `"inherit"` string as alias for `""` in config-loader
- [ ] Update template files (task-runner.yaml, any JSON templates)
- [ ] Verify: empty model/thinking = pi session's model/thinking used at runtime

### Step 2: Interactive model selection in init
- [ ] Query pi's model registry for available models (spawn pi subprocess or read models.json)
- [ ] Show enabled models (with API keys configured) prominently
- [ ] Present list selection UX (not free-text) during `taskplane init`
- [ ] Allow per-agent-type model selection (worker, reviewer, merger)
- [ ] Support "inherit from session" as the default/first option
- [ ] Fall back to manual entry if model list unavailable

### Step 3: Auto-thinking based on model
- [ ] Query model's thinking capability from registry metadata
- [ ] When user selects a thinking-capable model, set thinking to `"on"` automatically
- [ ] Show thinking setting immediately after model selection
- [ ] Allow user to change thinking mode (on/off, and budget level if available)
- [ ] When model changes, reset thinking to smart default
- [ ] For models without thinking support, set to `"off"` and show as disabled

### Step 4: Global defaults infrastructure
- [ ] Extend preferences.json schema with agent config defaults section
- [ ] During `taskplane init`, check for global defaults and pre-populate config
- [ ] Add `taskplane config --save-as-defaults` command
- [ ] Detect global vs local install — suppress save-as-defaults for local installs
- [ ] Show user what was saved and where

### Step 5: Testing & Verification
- [ ] Test: fresh init with no global defaults → all inherit
- [ ] Test: fresh init with global defaults → pre-populated
- [ ] Test: save-as-defaults writes to correct preferences location
- [ ] Test: explicit "inherit" string treated same as empty string
- [ ] Test: model selection shows enabled models
- [ ] Run full suite, fix failures

### Step 6: Documentation & Delivery
- [ ] Update config reference docs
- [ ] Update README if init flow changed
- [ ] Update STATUS.md

## Design Notes

### Config inheritance chain
```
pi session model/thinking (runtime)
  ↑ falls back to
project config (.pi/taskplane-config.json)
  ↑ pre-populated from
global defaults (~/.pi/agent/taskplane/preferences.json)
  ↑ seeded from
interactive init or --save-as-defaults
```

### "inherit" semantics
- `model: ""` or `model: "inherit"` → don't pass `--model` to pi, use session model
- `thinking: ""` or `thinking: "inherit"` → don't pass `--thinking` to pi, use session thinking
- Both treated identically at runtime; "inherit" is a human-readable alias

### Model registry access from CLI
`taskplane init` runs as a standalone Node script, not inside pi. Options:
1. Spawn `pi --mode json` to query model list via RPC
2. Read `~/.pi/models.json` directly (simpler but may not reflect auth state)
3. Import pi's ModelRegistry if available as a library

Prefer option 1 (RPC query) for accuracy — it checks auth state.

## Do NOT

- Hardcode any specific model names as defaults
- Break existing configs (empty string must still work as inherit)
- Remove per-agent model override capability
- Make thinking mandatory for models that support it (user can always set to off)

## Git Commit Convention

- `feat(TP-138): complete Step N — ...`
