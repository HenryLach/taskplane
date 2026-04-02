# Task: TP-125 - Centralize Legacy TMUX Compatibility Shim

**Created:** 2026-04-02
**Size:** M

## Review Level: 2 (Plan + Code)

**Assessment:** Refactors scattered compatibility logic (`tmuxPrefix`, `tmuxSessionName`, spawnMode `"tmux"`) into a single compatibility shim. Medium risk due to config/state loading paths.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-125-centralize-legacy-tmux-compat-shim/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Centralize all remaining required TMUX compatibility behavior into one module so runtime files no longer carry scattered TMUX conditionals. This preserves backward compatibility while making final removal safe and auditable.

## Dependencies

- **Task:** TP-122 (audit + guardrails)
- **Task:** TP-124 (doc/type cleanup)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/config-loader.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/worktree.ts`
- `extensions/tests/project-config-loader.test.ts`
- `extensions/tests/orch-state-persistence.test.ts`

## File Scope

- `extensions/taskplane/tmux-compat.ts` (new)
- `extensions/taskplane/config-loader.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/worktree.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/project-config-loader.test.ts`
- `extensions/tests/orch-state-persistence.test.ts`
- `extensions/tests/state-migration.test.ts`

## Steps

### Step 0: Inventory compatibility call sites
- [ ] Identify every remaining runtime call site that must still read legacy TMUX-shaped inputs
- [ ] Confirm each site is truly ingress compatibility, not active backend logic
- [ ] Log list in STATUS.md

### Step 1: Introduce compatibility shim module
- [ ] Create `extensions/taskplane/tmux-compat.ts`
- [ ] Add canonical helper(s) for config alias normalization (`tmuxPrefix` → `sessionPrefix`)
- [ ] Add canonical helper(s) for persisted lane alias normalization (`tmuxSessionName` → `laneSessionId`)
- [ ] Add helper for spawnMode legacy value classification/deprecation messaging

### Step 2: Replace scattered compatibility logic
- [ ] Update `config-loader.ts` to use shim helpers
- [ ] Update `persistence.ts` normalization to use shim helpers
- [ ] Update other remaining ingress paths to use shim helpers
- [ ] Keep behavior identical (no compatibility regressions)

### Step 3: Tests
- [ ] Add/adjust tests to lock compatibility behavior via shim
- [ ] Run full extension suite
- [ ] Fix failures

### Step 4: Delivery
- [ ] Record TMUX-reference count delta after centralization
- [ ] Document exact legacy inputs still supported and where

## Do NOT

- Remove backward compatibility in this task
- Change persisted file schema versions in this task
- Rename external error code literals in this task

## Git Commit Convention

- `refactor(TP-125): ...`
- `test(TP-125): ...`
- `docs(TP-125): ...`

## Amendments

<!-- Workers add amendments here if issues discovered during execution. -->
