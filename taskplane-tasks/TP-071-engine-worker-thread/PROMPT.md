# Task: TP-071 - Engine Worker Thread

**Created:** 2026-03-25
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Moves the engine's batch execution loop to a Node.js worker thread. Significant architectural change — the engine's entry point, communication with the main thread, and error handling all change. High blast radius across engine, extension, and supervisor modules.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-071-engine-worker-thread/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Even with async I/O (TP-070), the engine's polling loops, state persistence, and tmux management consume event loop time in the supervisor's process. Move the engine to a `worker_thread` so the supervisor's main thread is completely free for user interaction.

### Why worker_thread (not child_process)

- **Shared memory** — `MessagePort` for low-latency communication, `SharedArrayBuffer` if needed
- **Lower overhead** — no IPC serialization, no separate process lifecycle
- **Same Node.js features** — `fs`, `child_process`, `spawn` all work in worker threads
- **Clean API** — `new Worker(script, { workerData })` + `parentPort.postMessage()`

### Architecture

```
Main thread (pi process):
├── Terminal input (TUI) — always responsive
├── Supervisor agent (LLM calls)
├── Orch tools (orch_status, orch_start, etc.) — read state files
└── Event tailer — polls events.jsonl

Worker thread (engine):
├── Batch planning (discovery, DAG, wave computation)
├── Lane execution (tmux spawn, polling, .DONE detection)
├── Merge orchestration (merge agent spawn, result polling)
├── Merge health monitor
└── State persistence (batch-state.json writes)
```

**Communication:**
- Engine → Main: `parentPort.postMessage({ type: "event", ... })` for engine events
- Main → Engine: `worker.postMessage({ type: "pause" | "abort" | "resume" })` for control
- Shared state: `batch-state.json` on disk (already the contract between engine and supervisor)

## Dependencies

- **Task:** TP-070 (async I/O must be done first — sync I/O in a worker thread still blocks that thread's event loop)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/engine.ts` — `startBatchAsync()` function (the entry point to move to worker)
- `extensions/taskplane/extension.ts` — search for `startBatchAsync` to find how the engine is called from `/orch` command handler. Also search for `onNotify` to find the notification callback pattern.
- `extensions/taskplane/types.ts` — `OrchBatchRuntimeState` and engine config types that need to cross the thread boundary

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/engine-worker.ts` (new — worker thread entry point)
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/engine-worker-thread.test.ts` (new)

## Steps

### Step 0: Preflight

- [ ] Read `startBatchAsync()` in engine.ts — understand all parameters, callbacks, return values
- [ ] Read how `/orch` command handler calls `startBatchAsync()` in extension.ts — understand the callback pattern (`onNotify`, `onComplete`, `onEngineEvent`)
- [ ] Read how orch tools (pause, abort, resume) interact with the running engine — do they call engine functions directly or use state files?
- [ ] Check: does `worker_threads` work in pi's extension runtime? (TypeScript, ESM imports)

### Step 1: Create Engine Worker Entry Point

Create `extensions/taskplane/engine-worker.ts`:

```typescript
import { parentPort, workerData } from "worker_threads";
import { startBatchAsync } from "./engine.ts";

// Receive config from main thread
const { config, stateRoot, target, ... } = workerData;

// Start the engine with callbacks that post messages to main thread
await startBatchAsync({
    ...config,
    onNotify: (msg, level) => parentPort.postMessage({ type: "notify", msg, level }),
    onEngineEvent: (event) => parentPort.postMessage({ type: "engine-event", event }),
    onComplete: (result) => parentPort.postMessage({ type: "complete", result }),
});
```

**Key decisions:**
- `workerData` passes serializable config (no functions, no ctx references)
- Callbacks are replaced with `postMessage` calls
- The worker exits naturally when `startBatchAsync` resolves

**Artifacts:**
- `extensions/taskplane/engine-worker.ts` (new)

### Step 2: Update Extension to Spawn Worker

In extension.ts, replace the direct `startBatchAsync()` call with:

```typescript
const worker = new Worker(engineWorkerPath, {
    workerData: { config, stateRoot, target, ... },
});

worker.on("message", (msg) => {
    switch (msg.type) {
        case "notify": ctx.ui.notify(msg.msg, msg.level); break;
        case "engine-event": handleEngineEvent(msg.event); break;
        case "complete": handleBatchComplete(msg.result); break;
    }
});

worker.on("error", (err) => { /* handle worker crash */ });
worker.on("exit", (code) => { /* handle worker exit */ });
```

**Control signals (pause, abort, resume):**
- Orch tools currently call engine functions directly — these need to use `worker.postMessage()` instead
- OR: orch tools write signal files that the engine checks in its poll loops (simpler, already partially implemented for abort)

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified)

### Step 3: Wire Orch Tools to Worker

Update `doOrchPause`, `doOrchAbort`, `doOrchResume` to send control messages to the worker thread instead of calling engine functions directly:

```typescript
worker.postMessage({ type: "pause" });
worker.postMessage({ type: "abort", hard: true });
worker.postMessage({ type: "resume" });
```

The worker listens via `parentPort.on("message")` and translates to engine calls.

Alternatively, if the orch tools already use signal files (`.pi/orch-abort-signal`), the worker just needs to check for those files in its poll loops — which it already does.

Investigate which approach is simpler during preflight.

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified)
- `extensions/taskplane/engine-worker.ts` (modified — add parentPort listener)

### Step 4: Handle Worker Lifecycle

- Worker crash → log error, set batch state to paused/failed, notify operator
- Worker exit code 0 → batch completed normally
- Worker exit code != 0 → unexpected failure, notify operator
- Pi session exit → worker should terminate (use `worker.terminate()` on session_end)

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified)

### Step 5: Testing & Verification

> ZERO test failures allowed.

- [ ] Add `extensions/tests/engine-worker-thread.test.ts`:
  - Worker spawns and receives workerData
  - Worker posts messages for notify, engine-event, complete
  - Control messages (pause, abort) reach the worker
  - Worker crash is detected and reported
  - Source-based tests for worker entry point structure
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Build passes: `node bin/taskplane.mjs help`

### Step 6: Documentation & Delivery

- [ ] Update `docs/explanation/architecture.md` if it describes the engine threading model
- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (internal architectural change)

**Check If Affected:**
- `docs/explanation/architecture.md` — threading model
- `extensions/taskplane/supervisor-primer.md` — architecture section

## Completion Criteria

- [ ] Engine runs in worker thread, main thread stays responsive
- [ ] Orch tools (pause, abort, resume) work across thread boundary
- [ ] Engine events reach supervisor via worker messages
- [ ] Worker crash is detected and handled gracefully
- [ ] No behavioral change — same batch execution, just in a different thread
- [ ] All tests passing
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `perf(TP-071): complete Step N — description`

## Do NOT

- Change what the engine does — only where it runs
- Remove the ability to run the engine in the main thread (keep as fallback)
- Change the batch-state.json format
- Change the events.jsonl format
- Modify the dashboard server (already forked in TP-070)

---

## Amendments
