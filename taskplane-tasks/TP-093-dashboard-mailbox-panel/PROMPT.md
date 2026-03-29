# Task: TP-093 - Dashboard Mailbox Panel

**Created:** 2026-03-28
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** New dashboard section reading from mailbox directory. Follows existing dashboard patterns (lane state, STATUS.md). No backend changes — pure dashboard server + client.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-093-dashboard-mailbox-panel/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Add a "Messages" section to the dashboard showing per-agent mailbox activity (Phase 5 of the agent-mailbox-steering spec). Displays sent, pending, delivered, and replied messages with timestamps, direction, type, and content preview. Reads from the `mailbox/{batchId}/` directory structure.

## Dependencies

- **Task:** TP-089 (mailbox core — directory structure and message format)
- **Task:** TP-091 (agent replies — outbox messages to display)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/agent-mailbox-steering.md` — directory structure, message format
- `dashboard/server.cjs` — existing data loading patterns (loadLaneStates, loadBatchState)
- `dashboard/public/app.js` — existing rendering patterns (lanes, STATUS.md)
- `dashboard/public/style.css` — existing theme/layout patterns

## Environment

- **Workspace:** `dashboard/`
- **Services required:** None

## File Scope

- `dashboard/server.cjs`
- `dashboard/public/app.js`
- `dashboard/public/style.css`
- `dashboard/public/index.html`

## Steps

### Step 0: Preflight

- [ ] Read mailbox directory structure from spec
- [ ] Read dashboard server data loading patterns
- [ ] Read dashboard client rendering patterns

### Step 1: Server-side mailbox data loading

- [ ] Add `loadMailboxData(stateRoot, batchId)` function to dashboard server
- [ ] Scan `mailbox/{batchId}/` for all session directories
- [ ] For each session: read inbox/ (pending), ack/ (delivered), outbox/ (agent replies)
- [ ] Return structured data: per-session message arrays with status
- [ ] Include in `buildDashboardState()` response

**Artifacts:**
- `dashboard/server.cjs` (modified)

### Step 2: Client-side Messages panel

- [ ] Add "MESSAGES" section to dashboard HTML (after MERGE AGENTS, before STATUS.MD)
- [ ] Render per-agent message table with columns: time, direction (→/←), type, content preview, status
- [ ] Direction indicators: `→ agent` for supervisor→agent, `← supervisor` for agent→supervisor
- [ ] Status badges: pending (yellow), delivered (green), replied (blue)
- [ ] Content preview truncated to ~100 chars with expand-on-click
- [ ] Empty state: "No messages" when mailbox is empty
- [ ] Style consistent with existing dashboard theme (dark/light mode)

**Artifacts:**
- `dashboard/public/app.js` (modified)
- `dashboard/public/style.css` (modified)
- `dashboard/public/index.html` (modified)

### Step 3: Testing & Verification

- [ ] Manual verification: send_agent_message → message appears in dashboard
- [ ] Manual verification: agent reply → reply appears in dashboard
- [ ] Manual verification: empty state renders correctly
- [ ] Manual verification: light mode and dark mode rendering
- [ ] Run full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Update spec status for Phase 5
- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/specifications/taskplane/agent-mailbox-steering.md` — mark Phase 5 as implemented

**Check If Affected:**
- `README.md` (if dashboard features are listed)

## Completion Criteria

- [ ] Dashboard shows "Messages" section with per-agent message activity
- [ ] Both directions (supervisor→agent, agent→supervisor) displayed
- [ ] Status indicators (pending/delivered/replied) work correctly
- [ ] Light and dark mode consistent
- [ ] All tests pass

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-093): complete Step N — description`
- **Bug fixes:** `fix(TP-093): description`
- **Tests:** `test(TP-093): description`
- **Hydration:** `hydrate: TP-093 expand Step N checkboxes`

## Do NOT

- Modify mailbox core logic (TP-089)
- Modify rpc-wrapper (TP-089)
- Skip testing

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
