# Task: TP-070 - Async I/O in Poll Loops + Dashboard Child Process

**Created:** 2026-03-25
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Converts synchronous I/O to async in performance-critical polling paths. Changes spawn patterns in execution, merge, and supervisor modules. Also changes dashboard server from in-process require to child_process.fork. Medium blast radius — touches core polling loops.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-070-async-io-and-dashboard-fork/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

The supervisor terminal has multi-second input lag during batch execution because every polling loop uses synchronous I/O (`spawnSync`, `readFileSync`, `existsSync`, `statSync`). Each sync call blocks the Node.js event loop, preventing keystroke processing until the call completes. `spawnSync("tmux")` is especially bad — it spawns a child process and blocks until it exits.

Convert all polling-path I/O to async, and move the dashboard server to a child process.

### What blocks the event loop today

| Call | Where | Frequency |
|------|-------|-----------|
| `spawnSync("tmux", ["has-session"])` | Lane polling, merge polling | Every 2s per lane |
| `spawnSync("tmux", ["capture-pane"])` | Merge health monitor, diagnostics | Every 2 min |
| `readFileSync(STATUS.md)` | Lane polling | Every 2s per lane |
| `existsSync(.DONE)` | Lane polling | Every 2s per lane |
| `readFileSync(batch-state.json)` | State persistence | On every change |
| `statSync(events.jsonl)` | Event tailer | Every 10s |
| `readFileSync/writeFileSync(lock.json)` | Heartbeat | Every 30s |
| Dashboard file scanning | Dashboard SSE | Every 1s |

## Dependencies

- **None**

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/execution.ts` — search for `spawnSync("tmux"` and `readFileSync` in `pollUntilTaskComplete` (~line 900+)
- `extensions/taskplane/merge.ts` — search for `spawnSync("tmux"` in `waitForMergeResult` (~line 555+)
- `extensions/taskplane/supervisor.ts` — search for `readFileSync` in event tailer and heartbeat
- `extensions/taskplane/extension.ts` — search for where dashboard server is started (if in-process)

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/execution.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/supervisor.ts`
- `extensions/taskplane/extension.ts` (dashboard fork)
- `extensions/taskplane/types.ts` (if adding async helper types)

## Steps

### Step 0: Preflight

- [ ] Identify all `spawnSync("tmux"` calls in polling paths (execution.ts, merge.ts)
- [ ] Identify all `readFileSync`/`existsSync`/`statSync` calls in polling paths
- [ ] Identify how the dashboard server is started (in-process vs already separate)
- [ ] Determine: do we need an async wrapper for tmux commands? (likely yes — a shared `tmuxAsync(args)` helper)

### Step 1: Create Async Tmux Helper

Create a shared async wrapper for tmux commands:

```typescript
async function tmuxAsync(args: string[]): Promise<{ status: number; stdout: string }> {
    return new Promise((resolve) => {
        const proc = spawn("tmux", args, { ... });
        // collect stdout, resolve on exit
    });
}
```

Use this for:
- `tmux has-session -t <name>` → returns status code (0 = alive)
- `tmux capture-pane -p -t <name>` → returns stdout
- `tmux kill-session -t <name>` → fire and forget

Place in `execution.ts` (alongside existing tmux helpers) or a new shared module.

**Artifacts:**
- `extensions/taskplane/execution.ts` (modified)

### Step 2: Convert Lane Polling to Async

In `pollUntilTaskComplete()` in `execution.ts` (~line 900+):

1. Replace `spawnSync("tmux", ["has-session"])` with `await tmuxAsync(["has-session"])`
2. Replace `existsSync(.DONE)` with `await fs.promises.access()` (or keep sync — it's fast)
3. Replace `readFileSync(STATUS.md)` with `await fs.promises.readFile()`
4. Replace `spawnSync("tmux", ["capture-pane"])` with `await tmuxAsync(["capture-pane"])`

The polling loop is already async (`await new Promise(r => setTimeout(r, POLL_INTERVAL))`), so inserting `await` calls is natural.

**Important:** `existsSync` and `statSync` are very fast for local files — converting them is low priority. Focus on `spawnSync("tmux")` and `readFileSync` for large files.

**Artifacts:**
- `extensions/taskplane/execution.ts` (modified)

### Step 3: Convert Merge Polling to Async

In `waitForMergeResult()` in `merge.ts`:

1. Replace `spawnSync("tmux", ["has-session"])` with `await tmuxAsync()`
2. Replace `existsSync(merge-result.json)` + `readFileSync` with async equivalents

In `MergeHealthMonitor` polling:
1. Replace `spawnSync("tmux", ["has-session"])` and `spawnSync("tmux", ["capture-pane"])` with async

**Artifacts:**
- `extensions/taskplane/merge.ts` (modified)

### Step 4: Convert Supervisor Polling to Async

In the event tailer (`startEventTailer`):
1. Replace `statSync(events.jsonl)` with `await fs.promises.stat()`
2. Replace `readFileSync` with `await fs.promises.readFile()`

In the heartbeat:
1. Replace `readFileSync`/`writeFileSync` of lock.json with async equivalents

**Note:** The event tailer uses `setInterval` — the callback needs to be async-safe. Use a flag to prevent overlapping poll ticks:

```typescript
let polling = false;
setInterval(async () => {
    if (polling) return;
    polling = true;
    try { /* async work */ } finally { polling = false; }
}, INTERVAL);
```

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (modified)

### Step 5: Fork Dashboard Server

If the dashboard is started in-process, change to `child_process.fork()`:

```typescript
const dashboard = fork(dashboardServerPath, ["--port", port.toString()], {
    stdio: "pipe",
    detached: false,
});
```

The dashboard server (`dashboard/server.cjs`) is already a standalone HTTP server — it just needs to be started as a separate process.

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified — dashboard start path)

### Step 6: Testing & Verification

> ZERO test failures allowed.

- [ ] Add tests for async tmux helper
- [ ] Verify existing tests still pass (polling behavior unchanged, just async)
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Build passes: `node bin/taskplane.mjs help`

### Step 7: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (internal change, no user-facing behavior change)

**Check If Affected:**
- `docs/how-to/troubleshoot-common-issues.md` — may mention performance

## Completion Criteria

- [ ] Zero `spawnSync("tmux"` calls in polling paths
- [ ] Lane polling, merge polling, merge health, event tailer, heartbeat all use async I/O
- [ ] Dashboard server runs in separate child process
- [ ] No behavioral change — same polling logic, just async
- [ ] All tests passing
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `perf(TP-070): complete Step N — description`

## Do NOT

- Change polling intervals or frequencies
- Change what is polled or how results are interpreted
- Make state persistence async (it's infrequent and needs atomicity)
- Remove any existing functionality
- Change the dashboard server's internal code (just how it's spawned)

---

## Amendments
