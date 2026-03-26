# TP-070: Async I/O in Poll Loops + Dashboard Child Process — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-25
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Identify all spawnSync("tmux") in polling paths
- [ ] Identify all readFileSync/existsSync/statSync in polling paths
- [ ] Determine dashboard server start mechanism

---

### Step 1: Create Async Tmux Helper
**Status:** ⬜ Not Started
- [ ] Create tmuxAsync() wrapper with spawn + promise
- [ ] Support has-session, capture-pane, kill-session patterns

---

### Step 2: Convert Lane Polling to Async
**Status:** ⬜ Not Started
- [ ] spawnSync → tmuxAsync in pollUntilTaskComplete
- [ ] readFileSync(STATUS.md) → fs.promises.readFile

---

### Step 3: Convert Merge Polling to Async
**Status:** ⬜ Not Started
- [ ] spawnSync → tmuxAsync in waitForMergeResult
- [ ] spawnSync → tmuxAsync in MergeHealthMonitor

---

### Step 4: Convert Supervisor Polling to Async
**Status:** ⬜ Not Started
- [ ] Event tailer: statSync/readFileSync → async
- [ ] Heartbeat: readFileSync/writeFileSync → async
- [ ] Add overlap guard for async setInterval callbacks

---

### Step 5: Fork Dashboard Server
**Status:** ⬜ Not Started
- [ ] Change dashboard from in-process to child_process.fork()

---

### Step 6: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Async tmux helper tests
- [ ] Full test suite passing
- [ ] Build passes

---

### Step 7: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-25 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*
