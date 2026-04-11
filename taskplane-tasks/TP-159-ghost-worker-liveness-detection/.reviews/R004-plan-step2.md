## Plan Review: Step 2 — Fast-fail on dead PID + stale snapshot (revised)

### Verdict: APPROVE

### Summary
The R003 revision has been correctly incorporated. The plan now clearly identifies the
`else` branch (`snap.taskId === taskId`) as the target, includes the required three
conditions (stale > stallTimeoutMs/2, trackerAgeMs >= 60 s, isV2AgentAlive == false),
and includes the null-guard on `snap.updatedAt`. All issues from the prior REVISE are
resolved. The plan is ready to implement.

---

### Issues Found

_None._

---

### Verification of R003 Findings

1. **Correct target branch** — STATUS.md amendment explicitly names the `else` branch
   (`snap.taskId === taskId`) and explains *why* the bug lives there: `snap.status`
   stays `"running"` even after silent death, so `sessionAlive = true` indefinitely.
   ✅ Addressed.

2. **Null-guard on `snap.updatedAt`** — This is actually *required*, not merely
   defensive: `readLaneSnapshot()` in `process-registry.ts` has the return type
   `{ taskId?: …; status: string; updatedAt?: number } | null`, so `updatedAt` is
   optional and can be `undefined`. The plan's checklist item covers this.
   ✅ Addressed.

3. **Three-way guard (stale + grace + liveness)** — All three conditions are
   enumerated as separate checklist items. The implementation will be unambiguous.
   ✅ Addressed.

---

### Missing Items

_None._

---

### Suggestions

- **Test gap (Step 4):** The existing tests 14.9–14.13 only exercise the
  null/mismatch branch. Consider adding a test along the lines of:
  > "14.14: matching taskId snapshot with `status: 'running'` and stale
  > `updatedAt` + dead registry fast-fails at stallTimeout/2 boundary"
  This would directly validate the new else-branch code path. The test structure
  would be similar to 14.13 but with `taskId === currentTaskId` and
  `updatedAt` set to `now - (stallTimeoutMs / 2 + 1)`. Adding this during
  Step 4 is sufficient; no changes needed now.

- **Minor: log the fast-fail reason** — When `sessionAlive` is overridden to
  `false` in the fast-fail path, a brief `execLog(...)` entry would make it
  immediately visible in monitor logs which scenario triggered it (similar to
  how the stall timeout path logs `"stall detected — killing agent"`). Not
  required for correctness.
