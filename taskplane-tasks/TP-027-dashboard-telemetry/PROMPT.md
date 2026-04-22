# Task: TP-027 — Dashboard Real-Time Telemetry

**Created:** 2026-03-19
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** Frontend changes to dashboard. Low blast radius, uses existing data plumbing patterns.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-027-dashboard-telemetry/
├── PROMPT.md   ← This file
├── STATUS.md   ← Execution state
├── .reviews/   ← Reviewer output
└── .DONE       ← Created when complete
```

## Mission

Update the Taskplane dashboard to display real-time telemetry from sidecar JSONL
files produced by the RPC wrapper (TP-025/026). Add per-lane token counts, cost,
context utilization %, last tool call, retry status, and batch total cost. Data
flows from sidecar files through the dashboard server to the frontend.

## Dependencies

- **Task:** TP-026 (task-runner must produce sidecar telemetry and make it available)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md` — Phase 1 section 1d
- `dashboard/server.cjs` — Current dashboard server
- `dashboard/public/app.js` — Current dashboard frontend
- `dashboard/public/style.css` — Dashboard styles

## Environment

- **Workspace:** `dashboard/`
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
- `dashboard/public/index.html`

## Steps

### Step 0: Preflight

- [ ] Read current dashboard server data flow (how lane status is served)
- [ ] Read current dashboard frontend (how lanes are rendered)
- [ ] Read roadmap Phase 1 section 1d (target metrics table)

### Step 1: Dashboard Server — Serve Telemetry Data

- [ ] Read sidecar JSONL files from `.pi/telemetry/` directory on each status poll
- [ ] Track read offset per file for incremental reads
- [ ] Accumulate per-lane telemetry: tokens (input/output/cache), cost, last tool call, retry count, compaction count
- [ ] Compute batch total cost across all lanes
- [ ] Include telemetry data in the status API response alongside existing lane/wave data
- [ ] Handle missing telemetry files gracefully (pre-RPC sessions have no sidecar)

**Artifacts:**
- `dashboard/server.cjs` (modified)

### Step 2: Dashboard Frontend — Display Telemetry

- [ ] Add telemetry column/section to lane display: tokens, cost, context %, last tool
- [ ] Add batch cost total to header/summary area
- [ ] Show retry indicator when auto_retry_start is active (clear on auto_retry_end)
- [ ] Show compaction count badge when > 0
- [ ] Style telemetry data to be secondary/compact (not dominate the lane progress view)
- [ ] Degrade gracefully: show "—" for lanes without telemetry data

**Artifacts:**
- `dashboard/public/app.js` (modified)
- `dashboard/public/style.css` (modified)
- `dashboard/public/index.html` (modified if needed)

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Manual test: start dashboard, verify telemetry columns render with mock data
- [ ] Verify no JS errors in browser console
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures
- [ ] Verify dashboard loads: `node --check dashboard/server.cjs`

### Step 4: Documentation & Delivery

- [ ] Update `docs/reference/commands.md` dashboard section if needed
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None required (dashboard is self-documenting via UI)

**Check If Affected:**
- `docs/reference/commands.md` — dashboard section

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Dashboard shows per-lane tokens, cost, context %
- [ ] Batch total cost displayed
- [ ] Graceful fallback for pre-RPC lanes
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-027): complete Step N — description`
- **Bug fixes:** `fix(TP-027): description`
- **Tests:** `test(TP-027): description`
- **Hydration:** `hydrate: TP-027 expand Step N checkboxes`

## Do NOT

- Modify task-runner.ts or rpc-wrapper.mjs (those are TP-025/026)
- Remove existing dashboard functionality
- Add heavy dependencies to the dashboard

---

## Amendments (Added During Execution)
