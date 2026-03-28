# TP-079: Workspace Packet-Home Contract and Mode Enforcement — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-28
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read current workspace config validation and mode-detection flow
- [ ] Confirm existing behavior for non-git cwd + missing workspace config
- [ ] Identify all call-sites that rely on `routing.tasksRoot` and `routing.defaultRepo`

---

### Step 1: Add packet-home routing contract
**Status:** ⬜ Not Started

- [ ] Add `workspace.routing.taskPacketRepo` to canonical schema/types
- [ ] Validate `taskPacketRepo` references an existing repo ID
- [ ] Enforce invariant: `routing.tasksRoot` resolves inside `repos[taskPacketRepo].path`
- [ ] Enforce invariant: every configured task-area path resolves inside `tasksRoot`
- [ ] Provide actionable validation errors for invariant violations

---

### Step 2: Enforce deterministic mode selection
**Status:** ⬜ Not Started

- [ ] Ensure workspace config presence always forces workspace mode (no repo-mode fallback)
- [ ] Ensure non-git cwd + no workspace config is a hard setup error with clear guidance
- [ ] Verify startup errors are surfaced consistently through extension command guard paths

---

### Step 3: Config loading + compatibility
**Status:** ⬜ Not Started

- [ ] Thread new field through JSON loader defaults and legacy YAML mapping
- [ ] Preserve backward compatibility messaging for older workspace configs (missing field)
- [ ] Add migration-safe defaults only where deterministic behavior remains valid

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Add/adjust unit tests for `taskPacketRepo` validation and path invariants
- [ ] Add/adjust tests for deterministic mode selection and hard-fail cases
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update spec/status notes if behavior or naming changed during implementation
- [ ] Log discoveries in STATUS.md
- [ ] Create `.DONE`

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-28 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
