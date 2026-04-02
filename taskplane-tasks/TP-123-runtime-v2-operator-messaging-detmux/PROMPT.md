# Task: TP-123 - Runtime V2 Operator Messaging De-TMUX

**Created:** 2026-04-02
**Size:** M

## Review Level: 2 (Plan + Code)

**Assessment:** Updates operator-facing messaging/hints from TMUX terminology to Runtime V2 session terminology. Moderate blast radius across dashboard + extension strings; low algorithmic risk.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-123-runtime-v2-operator-messaging-detmux/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Remove TMUX-centric wording from operator surfaces while preserving behavior. Replace attach/session guidance with Runtime V2 equivalents so users are not instructed to use tmux commands in a no-TMUX runtime.

## Dependencies

- **Task:** TP-122 (baseline + guardrails)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/formatting.ts`
- `extensions/taskplane/messages.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/worktree.ts`
- `dashboard/public/app.js`
- `dashboard/server.cjs`

## File Scope

- `extensions/taskplane/formatting.ts`
- `extensions/taskplane/messages.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/worktree.ts`
- `dashboard/public/app.js`
- `dashboard/server.cjs`
- `extensions/tests/*.test.ts`

## Steps

### Step 0: Preflight copy inventory
- [ ] List all user-facing strings that contain `tmux` in extension + dashboard runtime files
- [ ] Classify each as: hint text, status label, diagnostic message, legacy compatibility note
- [ ] Log inventory in STATUS.md

### Step 1: Replace operator guidance strings
- [ ] Replace `tmux attach ...` hints with Runtime V2 guidance
- [ ] Update "TMUX sessions" wording to backend-neutral terminology (agent/lane sessions)
- [ ] Keep historical migration context only where needed

### Step 2: Dashboard label cleanup
- [ ] Update dashboard labels/tooltips that imply tmux is the active runtime
- [ ] Preserve compatibility behavior for data shape fields (no data contract breaks)
- [ ] Ensure merge/lane liveness indicators still render correctly

### Step 3: Tests
- [ ] Update/extend tests that assert old TMUX wording
- [ ] Run full extension test suite
- [ ] Fix failures

### Step 4: Documentation & delivery
- [ ] Update migration docs with operator-facing wording changes
- [ ] Record before/after string inventory in STATUS.md

## Do NOT

- Remove config/state compatibility aliases in this task
- Change lane/session identity formats
- Change dashboard API payload shape unless tests and docs are updated

## Git Commit Convention

- `refactor(TP-123): ...`
- `test(TP-123): ...`
- `docs(TP-123): ...`

## Amendments

<!-- Workers add amendments here if issues discovered during execution. -->
