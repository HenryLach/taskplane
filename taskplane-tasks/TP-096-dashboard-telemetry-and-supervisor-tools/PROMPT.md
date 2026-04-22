# Task: TP-096 - Dashboard Telemetry Completeness and Supervisor Recovery Tools

**Created:** 2026-03-29
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds merge agent telemetry to dashboard (#328) and four new supervisor tools for autonomous diagnosis and recovery. Dashboard server + supervisor extension changes.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 1, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-096-dashboard-telemetry-and-supervisor-tools/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Two goals:

1. **Merge agent telemetry in dashboard (#328):** The dashboard's MERGE AGENTS section shows only session names. Add full telemetry parity with workers/reviewers: tool calls, tokens, cost, context %, elapsed time, current tool. The sidecar data already exists — the dashboard just doesn't read it.

2. **Supervisor recovery tools:** Add four tools that the supervisor currently lacks for autonomous diagnosis and recovery:
   - `read_agent_status(lane?)` — Read STATUS.md + context % + cost from a running agent's worktree
   - `trigger_wrap_up(lane)` — Write the `.task-wrap-up` signal file for a specific lane
   - `read_lane_logs(lane)` — Read stderr/crash logs for a specific lane
   - `list_active_agents()` — Show all tmux sessions with role, lane, task, context %, elapsed

## Dependencies

- **Task:** TP-094 (context % accuracy — supervisor tools need correct data)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `dashboard/server.cjs` — existing telemetry loading (loadLaneStates, loadTelemetryData)
- `dashboard/public/app.js` — merge agents section rendering
- `extensions/taskplane/supervisor.ts` — existing tool registration pattern

## Environment

- **Workspace:** `dashboard/`, `extensions/taskplane/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `dashboard/server.cjs`
- `dashboard/public/app.js`
- `dashboard/public/style.css`
- `extensions/taskplane/supervisor.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/orch-supervisor-tools.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read dashboard merge agents section and telemetry loading
- [ ] Read supervisor tool registration pattern
- [ ] Read sidecar tailing code to understand available telemetry fields

### Step 1: Merge agent telemetry in dashboard (#328)

- [ ] Dashboard server: read merge agent sidecar JSONL files (same tailing pattern as worker/reviewer)
- [ ] Extract: tool count, last tool, input/output/cache tokens, cost, context %, elapsed
- [ ] Dashboard client: render merge agent telemetry in MERGE AGENTS section
- [ ] Show status (running/done/error), tool count, cost, elapsed, current tool
- [ ] Dark/light mode consistent

**Artifacts:**
- `dashboard/server.cjs` (modified)
- `dashboard/public/app.js` (modified)
- `dashboard/public/style.css` (modified if needed)

### Step 2: read_agent_status supervisor tool

- [ ] Register `read_agent_status(lane?)` tool
- [ ] Read STATUS.md from the lane's worktree — extract current step, checked/total items, step statuses
- [ ] Read lane-state JSON for context %, cost, tool count, elapsed
- [ ] If lane not specified, return status for all active lanes
- [ ] Return formatted summary

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (modified)

### Step 3: trigger_wrap_up supervisor tool

- [ ] Register `trigger_wrap_up(lane)` tool
- [ ] Write `.task-wrap-up` file in the correct task folder within the lane worktree
- [ ] Resolve task folder from batch state (current task for the lane)
- [ ] Return confirmation with the file path written
- [ ] Validate lane exists and has a running worker

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (modified)

### Step 4: read_lane_logs and list_active_agents supervisor tools

- [ ] Register `read_lane_logs(lane)` tool — reads stderr log from `.pi/telemetry/{batchId}-lane-{N}-stderr.log` (requires TP-095)
- [ ] Falls back gracefully when stderr log doesn't exist (older batches)
- [ ] Register `list_active_agents()` tool — lists all tmux sessions, extracts role/lane/task from session name pattern, includes context % and elapsed from lane-state
- [ ] Return formatted table

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (modified)

### Step 5: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: read_agent_status returns correct step and telemetry info
- [ ] Test: trigger_wrap_up writes correct file in correct location
- [ ] Test: list_active_agents parses session names correctly
- [ ] Test: read_lane_logs handles missing log gracefully
- [ ] Run full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 6: Documentation & Delivery

- [ ] Update supervisor-primer.md with new tool descriptions
- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- `extensions/taskplane/supervisor-primer.md` — add new tool descriptions to supervisor capabilities

**Check If Affected:**
- `docs/reference/commands.md`

## Completion Criteria

- [ ] Dashboard shows full merge agent telemetry (parity with workers)
- [ ] Supervisor can read agent status, trigger wrap-up, read logs, and list agents
- [ ] All tests pass

## Git Commit Convention

- **Step completion:** `feat(TP-096): complete Step N — description`
- **Bug fixes:** `fix(TP-096): description`

## Do NOT

- Modify context pressure logic (TP-094)
- Modify spawn/crash recovery (TP-095)
- Skip full-suite tests

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
