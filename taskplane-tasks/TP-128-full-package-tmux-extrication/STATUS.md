# TP-128: Full Package TMUX Extrication — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-02
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read PROMPT.md and STATUS.md
- [ ] Count TMUX refs in task-runner.ts, CLI, templates, supervisor
- [ ] Log inventory

### Step 1: Remove TMUX from task-runner.ts
**Status:** ⬜ Not Started
- [ ] Remove spawnAgentTmux
- [ ] Remove spawn_mode: "tmux" branch
- [ ] Remove TMUX session helpers
- [ ] Keep subprocess path working
- [ ] Update tests

### Step 2: Remove TMUX from CLI
**Status:** ⬜ Not Started
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

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
