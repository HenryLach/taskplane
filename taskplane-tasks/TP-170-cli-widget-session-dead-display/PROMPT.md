# Task: TP-170 - CLI Widget Session-Dead Display Fix

**Created:** 2026-04-12
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** UI-only fix in formatting.ts. No persistence or state changes. Low blast radius.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-170-cli-widget-session-dead-display/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Fix the CLI widget incorrectly showing 'session dead' / 'failed' for completed workspace lanes, and 'waiting for data' for active lanes during Runtime V2 execution (#425). The widget doesn't account for wave transitions — completed lanes from prior waves show as failed, and active lanes can't resolve their registry entries.

## Dependencies

- **Task:** TP-166 (lane identity/cap fixes may change how lanes are numbered in workspace mode)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/formatting.ts`
- `extensions/taskplane/process-registry.ts`
- `extensions/taskplane/engine.ts`
- `extensions/tests/formatting*.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read formatting.ts — how CLI widgets render lane status
- [ ] Read process-registry.ts — how the widget looks up session liveness
- [ ] Understand how lane lists are derived (batch state vs allocated lanes vs registry)
- [ ] Identify the session name mismatch between widget lookup and registry keys
- [ ] Document findings in STATUS.md

### Step 1: Fix Wave-Aware Lane Display

- [ ] Make the widget wave-aware: completed lanes from prior waves show ✓ succeeded (or are hidden)
- [ ] Active lanes should show current task ID, step, and progress from registry/telemetry
- [ ] Fix session name matching between widget and V2 process registry
- [ ] Handle the case where a lane has no registry entry (not yet started) vs terminated
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/formatting.ts` (modified)
- `extensions/taskplane/process-registry.ts` (modified if lookup logic changes)

### Step 2: Testing & Verification

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures
- [ ] Add tests: widget shows correct status for completed vs active vs pending lanes

### Step 3: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- None

**Check If Affected:**
- `docs/tutorials/use-the-dashboard.md` — if CLI widget behavior is documented

## Completion Criteria

- [ ] All steps complete
- [ ] Completed lanes show succeeded, not failed
- [ ] Active lanes show task progress, not 'waiting for data'
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `fix(TP-170): complete Step N — description`
- **Tests:** `test(TP-170): description`
- **Hydration:** `hydrate: TP-170 expand Step N checkboxes`

## Do NOT

- Change dashboard (web UI) rendering — this is CLI widget only
- Modify the process registry data model
- Skip tests
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

