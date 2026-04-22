# Task: TP-049 - Orchestrator RPC Telemetry for All Agent Types

**Created:** 2026-03-23
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Modifies agent spawn paths across three files. High blast radius (affects every orch batch execution). Pattern is well-established from `/task` mode — adapting, not inventing. No security changes.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-049-orch-rpc-telemetry/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Route all orchestrator agent sessions through the RPC wrapper (`bin/rpc-wrapper.mjs`)
so that structured telemetry (JSONL sidecar + exit summary) is produced for every
agent type. Currently only `/task` mode uses the RPC wrapper — `/orch` lane workers,
reviewers, and merge agents all spawn `pi --no-session` directly, producing zero
telemetry files. The dashboard already has infrastructure to consume
`.pi/telemetry/*.jsonl` files but never receives any during `/orch` batches.

**Issue:** #139

## Dependencies

- **None** (the RPC wrapper and dashboard telemetry consumer already exist)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/task-runner.ts` — reference implementation of `spawnAgentTmux()` (line ~1534). This is the pattern to replicate. It spawns `node rpc-wrapper.mjs` instead of `pi` directly, produces sidecar JSONL and exit summary, and has `onTelemetry` callback for real-time accumulation.
- `extensions/taskplane/execution.ts` — `buildTmuxSpawnArgs()` (line ~246) spawns lane workers. This is the primary target.
- `extensions/taskplane/merge.ts` — `spawnMergeAgent()` (line ~356) spawns merge agents in tmux sessions.
- `bin/rpc-wrapper.mjs` — the wrapper script. Understand its CLI args: `--sidecar-path`, `--exit-summary-path`, model, tools, system prompt, prompt.
- `dashboard/server.cjs` — `loadTelemetryData()` (line ~341) and `parseTelemetryFilename()` (line ~240). The dashboard already knows how to read telemetry files — verify the naming convention matches.

## Environment

- **Workspace:** `extensions/`, `dashboard/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/execution.ts`
- `extensions/taskplane/merge.ts`
- `extensions/task-runner.ts` (reviewer spawn — minor change)
- `dashboard/server.cjs` (may need filename parsing updates)
- `dashboard/public/app.js` (may need telemetry display updates)
- `extensions/tests/*` (new or modified test files)

## Steps

### Step 0: Preflight

- [ ] Read `spawnAgentTmux()` in `task-runner.ts` (~line 1534) — understand the full pattern: telemetry path generation, rpc-wrapper CLI args, sidecar tailing, exit summary reading
- [ ] Read `buildTmuxSpawnArgs()` in `execution.ts` (~line 246) — understand current lane spawn
- [ ] Read `spawnMergeAgent()` in `merge.ts` (~line 356) — understand current merge spawn
- [ ] Read `parseTelemetryFilename()` in `dashboard/server.cjs` (~line 240) — understand what naming convention the dashboard expects
- [ ] Read `bin/rpc-wrapper.mjs` CLI interface — understand required args
- [ ] Verify `resolveRpcWrapperPath()` in `task-runner.ts` — understand how to find the wrapper

### Step 1: Route lane worker spawns through RPC wrapper

Update `buildTmuxSpawnArgs()` in `execution.ts` to spawn `node rpc-wrapper.mjs`
instead of `pi --no-session -e task-runner.ts` directly.

Key considerations:
- The lane worker still needs to load the task-runner extension (`-e task-runner.ts`)
- The RPC wrapper needs `--sidecar-path` and `--exit-summary-path` arguments
- Telemetry file naming should follow the pattern the dashboard expects:
  `{opId}-{batchId}-lane-{N}-worker.jsonl` (or similar)
- The telemetry directory is `.pi/telemetry/` (create if it doesn't exist)
- `resolveRpcWrapperPath()` from `task-runner.ts` needs to be accessible from
  `execution.ts` — either export it or duplicate the resolution logic
- The env vars (TASK_AUTOSTART, TASK_RUNNER_SPAWN_MODE, etc.) still need to be passed

The command structure changes from:
```
cd <worktree> && ENV_VARS pi --no-session -e task-runner.ts
```
To:
```
cd <worktree> && ENV_VARS node <rpc-wrapper-path> --sidecar-path <path> --exit-summary-path <path> -e task-runner.ts
```

**Artifacts:**
- `extensions/taskplane/execution.ts` (modified)

### Step 2: Route merge agent spawns through RPC wrapper

Update `spawnMergeAgent()` in `merge.ts` to spawn via the RPC wrapper.

The merge agent currently uses:
```
pi --no-session --append-system-prompt <system-prompt> -p <prompt>
```

Change to:
```
node <rpc-wrapper-path> --sidecar-path <path> --exit-summary-path <path> --append-system-prompt <system-prompt> -p <prompt>
```

Telemetry filename: `{opId}-{batchId}-merge-w{waveN}-lane-{N}.jsonl` (or similar
pattern matching what the dashboard's `parseTelemetryFilename()` expects).

**Artifacts:**
- `extensions/taskplane/merge.ts` (modified)

### Step 3: Route reviewer spawns through RPC wrapper (tmux mode)

The reviewer in `task-runner.ts` already uses `spawnAgentTmux()` when in tmux
mode, which goes through the RPC wrapper. Verify this is working correctly and
that reviewer telemetry files are produced with a recognizable naming pattern.

If the reviewer in tmux mode does NOT go through the RPC wrapper (check the
`doReview` function around line ~2540), update it to match the worker pattern.

**Artifacts:**
- `extensions/task-runner.ts` (verify or modify reviewer spawn in `doReview`)

### Step 4: Ensure dashboard consumes all telemetry sources

Verify that `parseTelemetryFilename()` in `dashboard/server.cjs` can parse the
filenames produced by Steps 1-3. Update the parser if the naming convention for
merge or reviewer telemetry doesn't match.

Verify that the dashboard UI (`app.js`) displays telemetry for:
- Lane workers (tokens, cost, context%, tools)
- Merge agents (tokens, cost)
- Reviewers (tokens, cost) — if visible per-lane

If the dashboard currently only shows worker telemetry, extend it to show
merge and reviewer metrics too (at minimum in the batch summary view).

**Artifacts:**
- `dashboard/server.cjs` (modify if filename parsing needs updates)
- `dashboard/public/app.js` (modify if UI needs telemetry display updates)

### Step 5: Testing & Verification

> ZERO test failures allowed.

- [ ] Run tests: `cd extensions && npx vitest run`
- [ ] Verify all existing tests pass
- [ ] Add tests for: lane spawn command includes rpc-wrapper path and sidecar args
- [ ] Add tests for: merge spawn command includes rpc-wrapper path and sidecar args
- [ ] Add tests for: telemetry filename generation follows expected pattern
- [ ] Add tests for: dashboard filename parser handles worker, merger, reviewer files

### Step 6: Documentation & Delivery

- [ ] Update any docs that describe the spawn architecture
- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None required (internal plumbing change)

**Check If Affected:**
- `docs/explanation/architecture.md` — if it describes the spawn model
- `docs/how-to/use-tmux-for-visibility.md` — if it references session names

## Completion Criteria

- [ ] Lane workers produce `.pi/telemetry/*.jsonl` sidecar files during `/orch` batches
- [ ] Merge agents produce `.pi/telemetry/*.jsonl` sidecar files
- [ ] Reviewer agents produce `.pi/telemetry/*.jsonl` sidecar files (tmux mode)
- [ ] Dashboard shows telemetry (tokens, cost, context%) from all agent types
- [ ] Exit summaries (`*-exit.json`) produced for all agent types
- [ ] All tests passing (existing + new)
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-049): complete Step N — description`
- **Bug fixes:** `fix(TP-049): description`
- **Tests:** `test(TP-049): description`
- **Hydration:** `hydrate: TP-049 expand Step N checkboxes`

## Do NOT

- Change the RPC wrapper itself (`bin/rpc-wrapper.mjs`)
- Change the telemetry JSONL event format
- Modify the task-runner's `/task` mode spawn path (it already works)
- Change dashboard layout or add new panels (just wire existing telemetry display)
- Remove the lane-state sidecar (`lane-state-*.json`) — it's a fallback/complement, not replaced by RPC telemetry

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
