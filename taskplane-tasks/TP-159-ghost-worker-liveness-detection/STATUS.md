# TP-159: Detect and recover ghost workers after silent subprocess death (#461) — Status

**Current Step:** Step 1: Wire orphan detection into the monitor poll loop
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-11
**Review Level:** 2
**Review Counter:** 3
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
**Status:** 🟨 In Progress

- [ ] Read existing grace period logic carefully
- [ ] **AMENDED (R003)**: Target is `else` branch (`snap.taskId === taskId`), NOT null/mismatch branch. That branch does `sessionAlive = snap.status === "running"` unconditionally — the bug — because if the worker died silently the snapshot still says "running" and Priority 3 never fires.
- [ ] Implement fast-fail in the `else` branch: when `snap.updatedAt` stale > stallTimeoutMs/2 AND trackerAgeMs >= 60s AND isV2AgentAlive returns false, set sessionAlive = false
- [ ] Only applies after startup grace (trackerAgeMs >= 60s)
- [ ] Null-guard snap.updatedAt to avoid false positives from old schema

---

### Step 3: Verify supervisor/operator visibility
**Status:** ⬜ Not Started

- [ ] Confirm read_agent_status / list_active_agents reflect crashed status
- [ ] Trace failed task path through monitor loop to engine failure handling

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Full test suite passing
- [ ] CLI smoke passing
- [ ] Fix all failures

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Inline comments for new logic
- [ ] Discoveries logged

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
| 2026-04-10 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-11 00:05 | Task started | Runtime V2 lane-runner execution |
| 2026-04-11 00:05 | Step 0 started | Preflight |

---

## Blockers

*None*
| 2026-04-11 00:10 | Review R001 | plan Step 1: APPROVE |
| 2026-04-11 00:18 | Review R002 | code Step 1: APPROVE |
| 2026-04-11 00:25 | Review R003 | plan Step 2: REVISE |
