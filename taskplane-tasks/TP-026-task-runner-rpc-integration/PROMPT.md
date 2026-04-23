# Task: TP-026 — Task-Runner RPC Wrapper Integration

**Created:** 2026-03-19
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Modifies core spawn path in task-runner. Affects worker/reviewer session lifecycle. Must preserve existing subprocess path.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-026-task-runner-rpc-integration/
├── PROMPT.md   ← This file
├── STATUS.md   ← Execution state
├── .reviews/   ← Reviewer output
└── .DONE       ← Created when complete
```

## Mission

Integrate the RPC wrapper (from TP-025) into the task-runner's tmux spawn path.
When `spawn_mode` is `tmux`, the task-runner should spawn `rpc-wrapper.mjs`
instead of `pi -p`, read sidecar telemetry during polling, and produce a
structured `TaskExitDiagnostic` after session exit. The `/orch` subprocess
worker path must not be changed.

This gives `/task` tmux mode full telemetry parity with subprocess mode:
exit codes, token counts, cost, context %, retry events, and structured
exit classification.

## Dependencies

- **Task:** TP-025 (RPC wrapper script and exit classification types must exist)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md` — Phase 1 sections 1c, 1f
- `extensions/task-runner.ts` — Current `spawnAgentTmux()` and poll loop
- `extensions/taskplane/diagnostics.ts` — Exit classification types (from TP-025)
- `bin/rpc-wrapper.mjs` — Wrapper script (from TP-025)

## Environment

- **Workspace:** `extensions/`
- **Services required:** tmux


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/task-runner.ts`
- `extensions/taskplane/diagnostics.ts`
- `extensions/tests/task-runner-rpc.test.ts` (new)

## Steps

### Step 0: Preflight

- [ ] Read `spawnAgentTmux()` in task-runner.ts — understand current tmux spawn flow
- [ ] Read poll loop (`pollUntilTaskComplete`) — understand how exit is detected
- [ ] Read TP-025 artifacts: `diagnostics.ts`, `rpc-wrapper.mjs`
- [ ] Verify RPC wrapper runs: `node bin/rpc-wrapper.mjs --help`

### Step 1: Update spawnAgentTmux to Use RPC Wrapper

- [ ] Generate sidecar and exit summary file paths using naming contract (include opId, batchId, repoId where available)
- [ ] Build `rpc-wrapper.mjs` command line with correct args (model, system-prompt-file, prompt-file, tools, sidecar-path, exit-summary-path, plus passthrough pi args)
- [ ] Resolve `rpc-wrapper.mjs` path from installed npm package (same pattern as `resolveTaskRunnerExtensionPath()`)
- [ ] Replace `pi -p` command in tmux `send-keys` with the rpc-wrapper command
- [ ] Ensure workspace-aware paths: sidecar files go to workspace `.pi/telemetry/` when `TASKPLANE_WORKSPACE_ROOT` is set

**Artifacts:**
- `extensions/task-runner.ts` (modified)

### Step 2: Read Sidecar Telemetry During Polling

- [ ] In the poll loop, tail new lines from sidecar JSONL file on each poll tick
- [ ] Track file read offset (byte position) to only read new events — O(new) per poll, not O(total)
- [ ] Parse `message_end` events to accumulate running token counts and cost
- [ ] Parse `auto_retry_start/end` events to detect active retries
- [ ] Make telemetry data available for dashboard updates (extend poll result or emit events)
- [ ] Handle missing/empty sidecar file gracefully (session hasn't started writing yet)

**Artifacts:**
- `extensions/task-runner.ts` (modified)

### Step 3: Produce Structured Exit Diagnostic

- [ ] After session exit, read exit summary JSON file
- [ ] Call `classifyExit()` with summary + `.DONE` existence
- [ ] Populate `TaskExitDiagnostic` in task outcome
- [ ] Add `exitDiagnostic` field additively to batch state task record (preserve legacy `exitReason` for compatibility)
- [ ] Clean up sidecar and exit summary files after reading (or leave for dashboard — configurable)

**Artifacts:**
- `extensions/task-runner.ts` (modified)
- `extensions/taskplane/diagnostics.ts` (modified if needed)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: spawnAgentTmux generates correct rpc-wrapper command with all args
- [ ] Test: sidecar tailing accumulates token counts correctly
- [ ] Test: exit summary is read and classified after session exit
- [ ] Test: missing exit summary (crash scenario) produces `session_vanished` classification
- [ ] Test: workspace mode uses workspace `.pi/telemetry/` path
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Update inline comments in spawnAgentTmux explaining RPC wrapper flow
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (architecture docs deferred to TP-027 alongside dashboard changes)

**Check If Affected:**
- `docs/explanation/architecture.md` — execution model description

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] `/task` tmux mode produces sidecar JSONL and exit summary
- [ ] Task outcomes include `exitDiagnostic` with correct classification
- [ ] `/orch` subprocess path unmodified
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-026): complete Step N — description`
- **Bug fixes:** `fix(TP-026): description`
- **Tests:** `test(TP-026): description`
- **Hydration:** `hydrate: TP-026 expand Step N checkboxes`

## Do NOT

- Modify the `/orch` subprocess spawn path (hardcoded `TASK_RUNNER_SPAWN_MODE: "subprocess"`)
- Modify the dashboard (that's TP-027)
- Delete sidecar/summary files before dashboard has read them (unless configured)
- Break existing `spawnAgent()` subprocess function

---

## Amendments (Added During Execution)
