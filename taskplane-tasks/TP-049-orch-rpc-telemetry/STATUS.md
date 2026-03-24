# TP-049: Orchestrator RPC Telemetry for All Agent Types — Status

**Current Step:** Step 1: Route lane worker spawns through RPC wrapper
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-24
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 2
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.

---

### Step 0: Preflight
**Status:** 🟨 In Progress

- [x] Understand spawnAgentTmux() pattern in task-runner.ts (RPC wrapper, sidecar, exit summary)
- [x] Understand buildTmuxSpawnArgs() in execution.ts (current lane spawn)
- [x] Understand spawnMergeAgent() in merge.ts (current merge spawn)
- [x] Understand parseTelemetryFilename() in dashboard/server.cjs
- [x] Understand rpc-wrapper.mjs CLI interface
- [x] Verify resolveRpcWrapperPath() accessibility

---

### Step 1: Route lane worker spawns through RPC wrapper
**Status:** 🟨 In Progress

> ⚠️ Hydrate: Expand based on exact command structure discovered in Step 0

- [ ] Update buildTmuxSpawnArgs() to spawn node rpc-wrapper.mjs instead of pi directly
- [ ] Generate telemetry file paths with dashboard-compatible naming
- [ ] Ensure env vars (TASK_AUTOSTART, etc.) still passed correctly
- [ ] Ensure -e task-runner.ts extension still loaded

---

### Step 2: Route merge agent spawns through RPC wrapper
**Status:** 🟨 In Progress

- [ ] Update spawnMergeAgent() to spawn via RPC wrapper
- [ ] Generate merge-specific telemetry file paths
- [ ] Preserve existing merge agent CLI args (system prompt, prompt file)

---

### Step 3: Route reviewer spawns through RPC wrapper (tmux mode)
**Status:** 🟨 In Progress

- [ ] Verify reviewer tmux spawn uses RPC wrapper in doReview()
- [ ] If not, update to use spawnAgentTmux() pattern
- [ ] Verify reviewer telemetry files produced with recognizable names

---

### Step 4: Ensure dashboard consumes all telemetry sources
**Status:** 🟨 In Progress

- [ ] Verify parseTelemetryFilename() handles worker, merger, reviewer files
- [ ] Update parser if naming convention doesn't match
- [ ] Verify dashboard displays telemetry for all agent types

---

### Step 5: Testing & Verification
**Status:** 🟨 In Progress

- [ ] All existing tests pass
- [ ] Tests for lane spawn command includes rpc-wrapper
- [ ] Tests for merge spawn command includes rpc-wrapper
- [ ] Tests for telemetry filename generation
- [ ] Tests for dashboard filename parser coverage

---

### Step 6: Documentation & Delivery
**Status:** 🟨 In Progress

- [ ] Check affected docs
- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

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
