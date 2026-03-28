# Task: TP-079 - Workspace Packet-Home Contract and Mode Enforcement

**Created:** 2026-03-28
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Establishes new workspace routing contract and startup-mode guardrails that affect config loading and execution context. Medium-to-high behavioral impact.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-079-workspace-packet-home-contract-and-mode-enforcement/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Implement the foundational workspace routing contract for multi-repo task execution: add deterministic packet-home ownership (`taskPacketRepo`) and enforce startup mode selection without ambiguous fallback. This task establishes the non-negotiable config/runtime invariants required by #51 before segment scheduling work begins.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — sections: mode enforcement + packet-home contract
- `extensions/taskplane/workspace-config.ts` — workspace schema and validation
- `extensions/taskplane/workspace.ts` — execution context construction and mode determination
- `extensions/taskplane/config-schema.ts` — canonical JSON schema
- `extensions/taskplane/config-loader.ts` — JSON/YAML mapping and defaults

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/config-schema.ts`
- `extensions/taskplane/config-loader.ts`
- `extensions/taskplane/workspace-config.ts`
- `extensions/taskplane/workspace.ts`
- `extensions/taskplane/doctor.ts` (if routing diagnostics are emitted there)
- `extensions/tests/workspace-config.test.ts`
- `extensions/tests/project-config-loader.test.ts`
- `extensions/tests/*` (only as needed for failing regressions)

## Steps

### Step 0: Preflight

- [ ] Read current workspace config validation and mode-detection flow
- [ ] Confirm existing behavior for non-git cwd + missing workspace config
- [ ] Identify all call-sites that rely on `routing.tasksRoot` and `routing.defaultRepo`

### Step 1: Add packet-home routing contract

- [ ] Add `workspace.routing.taskPacketRepo` to canonical schema/types
- [ ] Validate `taskPacketRepo` references an existing repo ID
- [ ] Enforce invariant: `routing.tasksRoot` resolves inside `repos[taskPacketRepo].path`
- [ ] Enforce invariant: every configured task-area path resolves inside `tasksRoot`
- [ ] Provide actionable validation errors for invariant violations

**Artifacts:**
- `extensions/taskplane/config-schema.ts` (modified)
- `extensions/taskplane/workspace-config.ts` (modified)

### Step 2: Enforce deterministic mode selection

- [ ] Ensure workspace config presence always forces workspace mode (no repo-mode fallback)
- [ ] Ensure non-git cwd + no workspace config is a hard setup error with clear guidance
- [ ] Verify startup errors are surfaced consistently through extension command guard paths

**Artifacts:**
- `extensions/taskplane/workspace.ts` (modified)
- `extensions/taskplane/extension.ts` (only if error messaging/threading requires changes)

### Step 3: Config loading + compatibility

- [ ] Thread new field through JSON loader defaults and legacy YAML mapping
- [ ] Preserve backward compatibility messaging for older workspace configs (missing field)
- [ ] Add migration-safe defaults only where deterministic behavior remains valid

**Artifacts:**
- `extensions/taskplane/config-loader.ts` (modified)
- `extensions/tests/project-config-loader.test.ts` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Add/adjust unit tests for `taskPacketRepo` validation and path invariants
- [ ] Add/adjust tests for deterministic mode selection and hard-fail cases
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Update spec/status notes if behavior or naming changed during implementation
- [ ] Log discoveries in STATUS.md
- [ ] Create `.DONE`

## Documentation Requirements

**Must Update:**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — only if implementation requires contract clarifications

**Check If Affected:**
- `docs/reference/configuration/taskplane-settings.md`
- `docs/reference/commands.md`

## Completion Criteria

- [ ] `taskPacketRepo` is part of validated workspace routing contract
- [ ] `tasksRoot` ownership invariant is enforced
- [ ] Mode selection is deterministic and non-ambiguous
- [ ] Error messages are actionable and consistent
- [ ] All tests pass

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-079): complete Step N — description`
- **Bug fixes:** `fix(TP-079): description`
- **Tests:** `test(TP-079): description`
- **Hydration:** `hydrate: TP-079 expand Step N checkboxes`

## Do NOT

- Implement segment scheduler logic in this task
- Add packet-path env execution behavior yet (that is TP-082)
- Introduce non-deterministic fallback behavior for invalid workspace config
- Skip full-suite tests

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
