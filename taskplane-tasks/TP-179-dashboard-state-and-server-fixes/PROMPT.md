# Task: TP-179 - Dashboard State and Server Fixes

**Created:** 2026-04-13
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** Server-side fixes for batch state lifecycle and supervisor action display. Low blast radius, focused on server.cjs and the integration cleanup path.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-179-dashboard-state-and-server-fixes/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Fix two dashboard server-side issues: (1) `orch-integrate` doesn't write `integratedAt` to batch state or history, so the dashboard never transitions completed batches to history view in workspace mode (#499), and (2) supervisor recovery actions in the dashboard show unhelpful short titles without the `context`/`detail` fields from the JSONL entries (#497).

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `dashboard/server.cjs` — API endpoints and data serving
- `extensions/taskplane/extension.ts` — `performCleanup()` and `executeIntegration()`
- `extensions/taskplane/persistence.ts` — batch history save/load

## Environment

- **Workspace:** `dashboard/`, `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/extension.ts`
- `extensions/taskplane/persistence.ts`
- `dashboard/server.cjs`
- `dashboard/public/app.js`
- `extensions/tests/orch-integrate*.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read `performCleanup()` in extension.ts — understand why `integratedAt` is never written
- [ ] Read `saveBatchHistory()` in persistence.ts — understand the batch history format
- [ ] Read `server.cjs` — how supervisor actions are served to the dashboard
- [ ] Read `app.js` — how recovery actions are rendered (what fields are displayed)

### Step 1: Fix integratedAt lifecycle (#499)

Before deleting batch-state.json in `performCleanup()`:
- [ ] Load the current batch state
- [ ] Set `integratedAt = Date.now()` and `phase = "integrated"`
- [ ] Update the corresponding entry in batch-history.json with the integration timestamp
- [ ] Then delete batch-state.json (existing behavior)
- [ ] Handle workspace mode: batch-state.json lives at workspace root, ensure it's updated before any per-repo cleanup
- [ ] Run targeted tests: `tests/orch-integrate*.test.ts`

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified — `performCleanup`)
- `extensions/taskplane/persistence.ts` (modified — add `updateBatchHistoryIntegration` function)

### Step 2: Add description column to supervisor recovery actions (#497)

The supervisor actions JSONL entries already contain `context` and `detail` fields. The dashboard needs to display them.

- [ ] In `server.cjs`: include `context` and `detail` fields in the API response for supervisor actions (if not already included)
- [ ] In `app.js`: add a description column to the recovery actions table that shows the `context` or `detail` field
- [ ] Truncate long descriptions with ellipsis (max ~100 chars in the table, full text on hover/expand)
- [ ] Verify: supervisor actions show meaningful descriptions

**Artifacts:**
- `dashboard/server.cjs` (modified)
- `dashboard/public/app.js` (modified)

### Step 3: Testing & Verification

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures
- [ ] Add test: `performCleanup` writes `integratedAt` before deleting batch state
- [ ] Add test: batch history entry includes `integratedAt` after integration
- [ ] Manual testing: run a batch, integrate, verify dashboard transitions to history

### Step 4: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- None

**Check If Affected:**
- `docs/tutorials/use-the-dashboard.md` — if supervisor actions display is documented

## Completion Criteria

- [ ] Dashboard transitions to history view after orch-integrate (both mono-repo and workspace)
- [ ] Supervisor recovery actions show context/detail descriptions
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `fix(TP-179): complete Step N — description`
- **Hydration:** `hydrate: TP-179 expand Step N checkboxes`

## Do NOT

- Change the integration merge logic (only the cleanup/state lifecycle)
- Modify the supervisor action JSONL format (only the display of existing fields)
- Skip tests
- Commit without the task ID prefix

---

## Amendments (Added During Execution)

