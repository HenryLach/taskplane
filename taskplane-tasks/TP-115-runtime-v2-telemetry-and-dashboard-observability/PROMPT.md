# Task: TP-115 - Runtime V2 Telemetry and Dashboard Observability

**Created:** 2026-04-01
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Fixes telemetry data flow gaps discovered during first Runtime V2 live execution (TP-114). Lane snapshots, dashboard live data, and batch summary cost reporting are all affected.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-115-runtime-v2-telemetry-and-dashboard-observability/
├── PROMPT.md
├── STATUS.md
└── .DONE
```

## Mission

Fix the telemetry and observability gaps discovered during the first Runtime V2 live run:

1. **Lane snapshot telemetry zeros** — lane-runner writes snapshot before agent-host returns telemetry, so worker stats are all zeros
2. **Dashboard empty during V2 runs** — dashboard SSE polling reads legacy lane-state files that V2 doesn't write
3. **Batch summary cost/token zeros** — supervisor summary reads from empty legacy telemetry path

## Dependencies

- **Task:** TP-108 (batch execution on V2)
- **Task:** TP-111 (conversation event fidelity)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/lane-runner.ts` — where lane snapshots are written
- `extensions/taskplane/execution.ts` — executeLaneV2 and monitor loop
- `dashboard/server.cjs` — buildDashboardState, loadLaneStates, loadRuntimeLaneSnapshots
- `dashboard/public/app.js` — renderLanesTasks, worker stats display

## Environment

- **Workspace:** `extensions/taskplane/`, `dashboard/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/lane-runner.ts`
- `extensions/taskplane/execution.ts`
- `dashboard/server.cjs`
- `dashboard/public/app.js`

## Steps

### Step 0: Preflight

- [ ] Verify lane snapshot zeros from TP-114 run artifacts
- [ ] Trace telemetry data flow: agent-host result → lane-runner → lane snapshot → dashboard

### Step 1: Lane Snapshot Telemetry

- [ ] After agent-host returns AgentHostResult, populate the lane snapshot worker fields from the result
- [ ] Write updated lane snapshot after worker exit with real telemetry
- [ ] Ensure dashboard can read the populated snapshot

### Step 2: Dashboard V2 Live Data

- [ ] Ensure buildDashboardState() returns V2 lane snapshots as usable data during execution
- [ ] Verify SSE polling picks up V2 runtime artifacts in real-time

### Step 3: Testing & Verification

- [ ] Run full suite
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- None

**Check If Affected:**
- `docs/specifications/framework/taskplane-runtime-v2/04-observability-and-dashboard.md`

## Completion Criteria

- [ ] Lane snapshots contain real worker telemetry (tokens, cost, tool count) after agent exit
- [ ] Dashboard shows live data during V2 batch execution
- [ ] Full suite passes

## Git Commit Convention

- `feat(TP-115): complete Step N — description`
- `fix(TP-115): description`

## Do NOT

- Change execution behavior — this is observability only
- Break legacy dashboard compatibility

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
