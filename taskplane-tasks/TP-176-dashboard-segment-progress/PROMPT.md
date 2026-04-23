# Task: TP-176 - Dashboard Segment-Scoped Progress

**Created:** 2026-04-12
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Dashboard-only change. No runtime or execution logic modified. Low risk.
**Score:** 1/8 — Blast radius: 0, Pattern novelty: 1, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-176-dashboard-segment-progress/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Update the dashboard to show segment-scoped progress for multi-segment tasks. The 👁 STATUS.md viewer should show only the current segment's checkbox block (not the full STATUS.md), and the progress bar should reflect segment-scoped checked/total counts.

**Reference specification:** `docs/specifications/taskplane/segment-aware-steps.md` (section A.8)

## Dependencies

- **Task:** TP-174 (sidecar telemetry must report segment-scoped progress)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/segment-aware-steps.md` — section A.8
- `dashboard/public/app.js` — current dashboard rendering
- `dashboard/server.cjs` — API endpoints

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
- `dashboard/server.cjs`

## Steps

### Step 0: Preflight

- [ ] Read dashboard/public/app.js — how STATUS.md viewer and progress bars render
- [ ] Read dashboard/server.cjs — how STATUS.md content and lane progress are served
- [ ] Understand how sidecar-telemetry data flows to the dashboard

### Step 1: Segment-Scoped STATUS.md Viewer

- [ ] When displaying a multi-segment task's STATUS.md, extract and show only the current segment's `#### Segment: <repoId>` block
- [ ] For single-segment tasks (no markers), show full STATUS.md as today
- [ ] The segment header should be visible as context (e.g., "Segment: shared-libs")

**Artifacts:**
- `dashboard/public/app.js` (modified)
- `dashboard/server.cjs` (modified if STATUS.md filtering is server-side)

### Step 2: Segment-Scoped Progress Bar

- [ ] Progress bar reflects segment-scoped checked/total from sidecar telemetry
- [ ] For succeeded tasks, show 100% regardless of sidecar state (fix for #491)
- [ ] For single-segment tasks, no behavior change

**Artifacts:**
- `dashboard/public/app.js` (modified)

### Step 3: Testing & Verification

- [ ] Manual testing with polyrepo workspace dashboard (port 8103)
- [ ] Verify segment-scoped viewer for multi-segment tasks
- [ ] Verify full STATUS.md for single-segment tasks
- [ ] Verify progress bar matches segment scope

### Step 4: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- None

**Check If Affected:**
- `docs/tutorials/use-the-dashboard.md` — if STATUS.md viewer behavior is documented

## Completion Criteria

- [ ] 👁 viewer shows segment-scoped checkboxes for multi-segment tasks
- [ ] Progress bar reflects segment-scoped counts
- [ ] Single-segment tasks unchanged
- [ ] Succeeded tasks show 100% (#491)

## Git Commit Convention

- **Step completion:** `feat(TP-176): complete Step N — description`

## Do NOT

- Modify runtime code (lane-runner, engine, sidecar)
- Change dashboard layout or add new panels
- Skip manual testing
- Commit without the task ID prefix

---

## Amendments (Added During Execution)

