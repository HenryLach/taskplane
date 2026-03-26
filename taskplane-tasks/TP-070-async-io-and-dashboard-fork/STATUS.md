# TP-070: Async I/O in Poll Loops + Dashboard Child Process — Status

**Current Step:** Step 1: Create Async Tmux Helper
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-26
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 2
**Size:** M

---

### Step 0: Preflight
**Status:** 🟩 Complete
- [x] Identify all spawnSync("tmux") in polling paths
- [x] Identify all readFileSync/existsSync/statSync in polling paths
- [x] Determine dashboard server start mechanism

**Preflight Findings:**
- spawnSync("tmux") in polling: execution.ts (tmuxHasSession L225, tmuxKillSession L244, captureTmuxPaneTail L509, spawnLaneSession L748), merge.ts (spawnMergeSession L493, captureMergePaneOutput L2296)
- Sync FS in polling: execution.ts pollUntilTaskComplete (existsSync for .DONE, readFileSync for STATUS.md, captureTmuxPaneTail), supervisor.ts readNewBytes (existsSync+statSync), readLockfile (existsSync+readFileSync), writeLockfile (writeFileSync+renameSync)
- Dashboard: Already started as child_process.spawn from CLI (bin/taskplane.mjs cmdDashboard). NOT in-process in extension.ts. Step 5 is already done.

---

### Step 1: Create Async Tmux Helper
**Status:** 🟨 In Progress
- [ ] Add `spawn` import from child_process and `fs/promises` import
- [ ] Create tmuxAsync() that returns Promise<{status: number; stdout: string}>
- [ ] Create async versions: tmuxHasSessionAsync, tmuxKillSessionAsync, captureTmuxPaneTailAsync
- [ ] Create async version: readTaskStatusTailAsync

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
| 2026-03-26 00:35 | Task started | Extension-driven execution |
| 2026-03-26 00:35 | Step 0 started | Preflight |
| 2026-03-26 00:35 | Task started | Extension-driven execution |
| 2026-03-26 00:35 | Step 0 started | Preflight |

---

## Blockers

*None*
