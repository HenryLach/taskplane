# TP-123: Runtime V2 Operator Messaging De-TMUX — Status

**Current Step:** Step 1: Replace operator guidance strings
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-02
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight copy inventory
**Status:** ✅ Complete
- [x] List all user-facing strings containing `tmux` in extension + dashboard runtime files
- [x] Classify each as hint/status/diagnostic/compat-note
- [x] Log inventory in STATUS.md

### Step 1: Replace operator guidance strings
**Status:** 🟨 In Progress
- [ ] Replace `tmux attach ...` hints with Runtime V2 guidance
- [ ] Update "TMUX sessions" wording to backend-neutral terminology
- [ ] Keep historical migration context only where needed

### Step 2: Dashboard label cleanup
**Status:** ⬜ Not Started
- [ ] Update dashboard labels/tooltips that imply tmux is active
- [ ] Preserve compatibility behavior for data shape fields
- [ ] Ensure merge/lane liveness indicators still render correctly

### Step 3: Tests
**Status:** ⬜ Not Started
- [ ] Update/extend tests asserting old TMUX wording
- [ ] Run full extension suite
- [ ] Fix failures

### Step 4: Documentation & delivery
**Status:** ⬜ Not Started
- [ ] Update migration docs with messaging changes
- [ ] Record before/after inventory in STATUS.md

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

## Execution Log

| Timestamp | Action | Outcome |
| 2026-04-02 20:38 | Task started | Runtime V2 lane-runner execution |
| 2026-04-02 20:38 | Step 0 started | Preflight copy inventory |
|-----------|--------|---------|
