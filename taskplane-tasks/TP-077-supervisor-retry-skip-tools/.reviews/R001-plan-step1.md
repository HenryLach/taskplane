# R001 Plan Review — Step 1 (`orch_retry_task`)

## Verdict: ❌ Changes requested

The Step 1 plan is directionally right (load state → validate failed task → reset → persist), but it is not yet sufficient to implement safely in this codebase.

## What is good

- Uses persisted batch state as source of truth (matches project invariants).
- Includes core retry mutation intent (failed → pending, counters adjusted).
- Keeps behavior operator-visible via confirmation output.

## Gaps to fix before implementation

### 1) Running-engine behavior is underspecified and currently unsafe
**Severity:** High

Plan says: “No engine IPC needed — supervisor calls `orch_resume` after retry.”

Problem:
- Engine runs in a separate child process (`startBatchInWorker` + `engine-worker.ts`).
- The child does **not** currently ingest retry/skip messages (only `pause`/`resume`/`abort` in `WorkerInMessage`).
- Engine does not continuously reload `.pi/batch-state.json` for task lifecycle decisions; it uses in-process state and persists it.

Implication: mutating disk state while engine is active can be overwritten or ignored.

**Plan update required:**
- Either add an IPC contract for retry (plus worker-side handling), **or** explicitly gate `orch_retry_task` to non-running phases (`paused`/`failed`/`stopped`) and reject while `launching/executing/merging/planning`.
- If choosing “no IPC”, document this explicitly in tool behavior and response text.

---

### 2) Tool registration and schema work is missing from the plan text
**Severity:** Medium

Prompt Step 1 requires registering `orch_retry_task(taskId: string)` in `extension.ts`. The plan text does not mention registration details, prompt guidelines, or schema shape.

**Plan update required:** include explicit registration task (name, parameter schema, handler path).

---

### 3) Phase transition semantics need explicit rule
**Severity:** Medium

Plan says “adjust counters” but not the exact phase transition policy.

Given resume eligibility (`resume.ts`):
- `paused` is resumable without force
- `failed`/`stopped` require force

**Plan update required:** define deterministic phase behavior after retry (e.g., move terminal failure states to `paused`, or keep as-is and require force), and align user-facing message accordingly.

---

### 4) Reset field set should be explicit to avoid stale diagnostics
**Severity:** Medium

Plan currently says “reset task fields” but does not enumerate them.

**Plan update required:** explicitly clear at least:
- `status` → `pending`
- `exitReason` → ""
- `doneFileFound` → `false`
- `startedAt`/`endedAt` → `null`
- any failure artifacts (`exitDiagnostic`, partial-progress fields) if present

---

### 5) State root selection should match engine persistence root
**Severity:** Medium

Engine/resume persist state at `workspaceRoot ?? cwd`.

**Plan update required:** specify state root resolution consistent with that behavior (workspace-aware first), not just `ctx.cwd`.

---

## Recommended revised Step 1 plan (minimal)

1. Register `orch_retry_task` tool (`taskId: string`) in `extension.ts`.
2. Resolve `stateRoot` consistently with engine persistence (`workspaceRoot ?? repoRoot ?? ctx.cwd`).
3. Load persisted state; validate task exists and status is `failed` (or explicitly decide if `stalled` is included).
4. Reject operation if batch is actively running **unless** IPC retry path is implemented.
5. Apply deterministic retry mutation (field resets + failed counter decrement + phase rule).
6. Persist via existing atomic state save helper.
7. Sync in-memory summary state only when batch IDs match.
8. Return operator-facing confirmation with next action (`orch_resume` / `orch_resume(force=true)` depending on phase policy).

---

## Notes

- There are existing tool-registration tests that currently assume 6 orchestrator tools; those will need updating when Step 3 tests are added/adjusted.
- STATUS metadata should be consistent (it currently says both “Current Step: In Progress” and Step 1 checkboxes as complete).