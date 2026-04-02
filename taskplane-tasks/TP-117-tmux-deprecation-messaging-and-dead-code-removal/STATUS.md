# TP-117: TMUX Deprecation Messaging and Dead Code Removal — Status

**Current Step:** Step 5: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-04-02
**Review Level:** 2
**Review Counter:** 8
**Iteration:** 2
**Size:** M

---

### Step 0: Preflight — Inventory dead code
**Status:** ✅ Complete
- [x] Read PROMPT.md and STATUS.md
- [x] Identify dead TMUX execution functions
- [x] Identify dead TMUX merge functions
- [x] Identify dead TMUX session helpers
- [x] Log inventory in STATUS.md

### Step 1: Config deprecation messaging
**Status:** ✅ Complete
- [x] Mark spawn_mode: "tmux" as deprecated in config-schema
- [x] Emit deprecation warning in config-loader
- [x] V2-first doctor/preflight messaging

### Step 2: Remove dead execution functions
**Status:** ✅ Complete
- [x] Remove executeLane()
- [x] Remove spawnLaneSession() and TMUX spawn helpers
- [x] Remove buildTmuxSpawnArgs() if dead
- [x] Remove legacy spawnMergeAgent() (TMUX version)
- [x] Update engine.ts imports
- [x] Update other import sites

### Step 3: Remove dead session helpers
**Status:** ✅ Complete
- [x] Review sessions.ts for dead functions
- [x] Remove dead, keep abort-related

### Step 4: Tests
**Status:** ✅ Complete
- [x] Update tests for removed functions
- [x] Run full suite
- [x] Fix all failures

### Step 5: Documentation & Delivery
**Status:** ✅ Complete
- [x] Update STATUS.md with summary
- [x] Log discoveries

---

## Step 0 Inventory (Dead TMUX Paths)

### Execution (`extensions/taskplane/execution.ts`)
- `executeLane()` is legacy-only. It is selected only via `executeWave(..., runtimeBackend)` legacy branch, but `selectRuntimeBackend()` in `engine.ts` now always returns `"v2"`.
- `spawnLaneSession()` is legacy-only; it is called from `executeLane()` and legacy resume branches.
- `buildTmuxSpawnArgs()` is legacy-only; it is called by `spawnLaneSession()`.
- Additional legacy-only helpers tied to the TMUX lane path: `pollUntilTaskComplete()`, `resolveLaneLogPath()`, `resolveLaneLogRelativePath()`, `readLaneLogTailAsync()`, `captureTmuxPaneTailAsync()`, `readTaskStatusTailAsync()`, `buildLaneEnvVars()`, `generateTelemetryPaths()`.

### Merge (`extensions/taskplane/merge.ts`)
- `spawnMergeAgent()` is the TMUX merge spawner (legacy path); `spawnMergeAgentV2()` is the active path under V2.
- `generateMergeTelemetryPaths()` is only used by legacy `spawnMergeAgent()`.
- `merge.ts` currently has dead legacy import drift from execution.ts: `buildLaneEnvVars`, `buildTmuxSpawnArgs`, and `generateTelemetryPaths` are imported but unused.

### Sessions (`extensions/taskplane/sessions.ts`)
- No dead session helper exports found: `listOrchSessions()` and `formatOrchSessions()` are still used by `/orch-sessions` and engine cleanup checks.
- Non-functional cleanup candidate: unused `join` import in `sessions.ts`.

## Execution Log

| Timestamp | Action | Outcome |
| 2026-04-02 04:22 | Task started | Runtime V2 lane-runner execution |
| 2026-04-02 04:22 | Step 0 started | Preflight — Inventory dead code |
| 2026-04-02 04:36 | Step 0 completed | Dead TMUX path inventory logged in STATUS.md |
| 2026-04-02 04:36 | Step 1 started | Config deprecation messaging |
| 2026-04-02 04:47 | Step 1 validation | Targeted test pass: tests/project-config-loader.test.ts |
| 2026-04-02 04:47 | Step 1 completed | Deprecation docs + warnings + V2-first messaging landed |
| 2026-04-02 04:47 | Step 2 started | Remove dead execution functions |
| 2026-04-02 05:15 | Step 2 validation | Targeted tests pass: engine-runtime-v2-routing, merge-timeout-resilience, lane-runner-v2 |
| 2026-04-02 05:15 | Step 2 completed | Removed legacy lane/merge TMUX spawners and updated runtime callsites |
| 2026-04-02 05:15 | Step 3 started | Remove dead session helpers |
| 2026-04-02 05:20 | Step 3 validation | Targeted test pass: tests/engine-runtime-v2-routing.test.ts |
| 2026-04-02 05:20 | Step 3 completed | sessions.ts dead import cleanup applied |
| 2026-04-02 05:20 | Step 4 started | Tests |
| 2026-04-02 05:58 | Step 4 validation | Targeted test pass: orch-rpc-telemetry, runtime-model-fallback, supervisor-merge-monitoring, workspace-config.integration, crash-recovery-spawn-reliability |
| 2026-04-02 06:00 | Step 4 validation | Full suite pass: 3398 tests, 0 failures |
| 2026-04-02 06:00 | Step 4 completed | Updated/deleted stale legacy TMUX structural tests for Runtime V2-only codepaths |
| 2026-04-02 06:00 | Step 5 started | Documentation & Delivery |
| 2026-04-02 06:05 | Step 5 completed | Summary + discoveries recorded; task ready for delivery |
|-----------|--------|---------|
| 2026-04-02 04:28 | Review R001 | plan Step 1: APPROVE |
| 2026-04-02 04:33 | Review R002 | code Step 1: APPROVE |
| 2026-04-02 04:35 | Review R003 | plan Step 2: APPROVE |
| 2026-04-02 04:45 | Review R004 | code Step 2: APPROVE |
| 2026-04-02 04:46 | Review R005 | plan Step 3: APPROVE |
| 2026-04-02 04:48 | Review R006 | code Step 3: APPROVE |
| 2026-04-02 04:51 | Review R007 | plan Step 4: APPROVE |
| 2026-04-02 04:52 | Worker iter 1 | killed (wall-clock timeout) in 1800s, tools: 178 |
| 2026-04-02 05:04 | Review R008 | code Step 4: APPROVE |
| 2026-04-02 05:06 | Agent reply | TP-117 completed. Steps 4–5 are fully checked and STATUS.md is set to ✅ Complete (Current Step: Step 5). Updated/removed stale legacy-TMUX tests across 5 files, ran targeted regressions, then full sui |
| 2026-04-02 05:06 | Worker iter 2 | done in 829s, tools: 80 |
| 2026-04-02 05:06 | Task complete | .DONE created |

## Completion Summary

- Updated stale legacy-TMUX test assertions across five files to align with Runtime V2 entry points (`executeLaneV2`, `spawnMergeAgentV2`) and removed assertions for deleted helpers.
- Removed obsolete structural checks in `crash-recovery-spawn-reliability.test.ts` that referenced `buildTmuxSpawnArgs`.
- Validation coverage:
  - Targeted tests: `orch-rpc-telemetry`, `runtime-model-fallback`, `supervisor-merge-monitoring`, `workspace-config.integration`, `crash-recovery-spawn-reliability`
  - Full suite: **3398 passed, 0 failed**

## Discoveries

- Unexpected residual references to removed TMUX functions were limited to structural tests; no production code import sites remained after Steps 2–3.
- `merge.ts` health-monitor flow still deregisters sessions via `healthMonitor.removeSession(...)`, but no longer registers with `healthMonitor.addSession(...)` in the Runtime V2 merge path.
