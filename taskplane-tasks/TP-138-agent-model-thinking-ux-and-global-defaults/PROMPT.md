# Task: TP-138 - Agent Inherit Defaults and Thinking Picker

**Created:** 2026-04-04
**Size:** M

## Review Level: 2 (Plan + Code)

**Assessment:** Config schema, runtime fallbacks, and settings TUI changes. Multiple interacting defaults need auditing.
**Score:** 4/8 — Blast radius: 2 (config schema, runtime, settings TUI), Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-138-agent-model-thinking-ux-and-global-defaults/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Fix agent defaults to "inherit" and add a thinking-mode picker to `/taskplane-settings`.

### Already done (prior releases)
- ✅ Interactive model picker in `/taskplane-settings` (v0.24.17)
- ✅ Merge agent thinking config field (v0.24.18)
- ✅ mergeThinking user prefs wiring (v0.24.19)

### Remaining work

1. **Fix defaults to inherit** — worker thinking defaults to `"off"` in config-schema.ts, reviewer model hardcodes `"openai/gpt-5.3-codex"`. Both should default to `""` (inherit from session). Support explicit `"inherit"` string as alias for `""`.

2. **Audit runtime fallbacks** — check `extensions/task-runner.ts`, `extensions/taskplane/lane-runner.ts`, and `extensions/taskplane/agent-host.ts` for `thinking || "off"` or similar fallbacks that override inherit semantics. The goal: when thinking is `""`, NO `--thinking` flag is passed to pi, so the session default is used.

3. **Thinking picker in /taskplane-settings** — add thinking-mode selection (not free-text) for worker, reviewer, and merge thinking settings. Options: "inherit (use session thinking)", "on", "off". When a model is changed to one with thinking support, suggest setting thinking to "on".

## Environment

- **Workspace:** `extensions/taskplane/`, `dashboard/`, `bin/`
- **Services required:** None
- **Submodule workspace:** `.pi/git/github.com/loopyd/taskplane` (absolute: `/mnt/PROJECTS/repos/bof3-decomp/.pi/git/github.com/loopyd/taskplane`)


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## Dependencies

- None

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `extensions/taskplane/settings-tui.ts` — model picker (v0.24.17) and thinking fields
- `extensions/taskplane/config-schema.ts` — defaults, `MergeConfig`, `UserPreferences`
- `extensions/taskplane/config-loader.ts` — config loading chain, prefs application
- `extensions/taskplane/agent-host.ts` — how thinking flag is passed to pi subprocess
- `extensions/taskplane/lane-runner.ts` — worker/reviewer spawn, thinking fallback logic
- `extensions/task-runner.ts` — /task spawn path, may have `thinking || "off"` fallbacks

## File Scope

- `extensions/taskplane/config-schema.ts`
- `extensions/taskplane/config-loader.ts`
- `extensions/taskplane/settings-tui.ts`
- `extensions/taskplane/lane-runner.ts`
- `extensions/taskplane/agent-host.ts`
- `extensions/task-runner.ts`
- `templates/config/task-runner.yaml`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read config-schema.ts defaults for worker, reviewer, merger
- [ ] Read settings-tui.ts current thinking field definitions
- [ ] Read lane-runner.ts and agent-host.ts thinking handling
- [ ] Read task-runner.ts for thinking fallback patterns
- [ ] Grep for `thinking || "off"` or `thinking || "on"` across entire codebase

### Step 1: Fix defaults to inherit
- [ ] config-schema.ts: worker.thinking `"off"` → `""` (inherit)
- [ ] config-schema.ts: reviewer.model `"openai/gpt-5.3-codex"` → `""` (inherit)
- [ ] config-loader.ts: normalize `"inherit"` to `""` during config loading (treat as alias)
- [ ] Update template files if they reference old defaults
- [ ] Verify existing project configs with explicit values still work unchanged

### Step 2: Audit and fix runtime fallbacks
- [ ] Check lane-runner.ts: does it pass `thinking: config.thinking || "off"`? If so, change to pass `undefined` when empty (let pi inherit)
- [ ] Check agent-host.ts: ensure empty thinking = no `--thinking` flag passed
- [ ] Check task-runner.ts: same audit for /task path
- [ ] Check merge.ts: confirm empty thinking = no flag (already wired in v0.24.18, verify)
- [ ] Verify: `thinking: ""` → pi subprocess inherits session thinking mode

### Step 3: Thinking picker in /taskplane-settings
- [ ] Change worker/reviewer/merge thinking fields from `control: "input"` to a picker
- [ ] Options: "inherit (use session thinking)", "on", "off"
- [ ] Reuse `selectScrollable()` from the model picker implementation
- [ ] Current value marked with ✓ in the picker
- [ ] Save correctly to project config or user prefs (L1+L2 fields)

### Step 4: Testing & Verification
- [ ] Test: empty thinking = no --thinking flag in subprocess
- [ ] Test: "inherit" string normalized to "" in config
- [ ] Test: thinking picker saves and loads correctly
- [ ] Test: reviewer with no model override inherits session model
- [ ] Run full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`

### Step 5: Documentation & Delivery
- [ ] Update config reference docs if defaults changed
- [ ] Update STATUS.md

## Do NOT

- Hardcode any specific model names as defaults
- Break existing configs (empty string must still work as inherit)
- Remove per-agent model/thinking override capability
- Reimplement the model picker (already done in settings-tui.ts)
- Touch `taskplane init` or global defaults (that's TP-139)

## Git Commit Convention

- `feat(TP-138): complete Step N — ...`
