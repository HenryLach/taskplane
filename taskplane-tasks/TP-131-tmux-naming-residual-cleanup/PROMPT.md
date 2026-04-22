# Task: TP-131 - TMUX Naming Residual Cleanup

**Created:** 2026-04-03
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Renaming fields, CSS classes, and cleaning comments. No behavioral changes. Low risk.
**Score:** 2/8 — Blast radius: 1 (dashboard, templates, comments), Pattern novelty: 0 (find-replace), Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-131-tmux-naming-residual-cleanup/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Clean up remaining TMUX naming artifacts across the published package. TP-128 removed all functional TMUX code (audit confirms `functionalUsage.count = 0`), but left behind TMUX-named fields, CSS classes, API shapes, and comments. This task finishes the cosmetic cleanup.

### Inventory (from Sage review of TP-128)

**Dashboard frontend (`dashboard/public/app.js`):**
- `tmuxSessions` variable and references — rename to `sessions` or remove
- `tmuxSet` variable — rename or remove
- TMUX-named fallback liveness logic and comments
- Any tmux-prefixed variable names

**Dashboard styles (`dashboard/public/style.css`):**
- `.tmux-*` CSS classes — rename to neutral names (e.g., `.session-*`)

**Dashboard server (`dashboard/server.cjs`):**
- `tmuxSessions` field in API response (lines ~1032, 1049, 1111)
- `getTmuxSessions()` stub function — remove or rename
- `/api/pane/*` no-op endpoint — remove entirely or rename
- `tmuxSessionName` compat field mapping (lines ~80-85) — keep but document as legacy compat
- "tmux prefix" comments (lines ~239, 241) — update wording

**Templates (`templates/config/task-runner.yaml`):**
- `spawn_mode: "tmux"` mention — remove TMUX option from comments
- `tmux_prefix` mention — remove or update

**Other shipped files:**
- `bin/rpc-wrapper.mjs` — TMUX wording in comments
- `extensions/task-orchestrator.ts` — comment "List active TMUX sessions"

**Audit script (`scripts/tmux-reference-audit.mjs`):**
- Add `skills/` to scan roots (it's a published directory)

## Environment

- **Workspace:** `extensions/taskplane/`, `dashboard/`, `bin/`
- **Services required:** None
- **Submodule workspace:** `.pi/git/github.com/loopyd/taskplane` (absolute: `/mnt/PROJECTS/repos/bof3-decomp/.pi/git/github.com/loopyd/taskplane`)


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## Dependencies

- None

## Context to Read First

- `taskplane-tasks/TP-128-full-package-tmux-extrication/STATUS.md` (completion summary)

## File Scope

- `dashboard/public/app.js`
- `dashboard/public/style.css`
- `dashboard/server.cjs`
- `templates/config/task-runner.yaml`
- `bin/rpc-wrapper.mjs`
- `extensions/task-orchestrator.ts`
- `scripts/tmux-reference-audit.mjs`
- `extensions/tests/tmux-reference-guard.test.ts`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Run `node scripts/tmux-reference-audit.mjs` and log baseline counts
- [ ] Grep for tmux across all files in scope and log inventory

### Step 1: Dashboard frontend cleanup
- [ ] Rename `tmuxSessions` → `sessions` in `dashboard/public/app.js`
- [ ] Rename `tmuxSet` → `sessionSet` or remove if unused
- [ ] Update TMUX-named liveness logic comments to V2 terminology
- [ ] Rename `.tmux-*` CSS classes in `dashboard/public/style.css`
- [ ] Update corresponding class references in `app.js` and `index.html`

### Step 2: Dashboard server cleanup
- [ ] Rename `tmuxSessions` → `sessions` in API response shape
- [ ] Remove or rename `getTmuxSessions()` stub
- [ ] Remove `/api/pane/*` no-op endpoint if unused, or rename
- [ ] Document `tmuxSessionName` compat mapping with clear legacy comment
- [ ] Update "tmux prefix" comments to neutral wording

### Step 3: Templates and other shipped files
- [ ] Remove TMUX option from `templates/config/task-runner.yaml` comments
- [ ] Clean TMUX wording in `bin/rpc-wrapper.mjs` comments
- [ ] Update "List active TMUX sessions" comment in `extensions/task-orchestrator.ts`

### Step 4: Audit script expansion
- [ ] Add `skills/` to `SCAN_ROOTS` in `scripts/tmux-reference-audit.mjs`
- [ ] Update guard test if scan root count assertion exists

### Step 5: Verification
- [ ] Run full test suite
- [ ] Fix any failures
- [ ] Run expanded audit script and log final counts
- [ ] Verify dashboard still loads and renders correctly (no broken CSS/JS)

## Do NOT

- Remove `tmux-compat.ts` (needed for legacy state migration)
- Remove `TASK_RUNNER_TMUX_PREFIX` env var reads (backward compat for older orchestrators)
- Remove the `tmuxSessionName` field read in persistence.ts (backward compat shim)
- Break the dashboard API contract for any active consumers — if `tmuxSessions` is read by dashboard clients, add `sessions` as the new field alongside temporarily

## Git Commit Convention

- `feat(TP-131): complete Step N — ...`
