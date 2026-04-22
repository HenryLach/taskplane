# Task: TP-045 — Dashboard Wave Progress Bar Color Fix

**Created:** 2026-03-23
**Size:** S
**GitHub Issue:** #101

## Review Level: 1 (Plan Only)

**Assessment:** CSS/JS-only fix in dashboard frontend. No backend or extension changes. Visual bug with clear reproduction steps.
**Score:** 1/8 — Blast radius: 0, Pattern novelty: 0, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-045-dashboard-wave-bar-color/
├── PROMPT.md   ← This file
├── STATUS.md   ← Execution state
├── .reviews/   ← Reviewer output
└── .DONE       ← Created when complete
```

## Mission

Fix the wave completion progress bar in the dashboard so that completed wave
segments render as **green** instead of black/dark. The wave pill badges below
the bar already show correct colors — the data is right, just the progress bar
segment coloring is wrong.

## Dependencies

None.

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `dashboard/public/app.js` — wave progress bar rendering
- `dashboard/public/style.css` — bar segment styling
- `dashboard/server.cjs` — SSE data shape (batch state with wavePlan + mergeResults)

## Environment

- **Workspace:** `dashboard/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `dashboard/public/app.js`
- `dashboard/public/style.css`

## Steps

### Step 0: Preflight

- [ ] Read `dashboard/public/app.js` — find the wave progress bar rendering function
- [ ] Read `dashboard/public/style.css` — find wave-bar segment color classes
- [ ] Understand how wave status (completed/executing/pending) maps to CSS classes
- [ ] Reproduce: check how `mergeResults` and `currentWaveIndex` determine completed waves

### Step 1: Fix Wave Bar Segment Coloring

- [ ] Identify why completed wave segments get black/no-color instead of green
- [ ] Fix the status→class mapping so completed waves get the green/success class
- [ ] Verify executing wave gets the active/cyan class
- [ ] Verify pending waves get the default/muted class

**Artifacts:**
- `dashboard/public/app.js` (modified)
- `dashboard/public/style.css` (modified, if needed)

### Step 2: Testing & Verification

- [ ] `node --check dashboard/server.cjs` — no syntax errors
- [ ] `node --check dashboard/public/app.js` — no syntax errors
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 3: Documentation & Delivery

- [ ] `.DONE` created in this folder

## Documentation Requirements

None — visual fix only.

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Completed wave segments render green in the progress bar
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `fix(TP-045): complete Step N — description`
- **Bug fixes:** `fix(TP-045): description`

## Do NOT

- Change the dashboard server data shape
- Modify extension or engine code
- Add new dependencies

---

## Amendments (Added During Execution)
