## Code Review: Step 2 — Fast-fail on dead PID + stale snapshot

### Verdict: REVISE

### Summary
The core logic is correct and matches the R004-approved plan exactly: the `else` branch
(`snap.taskId === taskId`) now fast-fails when `updatedAt` is stale beyond `stallTimeoutMs/2`,
startup grace has elapsed (`trackerAgeMs >= 60s`), and the registry confirms the agent
is dead. All three R003 conditions are implemented with proper guards. However, the new
code expanded `resolveTaskMonitorState` enough to push the `"stall detected"` string
beyond the 6000-character search window used by test 14.5, causing a test regression
that must be fixed before Step 4.

---

### Issues Found

1. **`extensions/tests/engine-runtime-v2-routing.test.ts:562`** (important) — Test 14.5
   (`stall kill uses Runtime V2 PID termination (no TMUX fallback)`) is failing after
   Step 2's changes. The test searches for `"stall detected"` within the first 6000
   characters of `resolveTaskMonitorState`. Before Step 2, that string was at offset 4823
   (within range). Step 2 added ~1340 characters of new code before the stall block,
   pushing the string to offset 6159 — just beyond the window.

   **Fix:** Change `fnIdx + 6000` to `fnIdx + 8000` on line 563:
   ```typescript
   // Before:
   const block = execSrc.slice(fnIdx, fnIdx + 6000);
   // After:
   const block = execSrc.slice(fnIdx, fnIdx + 8000);
   ```
   This is the only failing test attributable to Step 2 (verified by checking offsets
   against the Step 1 / pre-Step 2 source). The `workspace-config 5.11` failure is
   pre-existing and unrelated.

---

### Correctness Verification

The implementation correctly satisfies all R004 requirements:

- **Target branch**: `else` branch (`snap.taskId === taskId`) — ✅ correct, this is
  where the ghost bug lives (`snap.status === "running"` stays true indefinitely).
- **Null-guard on `snap.updatedAt`**: `snap.updatedAt &&` prefix — ✅ present.
- **Stale threshold**: `(now - snap.updatedAt) > stallTimeoutMs / 2` — ✅ correct.
- **Startup grace**: `trackerAgeMs >= 60_000` — ✅ present, prevents false positives
  during wave transitions.
- **Liveness check**: `!isV2AgentAlive(sessionName, runtimeBackend, v2Context?.laneNumber)` —
  ✅ uses the refreshed cache (Step 1 orphan detection already ran earlier in the same
  poll cycle, so marked-crashed PIDs return false here even without the disk update).
- **Priority 3 flow**: When `sessionAlive = false` is set, Priority 3 fires and returns
  `status: "failed"` — ✅ correct path through the state machine.
- **No monitor throw**: The fast-fail is inside `resolveTaskMonitorState`, not the
  monitor loop itself; the loop's try/catch from Step 1 remains in place — ✅.
- **Comments**: Clear, accurate explanation of the bug and all three conditions — ✅.

---

### Pattern Violations
- None.

---

### Test Gaps
- Test 14.14 (`matching-taskId snapshot with stale updatedAt + dead registry fast-fails`)
  does not exist yet. This was flagged as a suggestion in R004 and deferred to Step 4.
  Still acceptable — Step 4 is where test additions belong.

---

### Suggestions
- **`execLog` on fast-fail** (R004 suggestion, still open): Adding a brief
  `execLog("monitor", taskId, "ghost worker fast-fail — dead PID + stale snapshot", {...})`
  inside the new `if` block (before `sessionAlive = false`) would make it immediately
  visible in operator logs when the new code path triggers. Low effort, high diagnostic
  value. Suggested for Step 4.
- **`v2Context?.laneNumber` optional chain**: Inside the enclosing
  `if (runtimeBackend === "v2" && v2Context)` guard, TypeScript already narrows
  `v2Context` to non-null, so `v2Context.laneNumber` would work. The `?.` is harmless
  but technically redundant.
