# TP-159: Detect and recover ghost workers after silent subprocess death (#461) — Status

**Current Step:** Step 5: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-04-11
**Review Level:** 2
**Review Counter:** 6
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read `monitorLanes()` in `execution.ts`
- [x] Read `resolveTaskMonitorState()` — understand grace periods
- [x] Read `detectOrphans()` and `markOrphansCrashed()` in `process-registry.ts`
- [x] Verify test baseline

---

### Step 1: Wire orphan detection into the monitor poll loop
**Status:** ✅ Complete

- [x] Add orphan detection block after liveness registry refresh
- [x] Wrap in try/catch — monitor loop must never throw
- [x] Refresh cache after marking orphans

---

### Step 2: Fast-fail on dead PID + stale snapshot
**Status:** ✅ Complete

- [x] Read existing grace period logic carefully
- [x] **AMENDED (R003)**: Target is `else` branch (`snap.taskId === taskId`), NOT null/mismatch branch. That branch does `sessionAlive = snap.status === "running"` unconditionally — the bug — because if the worker died silently the snapshot still says "running" and Priority 3 never fires.
- [x] Implement fast-fail in the `else` branch: when `snap.updatedAt` stale > stallTimeoutMs/2 AND trackerAgeMs >= 60s AND isV2AgentAlive returns false, set sessionAlive = false
- [x] Only applies after startup grace (trackerAgeMs >= 60s)
- [x] Null-guard snap.updatedAt to avoid false positives from old schema

---

### Step 3: Verify supervisor/operator visibility
**Status:** ✅ Complete

- [x] Confirm read_agent_status / list_active_agents reflect crashed status
- [x] Trace failed task path through monitor loop to engine failure handling

---

### Step 4: Testing & Verification
**Status:** ✅ Complete

- [x] Full test suite passing (3253/3255 pass; 2 pre-existing failures unrelated to TP-159)
- [x] CLI smoke passing
- [x] Fix all failures (14.5 window fixed; pre-existing failures verified pre-existing)

---

### Step 5: Documentation & Delivery
**Status:** ✅ Complete

- [x] Inline comments for new logic
- [x] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| The main ghost-worker bug (`sessionAlive` staying `true` forever) lives in the `else` branch of `resolveTaskMonitorState` (`snap.taskId === taskId`), not the null/mismatch branch as the PROMPT implied. The null/mismatch branch already falls back to `isV2AgentAlive` after 30s. | Fixed in Step 2 | `execution.ts:~913` |
| Test 14.5 search window was only 6000 chars; Step 2 added ~1340 chars before the stall block, pushing it out of range. Fixed to 8000. | Fixed in Step 4 | `engine-runtime-v2-routing.test.ts:563` |
| Two pre-existing test failures: `workspace-config 5.11` (extension.ts ordering) and `auto-integration 14.1` (supervised mode `deliverAs`). Both exist on the branch before this task. | Pre-existing, out-of-scope | `workspace-config.integration.test.ts:754`, `auto-integration.integration.test.ts:853` |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-10 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-11 00:05 | Task started | Runtime V2 lane-runner execution |
| 2026-04-11 00:05 | Step 0 started | Preflight |
| 2026-04-11 00:32 | Snapshot refresh disabled | Lane 2, task TP-159: 5 consecutive emitSnapshot failures |
| 2026-04-11 01:10 | Worker iter 1 | done in 3900s, tools: 106 |
| 2026-04-11 01:10 | Task complete | .DONE created |

---

## Blockers

*None*
| 2026-04-11 00:10 | Review R001 | plan Step 1: APPROVE |
| 2026-04-11 00:18 | Review R002 | code Step 1: APPROVE |
| 2026-04-11 00:25 | Review R003 | plan Step 2: REVISE |
| 2026-04-11 00:28 | Review R004 | plan Step 2: APPROVE |
| 2026-04-11 00:37 | Review R005 | code Step 2: REVISE |
| 2026-04-11 00:47 | Review R006 | code Step 2: APPROVE |
