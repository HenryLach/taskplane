# TP-131: TMUX Naming Residual Cleanup — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-03
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 0
**Size:** S

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read PROMPT.md and STATUS.md
- [ ] Run audit script and log baseline
- [ ] Grep inventory across scope files

### Step 1: Dashboard frontend cleanup
**Status:** ⬜ Not Started
- [ ] Rename tmuxSessions → sessions in app.js
- [ ] Rename tmuxSet → sessionSet or remove
- [ ] Update liveness logic comments
- [ ] Rename .tmux-* CSS classes in style.css
- [ ] Update class references in app.js and index.html

### Step 2: Dashboard server cleanup
**Status:** ⬜ Not Started
- [ ] Rename tmuxSessions → sessions in API response
- [ ] Remove/rename getTmuxSessions stub
- [ ] Remove/rename /api/pane/* no-op endpoint
- [ ] Document tmuxSessionName compat mapping
- [ ] Update tmux prefix comments

### Step 3: Templates and other shipped files
**Status:** ⬜ Not Started
- [ ] Clean templates/config/task-runner.yaml
- [ ] Clean bin/rpc-wrapper.mjs comments
- [ ] Update task-orchestrator.ts comment

### Step 4: Audit script expansion
**Status:** ⬜ Not Started
- [ ] Add skills/ to SCAN_ROOTS
- [ ] Update guard test if needed

### Step 5: Verification
**Status:** ⬜ Not Started
- [ ] Run full test suite
- [ ] Fix failures
- [ ] Run audit and log final counts
- [ ] Verify dashboard renders correctly

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
