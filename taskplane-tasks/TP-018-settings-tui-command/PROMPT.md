# Task: TP-018 - /settings TUI Command

**Created:** 2026-03-17
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** New TUI component using pi's `ctx.ui` APIs. Interactive config editing with validation, section navigation, and write-back to JSON. Novel pattern for taskplane (first TUI beyond widgets). Moderate complexity.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-018-settings-tui-command/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Build a `/settings` slash command that provides an interactive TUI for viewing and editing taskplane configuration. The TUI shows a merged view of project config (Layer 1) and user preferences (Layer 2), clearly distinguishing which values come from which layer. Changes are validated and written back to the correct file.

This is the primary config interface — users should rarely need to edit JSON files directly. The TUI always shows the complete current schema with defaults, so new parameters added in future releases are immediately discoverable.

See spec: `.pi/local/docs/settings-and-onboarding-spec.md` — Core principle #4.

## Dependencies

- **Task:** TP-014 (JSON config schema — TUI reads/writes this format)
- **Task:** TP-017 (User preferences — TUI reads/writes Layer 2)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/settings-and-onboarding-spec.md` — config layers
- Pi extension docs for `ctx.ui` API (select, confirm, input, editor, custom)

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/extension.ts`
- `extensions/taskplane/settings-tui.ts` (new)
- `extensions/taskplane/types.ts`

## Steps

### Step 0: Preflight

- [ ] Read pi's `ctx.ui` API capabilities (select, confirm, input, editor, custom)
- [ ] Read current config schema from TP-014

### Step 1: Design Settings Navigation

- [ ] Define section groupings matching config schema (Orchestrator, Assignment, Merge, Failure, Monitoring, User Preferences)
- [ ] Determine which fields use select (enums), input (numbers/strings), or confirm (booleans)
- [ ] Mark each field as Layer 1 (project) or Layer 2 (user) for display

### Step 2: Implement /settings Command

- [ ] Register `/settings` slash command in extension.ts
- [ ] Implement section-based navigation using `ctx.ui.select()`
- [ ] Implement field editing with appropriate `ctx.ui` methods per type
- [ ] Show current values with source indicators (project/user/default)
- [ ] Validate inputs before writing

### Step 3: Implement Write-Back

- [ ] Layer 1 changes write to `taskplane-config.json` (in config repo for workspace mode)
- [ ] Layer 2 changes write to `~/.pi/agent/taskplane/preferences.json`
- [ ] Confirm before writing project config changes ("This changes shared project config. Continue?")

### Step 4: Testing & Verification

- [ ] Test settings load/display with both JSON and YAML config
- [ ] Test write-back to correct files
- [ ] Run: `cd extensions && npx vitest run`

### Step 5: Documentation & Delivery

- [ ] Add `/settings` to commands reference
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `docs/reference/commands.md` — add `/settings` command

**Check If Affected:**
- `docs/tutorials/install.md` — mention `/settings` for customization
- `README.md` — commands table

## Completion Criteria

- [ ] All steps complete
- [ ] `/settings` shows merged config view with source indicators
- [ ] Layer 1 and Layer 2 changes write to correct files
- [ ] New parameters from schema updates appear automatically
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `feat(TP-018): description`
- **Checkpoints:** `checkpoint: TP-018 description`

## Do NOT

- Allow Layer 2 edits to write to project config
- Allow Layer 1 edits without confirmation
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)
