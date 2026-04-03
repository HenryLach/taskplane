# Task: TP-130 - Engine Worker Diagnostics and Resilience

**Created:** 2026-04-03
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Adds error handlers and stderr capture to the engine-worker child process, plus a snapshot failure counter. Small scope, low risk.
**Score:** 2/8 — Blast radius: 1 (engine-worker, extension), Pattern novelty: 1 (standard error handling), Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-130-engine-worker-diagnostics-and-resilience/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Add diagnostic infrastructure to the engine-worker child process so that when crashes occur, we have actionable information instead of just "exit code 1". Also add graceful degradation for repeated snapshot failures.

Three improvements from Sage review of the engine crash investigation:

### 1. Process-level error handlers (P1)
Add `uncaughtException` and `unhandledRejection` handlers to `engine-worker.ts`. When triggered, send a structured IPC error message with the stack trace to the parent process before exiting. This ensures the parent (extension.ts) receives diagnostic context instead of just an exit code.

### 2. Stderr capture to batch-scoped log file (P1)
In `extension.ts` where the engine-worker child is forked, capture the child's stderr to a batch-scoped log file (e.g., `.pi/telemetry/{batchId}-engine-worker-stderr.log`). Include the tail of this log in the failure notification to the supervisor. Currently stderr is inherited (displayed in terminal) but never persisted.

### 3. Snapshot failure counter with graceful degradation (P2)
In the `reviewerRefresh` interval in `lane-runner.ts`, count consecutive `emitSnapshot` failures. After a threshold (e.g., 5 consecutive), disable the reviewer refresh interval for that task and log a warning. This prevents a broken snapshot path from generating thousands of silent errors per run.

## Dependencies

- None

## Context to Read First

- `extensions/taskplane/engine-worker.ts` — child process entry, no error handlers currently
- `extensions/taskplane/extension.ts` — `child = fork(workerPath, ...)`, `child.on("exit", ...)` handler
- `extensions/taskplane/lane-runner.ts` — `reviewerRefresh` interval, `emitSnapshot` calls

## File Scope

- `extensions/taskplane/engine-worker.ts`
- `extensions/taskplane/engine-worker-entry.mjs`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/lane-runner.ts`
- `extensions/tests/*.test.ts`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read engine-worker.ts error handling (or lack thereof)
- [ ] Read extension.ts fork + exit handler
- [ ] Read lane-runner.ts reviewerRefresh interval

### Step 1: Process-level error handlers
- [ ] In engine-worker.ts, add `process.on("uncaughtException", ...)` that sends IPC error with stack trace then exits
- [ ] Add `process.on("unhandledRejection", ...)` with same behavior
- [ ] Ensure the IPC message reaches the parent before process exits (use sync or callback exit)

### Step 2: Stderr capture
- [ ] In extension.ts fork setup, pipe child stderr to a file instead of inheriting
- [ ] File path: `.pi/telemetry/{batchId}-engine-worker-stderr.log`
- [ ] Also pipe to parent stderr (tee pattern) so terminal display is preserved
- [ ] Include stderr tail in the failure supervisor alert message

### Step 3: Snapshot failure counter
- [ ] In lane-runner.ts, add a consecutive failure counter around the `reviewerRefresh` interval's emitSnapshot call
- [ ] After 5 consecutive failures, clearInterval and log a warning
- [ ] Reset counter on success

### Step 4: Tests
- [ ] Add structural test: engine-worker.ts has uncaughtException handler
- [ ] Add structural test: engine-worker.ts has unhandledRejection handler
- [ ] Run full suite
- [ ] Fix failures

### Step 5: Documentation & Delivery
- [ ] Update STATUS.md

## Do NOT

- Change the emitSnapshot non-throwing contract (P0 fix already in place)
- Add heavy logging that could impact performance
- Block the engine-worker exit on file I/O (keep exit fast)

## Git Commit Convention

- `feat(TP-130): complete Step N — ...`
