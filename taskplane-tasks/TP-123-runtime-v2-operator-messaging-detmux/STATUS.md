# TP-123: Runtime V2 Operator Messaging De-TMUX — Status

**Current Step:** Step 4: Documentation & delivery
**Status:** ✅ Complete
**Last Updated:** 2026-04-02
**Review Level:** 2
**Review Counter:** 6
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight copy inventory
**Status:** ✅ Complete
- [x] List all user-facing strings containing `tmux` in extension + dashboard runtime files
- [x] Classify each as hint/status/diagnostic/compat-note
- [x] Log inventory in STATUS.md

### Step 1: Replace operator guidance strings
**Status:** ✅ Complete
- [x] Replace `tmux attach ...` hints with Runtime V2 guidance
- [x] Update "TMUX sessions" wording to backend-neutral terminology
- [x] Keep historical migration context only where needed

### Step 2: Dashboard label cleanup
**Status:** ✅ Complete
- [x] Update dashboard labels/tooltips that imply tmux is active
- [x] Preserve compatibility behavior for data shape fields
- [x] Ensure merge/lane liveness indicators still render correctly

### Step 3: Tests
**Status:** ✅ Complete
- [x] Update/extend tests asserting old TMUX wording
- [x] Run full extension suite
- [x] Fix failures

### Step 4: Documentation & delivery
**Status:** ✅ Complete
- [x] Update migration docs with messaging changes
- [x] Record before/after inventory in STATUS.md

---

## Step 0 Inventory (Pre-change)

| File | Line(s) | User-facing string containing `tmux`/`TMUX` | Classification |
|------|---------|---------------------------------------------|----------------|
| `extensions/taskplane/formatting.ts` | 422 | ``tmux attach -t ${aliveLane.sessionName}`` | Hint text |
| `extensions/taskplane/messages.ts` | 81 | `No orchestrator TMUX sessions found.` | Status label |
| `extensions/taskplane/extension.ts` | 1647 | `⚠️ Runtime V2 is now the default backend. \`spawn_mode: tmux\` is deprecated and kept only for legacy compatibility.` | Legacy compatibility note |
| `extensions/taskplane/extension.ts` | 1651 | `ℹ️ Runtime V2 is the default backend (TMUX is legacy-only).` | Legacy compatibility note |
| `extensions/taskplane/extension.ts` | 4625 | ``Runtime: V2 default (configured spawn_mode: ${orchConfig.orchestrator.spawn_mode}; tmux is legacy-only)`` | Legacy compatibility note |
| `extensions/taskplane/worktree.ts` | 1713 | `spawn_mode: tmux is legacy-only under Runtime V2; subprocess backend will be used` | Diagnostic message |
| `extensions/taskplane/worktree.ts` | 1714 | `Runtime V2 subprocess backend active (TMUX not required)` | Diagnostic message |
| `dashboard/public/app.js` | 164 | ``tmux attach -t ${sessionName}`` (copy-to-clipboard attach command) | Hint text |
| `dashboard/public/app.js` | 523 | ``tmux attach -t ${laneSessionId}`` (lane attach command chip) | Hint text |
| `dashboard/public/app.js` | 537 | `tmux alive` / `tmux dead` (lane liveness tooltip) | Status label |
| `dashboard/public/app.js` | 859 | ``tmux attach -t ${effectiveSession}`` (merge row attach command chip) | Hint text |
| `dashboard/public/app.js` | 898 | ``tmux attach -t ${sess}`` (active merge session attach command chip) | Hint text |

## Step 4 Inventory (Post-change)

**Before:** 12 user-facing `tmux`/`TMUX` strings across extension + dashboard surfaces.

**After:** 3 user-facing compatibility/diagnostic strings remain (no `tmux attach` hints, no dashboard tmux-liveness labels).

| File | Line(s) | Remaining user-facing `tmux`/`TMUX` string | Classification | Disposition |
|------|---------|---------------------------------------------|----------------|-------------|
| `extensions/taskplane/extension.ts` | 1647 | `⚠️ Runtime V2 is now the default backend. \`spawn_mode: tmux\` is deprecated and kept only for legacy compatibility.` | Legacy compatibility note | Kept intentionally for explicit legacy config warning |
| `extensions/taskplane/extension.ts` | 4625 | ``Runtime: V2 default (configured spawn_mode: ${orchConfig.orchestrator.spawn_mode}${orchConfig.orchestrator.spawn_mode === "tmux" ? "; legacy compatibility mode" : ""})`` | Legacy compatibility note | Kept; only surfaces `tmux` when config is actually set to legacy mode |
| `extensions/taskplane/worktree.ts` | 1713 | `spawn_mode: tmux is legacy-only under Runtime V2; subprocess backend will be used` | Diagnostic message | Kept intentionally in preflight diagnostics for migration safety |

## Execution Log

| Timestamp | Action | Outcome |
| 2026-04-02 20:38 | Task started | Runtime V2 lane-runner execution |
| 2026-04-02 20:38 | Step 0 started | Preflight copy inventory |
|-----------|--------|---------|
| 2026-04-02 20:41 | Review R001 | plan Step 1: APPROVE |
| 2026-04-02 20:44 | Review R002 | code Step 1: APPROVE |
| 2026-04-02 20:45 | Review R003 | plan Step 2: APPROVE |
| 2026-04-02 20:47 | Review R004 | code Step 2: APPROVE |
| 2026-04-02 20:48 | Review R005 | plan Step 3: APPROVE |
| 2026-04-02 20:54 | Review R006 | code Step 3: APPROVE |
| 2026-04-02 20:57 | Agent reply | TP-123 completed end-to-end. /  / Completed steps 0-4 in order, with Review Level 2 protocol: / - Plan/code reviews approved for Steps 1-3 (R001-R006). / - STATUS.md fully checked, Step 4 marked compl |
| 2026-04-02 20:57 | Worker iter 1 | done in 1085s, tools: 118 |
| 2026-04-02 20:57 | Task complete | .DONE created |
