# TP-128: Full Package TMUX Extrication — Status

**Current Step:** Step 2: Remove TMUX from CLI
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-03
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read PROMPT.md and STATUS.md
- [x] Count TMUX refs in task-runner.ts, CLI, templates, supervisor
- [x] Log inventory

### Step 1: Remove TMUX from task-runner.ts
**Status:** ✅ Complete
- [x] Remove spawnAgentTmux
- [x] Remove spawn_mode: "tmux" branch
- [x] Remove TMUX session helpers
- [x] Keep subprocess path working
- [x] Update tests

### Step 2: Remove TMUX from CLI
**Status:** 🟨 In Progress
- [ ] Remove doctor TMUX checks
- [ ] Remove install-tmux guidance
- [ ] Update help text

### Step 3: De-TMUX supervisor templates and primer
**Status:** ⬜ Not Started
- [ ] Clean templates/agents/supervisor.md
- [ ] Clean supervisor-primer.md
- [ ] Check supervisor.ts

### Step 4: Expand audit script scope
**Status:** ⬜ Not Started
- [ ] Update audit to scan full package
- [ ] Update guard test if needed

### Step 5: Tests and verification
**Status:** ⬜ Not Started
- [ ] Run full suite
- [ ] Fix failures
- [ ] Run expanded audit

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update STATUS.md
- [ ] Log final count

---

## TMUX Inventory (Step 0)

- `extensions/task-runner.ts`: **124** matches
- `bin/taskplane.mjs`: **51** matches
- `templates/agents/supervisor.md`: **4** matches
- `templates/config/task-runner.yaml`: **3** matches
- `extensions/taskplane/supervisor-primer.md`: **23** matches
- `extensions/taskplane/supervisor.ts`: **7** matches

## Execution Log

| Timestamp | Action | Outcome |
| 2026-04-03 04:02 | Task started | Runtime V2 lane-runner execution |
| 2026-04-03 04:02 | Step 0 started | Preflight |
| 2026-04-03 04:10 | TMUX inventory captured | Counted refs in task-runner, CLI, templates, and supervisor files |
|-----------|--------|---------|
| 2026-04-03 04:03 | Review R001 | plan Step 1: APPROVE |
