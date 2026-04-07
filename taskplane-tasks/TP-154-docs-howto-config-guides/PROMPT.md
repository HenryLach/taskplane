# Task: TP-154 - Update how-to config guides for current architecture

**Created:** 2026-04-07
**Size:** M

## Review Level: 0 (None)

**Assessment:** Documentation-only changes to two how-to markdown files. No code, no config, no security surface.
**Score:** 0/8 — Blast radius: 0, Pattern novelty: 0, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-154-docs-howto-config-guides/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Update the two configuration how-to guides to reflect the current Taskplane architecture:

1. `docs/how-to/configure-task-runner.md` — Currently titled "Configure Task Runner (`.pi/task-runner.yaml`)" and framed entirely around `/task` and YAML config. Needs to be rewritten to cover configuring worker, reviewer, and context settings via `taskplane-config.json` (or the `/taskplane-settings` TUI). The concept of "task runner configuration" is still valid — it controls worker model, reviewer model, context limits, task areas, etc. — but the framing should be around the JSON config and `/orch` execution, not YAML and `/task`.

2. `docs/how-to/configure-task-orchestrator.md` — Currently titled "Configure Task Orchestrator (`.pi/task-orchestrator.yaml`)" and uses YAML examples. Needs to be updated to frame around `taskplane-config.json` as the primary config format. Also remove tmux spawn_mode references — only `subprocess` exists now.

Write from the perspective of what exists today. No deprecation notices, no historical context.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `README.md` — current config format description
- `.pi/taskplane-config.json` — actual config file for this project, shows real JSON structure
- `docs/reference/configuration/taskplane-settings.md` — settings reference for field names and descriptions

## Environment

- **Workspace:** `docs/how-to/`
- **Services required:** None

## File Scope

- `docs/how-to/configure-task-runner.md`
- `docs/how-to/configure-task-orchestrator.md`

## Steps

### Step 0: Preflight

- [ ] Read both how-to files and catalog all stale references
- [ ] Read `.pi/taskplane-config.json` for the actual JSON config structure
- [ ] Read `docs/reference/configuration/taskplane-settings.md` for current field names

### Step 1: Update docs/how-to/configure-task-runner.md

- [ ] **Update title:** Change from "Configure Task Runner (`.pi/task-runner.yaml`)" to something like "Configure Worker, Reviewer, and Context Settings" or "Configure Task Execution Settings"
- [ ] **Update "Where this file lives" section:** Primary config is `.pi/taskplane-config.json` under the `taskRunner` key. YAML (`.pi/task-runner.yaml`) is a legacy fallback. Also mention `/taskplane-settings` TUI as an interactive alternative
- [ ] **Update all config examples:** Convert YAML examples to JSON format using camelCase keys (e.g., `task_areas` → `taskAreas`, `reference_docs` → `referenceDocs`, `worker_context_window` → `workerContextWindow`). Show them as JSON snippets within the `taskRunner` object
- [ ] **Remove all `/task` references:** The "Validate your config" section shows `/task path/to/PROMPT.md` — replace with `/orch path/to/PROMPT.md` or `/orch-plan all`
- [ ] **Remove `spawn_mode` from worker section:** This is an orchestrator-level setting, not a task runner setting. If it appears in the worker config example, remove it
- [ ] **Update "Related guides" links** at the bottom

### Step 2: Update docs/how-to/configure-task-orchestrator.md

- [ ] **Update title:** Change from "Configure Task Orchestrator (`.pi/task-orchestrator.yaml`)" to something like "Configure Orchestrator Settings" with reference to `taskplane-config.json`
- [ ] **Update "Where this file lives" section:** Primary config is `.pi/taskplane-config.json` under the `orchestrator` key. YAML is legacy fallback. Mention `/taskplane-settings` TUI
- [ ] **Update all config examples:** Convert YAML to JSON format with camelCase keys (e.g., `max_lanes` → `maxLanes`, `spawn_mode` → remove, `worktree_location` → `worktreeLocation`). Show as JSON snippets within the `orchestrator` object
- [ ] **Remove tmux references:** Remove `spawn_mode: "tmux"` option and the `tmux_prefix` setting. The only spawn mode is `subprocess`. Remove the tuning tip about using tmux mode for debugging
- [ ] **Update "Related guides" links** at the bottom

### Step 3: Documentation & Delivery

- [ ] Verify all internal doc links resolve correctly
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/how-to/configure-task-runner.md` — reframe for JSON config and `/orch`
- `docs/how-to/configure-task-orchestrator.md` — reframe for JSON config, remove tmux

**Check If Affected:**
- `docs/README.md` — links to these guides (another task handles README updates, but the link targets should still work if we don't rename the files)

## Completion Criteria

- [ ] All steps complete
- [ ] Zero references to `/task` as a user command
- [ ] Config examples are in JSON format with camelCase keys
- [ ] Zero references to tmux as a spawn mode or dependency
- [ ] Both guides reference `taskplane-config.json` as the primary config
- [ ] All markdown links resolve

## Git Commit Convention

- **Step completion:** `docs(TP-154): complete Step N — description`
- **Bug fixes:** `fix(TP-154): description`
- **Hydration:** `hydrate: TP-154 expand Step N checkboxes`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Mention `/task` as a user-facing command
- Reference tmux as a spawn mode or dependency
- Modify files outside `docs/how-to/configure-task-runner.md` and `docs/how-to/configure-task-orchestrator.md`
- Skip tests
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)
