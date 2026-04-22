# TP-119: Remove TMUX Abort Fallbacks — Status

**Current Step:** Step 5: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-04-02
**Review Level:** 2
**Review Counter:** 10
**Iteration:** 2
**Size:** S

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read PROMPT.md and STATUS.md
- [x] Inventory remaining TMUX helper call sites
- [x] Classify each call site
- [x] Log inventory in STATUS.md

### Step 1: Remove abort TMUX fallbacks
**Status:** ✅ Complete
- [x] abort.ts TMUX liveness polling in waitForSessionExit
- [x] abort.ts TMUX kill paths
- [x] execution.ts TMUX fallbacks in stop-all and stall kill
- [x] merge.ts dual kill paths

### Step 2: Remove resume TMUX fallbacks
**Status:** ✅ Complete
- [x] resume.ts TMUX reconnect paths
- [x] Ensure V2 reconnect is only path

### Step 3: Remove dead TMUX helpers
**Status:** ✅ Complete
- [x] Migrate engine.ts and extension.ts off tmuxHasSession/tmuxKillSession imports
- [x] Re-home tmuxAsync consumers (execution async wrappers + merge capture helper)
- [x] Remove tmuxHasSession, tmuxKillSession, tmuxAsync
- [x] Remove sessions.ts helpers
- [x] Remove TMUX imports
- [x] Derive lingering cleanup targets from Runtime V2 registry/handles (not currentLanes only)
- [x] Add cleanup-safe V2 lane kill path that does not depend on monitor cache
- [x] Ensure final cleanup kills actual merge agents (use merge IDs or kill-all)

### Step 4: Tests
**Status:** ✅ Complete
- [x] Update tests
- [x] Run full suite
- [x] Fix all failures

### Step 5: Documentation & Delivery
**Status:** ✅ Complete
- [x] Update STATUS.md
- [x] Update migration docs

---

## Preflight Inventory (TMUX helper call sites)

| Helper | File:line | Classification | Notes |
|---|---|---|---|
| `tmuxHasSession` | `extensions/taskplane/abort.ts:222` | abort fallback | Graceful abort wait loop checks TMUX session exit. |
| `tmuxKillSession` | `extensions/taskplane/abort.ts:258,269,270,274` | abort fallback | Abort cleanup kills lane/worker/reviewer TMUX sessions alongside V2 merge kill. |
| `tmuxKillSession` | `extensions/taskplane/execution.ts:266,267,269` via `killLaneAndChildren()` | abort fallback | Used by stop-all and stall termination on legacy lane sessions. |
| `tmuxHasSession`/`tmuxKillSession` | `extensions/taskplane/merge.ts:1767,1768` | abort fallback | Merge error cleanup keeps legacy TMUX kill branch in addition to V2 path. |
| `tmuxHasSession` | `extensions/taskplane/resume.ts:905` | legacy reconnect | Resume alive-session detection still has legacy TMUX liveness branch. |
| `tmuxKillSession` | `extensions/taskplane/engine.ts:2484` | other | Final cleanup of lingering TMUX sessions before worktree removal. |
| `tmuxHasSession` | `extensions/taskplane/extension.ts:3797,3801` | other | `send_agent_message` liveness fallback when registry entry/read fails. |
| `tmuxHasSession` | `extensions/taskplane/sessions.ts:65` | other | `/orch-sessions` status decoration uses TMUX liveness probe. |
| `tmuxHasSession`/`tmuxKillSession` | `extensions/taskplane/execution.ts:244,252` | other | Internal implementation of sync TMUX helpers (self-calls). |
| `tmuxAsync` | `extensions/taskplane/execution.ts:378,397,417` | other | Async TMUX helper consumers (`has/kill/capture` wrappers). |
| `tmuxAsync` | `extensions/taskplane/merge.ts:2591` | other | Async merge pane capture helper for health monitoring. |

## Notes

- R001 suggestion: after Step 1 edits, run a grep sweep on `abort.ts|execution.ts|merge.ts` for `tmuxHasSession|tmuxKillSession` to verify fallback branches are removed.
- R001 suggestion: run targeted abort/cleanup tests before Step 3 helper deletion.
- R006 suggestion: run post-edit grep for `tmuxHasSession|tmuxKillSession|tmuxAsync` usage/imports to verify only intended TMUX paths remain.
- R006 suggestion: remove unused `prefix` in `resume.ts` while touching TMUX cleanup scope.
- R008 suggestion: add focused regression coverage for final cleanup lingering-process behavior after removing TMUX fallbacks.
- Step 4 verification: added `14.8` coverage in `engine-runtime-v2-routing.test.ts` for registry-driven lingering-agent cleanup; full suite passed (3403 pass, 0 fail).
- Step 5 docs: updated `docs/specifications/framework/taskplane-runtime-v2/06-migration-and-rollout.md` with TP-119 (`Phase F.4`) to record TMUX fallback removal in Runtime V2 abort/resume/cleanup paths.

## Execution Log

| Timestamp | Action | Outcome |
| 2026-04-02 06:05 | Task started | Runtime V2 lane-runner execution |
| 2026-04-02 06:05 | Step 0 started | Preflight |
|-----------|--------|---------|
| 2026-04-02 06:08 | Review R001 | plan Step 1: REVISE |
| 2026-04-02 06:09 | Review R002 | plan Step 1: APPROVE |
| 2026-04-02 06:15 | Review R003 | code Step 1: APPROVE |
| 2026-04-02 06:16 | Review R004 | plan Step 2: APPROVE |
| 2026-04-02 06:19 | Review R005 | code Step 2: APPROVE |
| 2026-04-02 06:20 | Review R006 | plan Step 3: REVISE |
| 2026-04-02 06:22 | Review R007 | plan Step 3: APPROVE |
| 2026-04-02 06:31 | Review R008 | code Step 3: REVISE |
| 2026-04-02 06:35 | Worker iter 1 | killed (wall-clock timeout) in 1800s, tools: 179 |
| 2026-04-02 06:36 | Review R009 | plan Step 4: APPROVE |
| 2026-04-02 06:44 | Review R010 | code Step 4: APPROVE |
| 2026-04-02 06:46 | Agent reply | TP-119 complete in lane-1. /  / Completed remaining steps: / - Step 4 (Tests): added regression coverage (`engine-runtime-v2-routing.test.ts` test 14.8) for Runtime V2 lingering cleanup without TMUX f |
| 2026-04-02 06:46 | Worker iter 2 | done in 670s, tools: 53 |
| 2026-04-02 06:46 | Task complete | .DONE created |
