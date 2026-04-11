## Plan Review: Step 2 — Fast-fail on dead PID + stale snapshot

### Verdict: REVISE

### Summary
The three checkboxes in the STATUS.md plan correctly capture the required conditions (stale > stallTimeout/2, confirmed dead, startup grace elapsed). However, the PROMPT.md narrative — which the worker will use as the implementation guide — names the **wrong code branch** as the target. The PROMPT says to add the fast-fail "in the section that handles `snap == null || snap.taskId !== taskId`", but the perpetual-executing ghost worker bug is caused by the **else branch** (`snap.taskId === taskId`), and the fast-fail must live there. Implementing only in the null/mismatch branch leaves the main failure path intact and the completion criterion unmet.

---

### Issues Found

1. **[execution.ts:913–916]  important** — Wrong target branch in the PROMPT narrative.

   The actual code at the affected location is:
   ```typescript
   } else {
       sessionAlive = snap.status === "running";   // ← the bug lives here
   }
   ```
   When a worker's snapshot correctly names the current `taskId` (i.e., `snap.taskId === taskId`) but the worker has already died silently, `snap.status` is still `"running"`, so `sessionAlive = true` unconditionally. If STATUS.md was never written (worker died before producing any output), `tracker.statusFileSeenOnce` stays `false`, `stallTimerStart` stays `null`, and Priority 2 (stall) **never fires**. `sessionAlive = true` means Priority 3 (session-ended) never fires either. The batch stays in `executing` forever — the exact bug in issue #461.

   By contrast, the `snap == null || snap.taskId !== taskId` branch already calls `isV2AgentAlive` after 30 s when `trackerAgeMs >= 60 s`. That path already works correctly after Step 1 wires orphan detection; enhancing it further would be a redundant refinement, not the core fix.

   **Required addition to the Step 2 plan:** add an explicit note (e.g. a new checklist item or amendment) stating:

   > The fast-fail implementation target is the `else` branch (`snap.taskId === taskId`), not the null/mismatch branch. In that branch, when `(now - snap.updatedAt) > stallTimeoutMs / 2` AND `trackerAgeMs >= 60_000` AND `isV2AgentAlive` returns false, set `sessionAlive = false` (or return `failed` immediately) so Priority 3 fires without waiting for the stall timer.

   Without this clarification the worker may implement only in the null/mismatch branch — following the PROMPT literally — and miss the main perpetual-executing scenario. The completion criterion ("fails within at most `stallTimeout / 2` minutes") would not be met.

---

### Missing Items
- None beyond the above clarification.

---

### Suggestions

- **Minor: null-guard on `snap.updatedAt`** — in the else branch the snapshot exists and belongs to the current task, but `updatedAt` could theoretically be `0` or missing if written by an older schema version. A guard like `snap.updatedAt && (now - snap.updatedAt) > stallTimeoutMs / 2` avoids false positives.

- **Minor: consider a direct `return` vs. `sessionAlive = false`** — either works because `sessionAlive = false` flows directly to Priority 3 (which is the very next check and also requires no other condition). Using `sessionAlive = false` is slightly more idiomatic within the existing pattern and keeps all early-exit decisions in the priority block.

- **Test gap (Step 4 concern):** A new test along the lines of "14.14: stale matching-taskId snapshot with dead agent fast-fails at stallTimeout/2" is needed. Existing tests 14.9–14.13 only cover the null/mismatch path. The test should pass a snapshot with `taskId === currentTaskId`, `status: "running"`, and `updatedAt` more than `stallTimeoutMs / 2` ago, plus a dead liveness registry, and assert `snapshot.status === "failed"`. Worth adding to the Step 4 (testing) checkboxes.
