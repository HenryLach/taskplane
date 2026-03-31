# TP-105: Headless Lane Runner and Single-Task /orch Runtime V2 — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-30
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Trace current single-task `/orch` execution through engine, execution helpers, lane sessions, and task-runner autostart
- [ ] Identify every place the current path still depends on TMUX sessions, `TASK_AUTOSTART`, or `/task` semantics

---

### Step 1: Implement Headless Lane Runner
**Status:** ⬜ Not Started

- [ ] Add a lane-runner process/module that owns one lane's execution lifecycle using the shared executor core and direct agent host
- [ ] Define the lane-runner launch contract, control signals, and lane snapshot outputs
- [ ] Keep worktree/orch-branch semantics intact while changing the runtime host

---

### Step 2: Cut Over Single-Task `/orch`
**Status:** ⬜ Not Started

- [ ] Route `/orch <PROMPT.md>` through the lane-runner backend
- [ ] Remove mission-critical dependence on `TASK_AUTOSTART` and lane Pi session startup hooks for this path
- [ ] Ensure no part of the single-task Runtime V2 flow requires `/task` or TMUX

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Add or update tests for lane-runner launch, single-task `/orch` execution, and new backend lifecycle behavior
- [ ] Run the full suite
- [ ] Run CLI smoke checks
- [ ] Fix all failures

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update architecture and command docs for the new single-task Runtime V2 path
- [ ] Log discoveries in STATUS.md

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
| 2026-03-30 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
