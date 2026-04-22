# Task: TP-044 — Dashboard Supervisor Panel

**Created:** 2026-03-21
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** Frontend-only changes to dashboard. Reads from supervisor files that already exist. No backend logic changes.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-044-dashboard-supervisor-panel/
├── PROMPT.md   ← This file
├── STATUS.md   ← Execution state
├── .reviews/   ← Reviewer output
└── .DONE       ← Created when complete
```

## Mission

Add a supervisor panel to the Taskplane dashboard showing supervisor status,
conversation history, and recovery actions. Transparency is a core Taskplane
differentiator — operators should see what the supervisor is doing and has done,
even when viewing the dashboard from a different window or device.

The dashboard already shows wave progress, lane status, and task details. The
supervisor panel adds:
- Supervisor status (active/inactive, autonomy level, current activity)
- Conversation history (operator ↔ supervisor messages)
- Recovery action timeline (from audit trail)
- Batch summary (when available)

## Dependencies

- **Task:** TP-041 (supervisor agent must exist and produce the files this task reads)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/watchdog-and-recovery-tiers.md` — Sections 9.1-9.2, 13.7
- `dashboard/server.cjs` — current dashboard server
- `dashboard/public/app.js` — current dashboard frontend

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

- [ ] Read current dashboard architecture (server data flow, SSE updates, frontend rendering)
- [ ] Read supervisor file formats: `lock.json`, `actions.jsonl`, `events.jsonl`, `summary.md`
- [ ] Read spec Sections 9.1-9.2 and 13.7

### Step 1: Dashboard Server — Serve Supervisor Data

- [ ] Read supervisor lockfile for status (active/inactive, autonomy level)
- [ ] Tail `actions.jsonl` for recovery action timeline
- [ ] Read `events.jsonl` for engine events with supervisor context
- [ ] Read batch summary file when available
- [ ] Include supervisor data in SSE status updates alongside existing wave/lane data
- [ ] Handle missing supervisor files gracefully (pre-supervisor batches)

**Artifacts:**
- `dashboard/server.cjs` (modified)

### Step 2: Dashboard Frontend — Supervisor Panel

- [ ] Add supervisor status indicator: active/inactive badge with autonomy level
- [ ] Add recovery action timeline: chronological list of Tier 0 and supervisor actions with timestamps and outcomes
- [ ] Add batch summary section: rendered from summary.md when available (post-batch)
- [ ] Style to integrate with existing dashboard aesthetic — panel/tab, not dominating the wave view
- [ ] Degrade gracefully: hide supervisor panel entirely for pre-supervisor batches

**Artifacts:**
- `dashboard/public/app.js` (modified)
- `dashboard/public/style.css` (modified)
- `dashboard/public/index.html` (modified if needed)

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Manual test: dashboard renders supervisor panel with mock supervisor files
- [ ] Manual test: dashboard works without supervisor files (graceful degradation)
- [ ] No JS errors in browser console
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Verify dashboard loads: `node --check dashboard/server.cjs`

### Step 4: Documentation & Delivery

- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (dashboard is self-documenting via UI)

**Check If Affected:**
- `docs/tutorials/use-the-dashboard.md` — if supervisor panel should be mentioned

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Dashboard shows supervisor status, action timeline, and batch summary
- [ ] Graceful degradation for pre-supervisor batches
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-044): complete Step N — description`
- **Bug fixes:** `fix(TP-044): description`
- **Tests:** `test(TP-044): description`
- **Hydration:** `hydrate: TP-044 expand Step N checkboxes`

## Do NOT

- Modify supervisor agent code (that's TP-041)
- Modify engine or extension code
- Add heavy dependencies to the dashboard
- Remove existing dashboard functionality

---

## Amendments (Added During Execution)
