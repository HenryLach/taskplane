# R001 — Plan Review (Step 2: Update Extension to Spawn Worker)

## Verdict
**Changes requested** — the Step 2 direction is good, but the current plan has several contract-level gaps that are likely to cause regressions when `/orch` and `/orch-resume` are switched to worker mode.

## Reviewed artifacts
- `taskplane-tasks/TP-071-engine-worker-thread/PROMPT.md`
- `taskplane-tasks/TP-071-engine-worker-thread/STATUS.md`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/engine-worker.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/non-blocking-engine.test.ts`

## What’s solid
- Step 1 produced a concrete worker entrypoint with typed message contracts and serialization helpers (`engine-worker.ts`).
- Step 2 correctly targets a wrapper (`startBatchInWorker`) instead of inlining worker logic into command handlers.
- Tracking an `activeWorker` reference is the right primitive for follow-on lifecycle/control work.

## Blocking findings

### 1) Plan currently violates the fallback requirement
`PROMPT.md` explicitly says: **do not remove ability to run engine in main thread** (`PROMPT.md:221`).

But Step 2 checklist says to switch both `/orch` and `/orch-resume` to worker (`STATUS.md:33-34`) without describing fallback behavior.

**Required update:** Keep `startBatchAsync(...)` path intact and define deterministic fallback when worker spawn/setup fails (or worker runtime is unsupported).

---

### 2) Step ordering would break `/orch-pause` if Step 2 lands as written
`doOrchPause()` only mutates main-thread in-memory pause signal (`extension.ts:1807-1815`).
Worker execution reads a different pause signal inside worker-local `batchState` (`engine-worker.ts:191-205`).

If Step 2 switches starts/resumes to worker before bridging pause control, pause becomes ineffective.

**Required update:** Either:
1. Include minimal pause bridge in Step 2 (`activeWorker.postMessage({ type: "pause" })`), or
2. Keep main-thread engine execution until Step 3 is implemented in same change.

---

### 3) Terminal-path handling is under-specified and prone to duplicate completion flows
Worker can emit:
- `error` message + `complete` message (`engine-worker.ts:279-280`), and
- Worker process events `error` and `exit`.

Step 2 checklist currently says to handle both message-level terminal events and worker events (`STATUS.md:32`) but doesn’t define idempotency.

**Risk:** duplicate summary/integration/supervisor transitions.

**Required update:** Add a one-shot terminal settlement guard (e.g., `settled` flag) and document exact precedence (`complete` vs `exit` non-zero vs spawn error).

---

### 4) Message schema mismatch in plan vs worker implementation
Step 2 checklist references `batch-state-sync` (`STATUS.md:32`), but worker emits `state-sync` (`engine-worker.ts:31`, `225`, `231`).

**Required update:** Normalize names in plan before implementation (or update worker + extension together with a single canonical type table).

---

### 5) Worker path/runtime resolution needs explicit plan detail
Plan says “spawn Worker” but not how the script path is resolved in packaged ESM runtime.
There is already an established `import.meta.url` + fallback resolution pattern in `extension.ts` (`3077-3093`).

**Required update:** Specify exact worker creation strategy (URL/path resolution + module type) and failure behavior.

## Required plan edits before implementation
1. Add a fallback matrix: worker primary, main-thread `startBatchAsync` fallback.
2. Add pause-compat strategy for the Step 2/Step 3 boundary (no temporary pause regression).
3. Define terminal event idempotency contract.
4. Reconcile message names (`state-sync` vs `batch-state-sync`).
5. Specify worker script resolution strategy in ESM/package context.

## Non-blocking note
- Expect source-based tests to require updates once call sites stop directly using `startBatchAsync` (`extensions/tests/non-blocking-engine.test.ts` currently asserts that pattern). This is fine, but should be explicitly tracked for Step 5.
