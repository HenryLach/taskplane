# Task: TP-017 - User Preferences Layer

**Created:** 2026-03-17
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** New file creation and config merge logic. Small scope — single file in global directory, merge into existing config loader. No security impact.
**Score:** 2/8 — Blast radius: 0, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-017-user-preferences-layer/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Implement the user preferences layer (`~/.pi/agent/taskplane/preferences.json`) that stores personal settings like operator ID, default models, tmux prefix, and dashboard port. These preferences merge with project config at load time, with user values overriding project defaults for user-scoped fields.

See spec: `.pi/local/docs/settings-and-onboarding-spec.md` — Layer 2 (User config).

## Dependencies

- **Task:** TP-014 (JSON config schema must define which fields are user-overridable)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `.pi/local/docs/settings-and-onboarding-spec.md` — Layer 2 definition

## Environment

- **Workspace:** `extensions/taskplane/`, `extensions/task-runner.ts`
- **Services required:** None

## File Scope

- `extensions/taskplane/config.ts`
- `extensions/task-runner.ts`
- `extensions/taskplane/types.ts`

## Steps

### Step 0: Preflight

- [ ] Confirm `~/.pi/agent/taskplane/` path convention matches pi's agent directory pattern

### Step 1: Implement Preferences Loader

- [ ] Define preferences JSON schema (operator_id, models, tmux_prefix, dashboard_port)
- [ ] Implement `loadUserPreferences()` — reads from `~/.pi/agent/taskplane/preferences.json`
- [ ] Auto-create with defaults on first access if file doesn't exist
- [ ] Merge user preferences into project config (user values win for Layer 2 fields)

### Step 2: Testing & Verification

- [ ] Tests for preferences loading, auto-creation, and merge behavior
- [ ] Run: `cd extensions && npx vitest run`

### Step 3: Documentation & Delivery

- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (internal plumbing — `/settings` TUI will be the user-facing interface)

**Check If Affected:**
- None

## Completion Criteria

- [ ] All steps complete
- [ ] Preferences auto-created on first load
- [ ] User values correctly override project defaults for Layer 2 fields
- [ ] `.DONE` created

## Git Commit Convention

All commits for this task MUST include the task ID for traceability:

- **Implementation:** `feat(TP-017): description`
- **Checkpoints:** `checkpoint: TP-017 description`

## Do NOT

- Allow user preferences to override project-level settings (Layer 1)
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)
