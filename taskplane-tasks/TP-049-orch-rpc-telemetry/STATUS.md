# TP-049: Orchestrator RPC Telemetry for All Agent Types — Status

**Current Step:** Complete
**Status:** ✅ Complete
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 2
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Understand spawnAgentTmux() pattern in task-runner.ts (RPC wrapper, sidecar, exit summary)
- [x] Understand buildTmuxSpawnArgs() in execution.ts (current lane spawn)
- [x] Understand spawnMergeAgent() in merge.ts (current merge spawn)
- [x] Understand parseTelemetryFilename() in dashboard/server.cjs
- [x] Understand rpc-wrapper.mjs CLI interface
- [x] Verify resolveRpcWrapperPath() accessibility

---

### Step 1: Route lane worker spawns through RPC wrapper
**Status:** ✅ Complete

> ⚠️ Hydrate: Expand based on exact command structure discovered in Step 0

- [x] Update buildTmuxSpawnArgs() to spawn node rpc-wrapper.mjs instead of pi directly
- [x] Generate telemetry file paths with dashboard-compatible naming
- [x] Ensure env vars (TASK_AUTOSTART, etc.) still passed correctly
- [x] Ensure -e task-runner.ts extension still loaded

---

### Step 2: Route merge agent spawns through RPC wrapper
**Status:** ✅ Complete

- [x] Update spawnMergeAgent() to spawn via RPC wrapper
- [x] Generate merge-specific telemetry file paths
- [x] Preserve existing merge agent CLI args (system prompt, prompt file)

---

### Step 3: Route reviewer spawns through RPC wrapper (tmux mode)
**Status:** ✅ Complete

- [x] Verify reviewer tmux spawn uses RPC wrapper in doReview()
- [x] If not, update to use spawnAgentTmux() pattern
- [x] Verify reviewer telemetry files produced with recognizable names

---

### Step 4: Ensure dashboard consumes all telemetry sources
**Status:** ✅ Complete

- [x] Verify parseTelemetryFilename() handles worker, merger, reviewer files
- [x] Update parser if naming convention doesn't match
- [x] Verify dashboard displays telemetry for all agent types

---

### Step 5: Testing & Verification
**Status:** ✅ Complete

- [x] All existing tests pass
- [x] Tests for lane spawn command includes rpc-wrapper
- [x] Tests for merge spawn command includes rpc-wrapper
- [x] Tests for telemetry filename generation
- [x] Tests for dashboard filename parser coverage

---

### Step 6: Documentation & Delivery
**Status:** ✅ Complete

- [x] Check affected docs
- [x] Discoveries logged
- [x] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| merge-timeout-resilience.test.ts 4.4 searched for `export function waitForMergeResult` (missing `async`), causing substring(-1) to silently read file start | Fixed in-place | `extensions/tests/merge-timeout-resilience.test.ts` |
| task-runner-rpc.test.ts and task-runner-rpc-integration.test.ts asserted execution.ts has no rpc-wrapper refs; updated to only check polling loop excludes sidecar-tailing | Fixed in-place | `extensions/tests/task-runner-rpc*.test.ts` |
| Lane sessions use TASK_RUNNER_SPAWN_MODE=subprocess (not tmux) so inner workers/reviewers use spawnAgent(), not spawnAgentTmux() | Noted — telemetry from outer RPC wrapper covers the lane session | `extensions/taskplane/execution.ts` |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-23 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-24 02:38 | Task started | Extension-driven execution |
| 2026-03-24 02:38 | Step 0 started | Preflight |
| 2026-03-24 02:38 | Step 1 started | Route lane worker spawns through RPC wrapper |
| 2026-03-24 02:38 | Step 2 started | Route merge agent spawns through RPC wrapper |
| 2026-03-24 02:38 | Step 3 started | Route reviewer spawns through RPC wrapper (tmux mode) |
| 2026-03-24 02:38 | Step 4 started | Ensure dashboard consumes all telemetry sources |
| 2026-03-24 02:38 | Step 5 started | Testing & Verification |
| 2026-03-24 02:38 | Step 6 started | Documentation & Delivery |
| 2026-03-24 02:38 | Task started | Extension-driven execution |
| 2026-03-24 02:38 | Step 0 started | Preflight |
| 2026-03-24 02:38 | Step 1 started | Route lane worker spawns through RPC wrapper |
| 2026-03-24 02:38 | Step 2 started | Route merge agent spawns through RPC wrapper |
| 2026-03-24 02:38 | Step 3 started | Route reviewer spawns through RPC wrapper (tmux mode) |
| 2026-03-24 02:38 | Step 4 started | Ensure dashboard consumes all telemetry sources |
| 2026-03-24 02:38 | Step 5 started | Testing & Verification |
| 2026-03-24 02:38 | Step 6 started | Documentation & Delivery |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
