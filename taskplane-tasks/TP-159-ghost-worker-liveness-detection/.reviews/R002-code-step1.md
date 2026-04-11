## Code Review: Step 1 — Wire orphan detection into the monitor poll loop

### Verdict: APPROVE

### Summary
The implementation is correct and complete. The orphan detection block is placed exactly where the PROMPT specifies (after the TP-112 liveness cache refresh), is correctly guarded, null-safe, wrapped in try/catch, and refreshes the cache when orphans are found. Imports are updated cleanly. Pre-existing test failures (`14.x` supervised mode, `5.11` execCtx reset) are confirmed to be pre-existing — identical failures exist on the parent commit `c2be45c9` before this change.

### Issues Found
_None blocking._

### Pattern Violations
_None._

### Test Gaps
- No new test was added for `detectOrphans` / `markOrphansCrashed` being called in the monitor loop. The PROMPT defers this to Step 4, so it is expected to be absent here. Confirmed as a Step 4 concern.

### Suggestions

- **Minor: double file read per poll cycle.** The TP-112 block immediately above already calls `readRegistrySnapshot(...)` and caches the result. The TP-159 block then calls `readRegistrySnapshot(...)` a second time (and a third time when orphans are found). The snapshot from the TP-112 read could be captured in a local variable and reused. This was already flagged in R001 as a suggestion, and the implementation follows the PROMPT's pseudocode exactly, so it is not a blocker — just worth carrying forward as a micro-optimisation if desired.

- **Style: two identical `if (runtimeBackend === "v2" && batchId)` guards back-to-back.** Functionally correct, but a reader might wonder why they're split. The split is intentional (TP-112 and TP-159 are separate concerns with separate error handling), but a brief comment on the TP-159 guard noting "separate guard preserves independent error isolation from TP-112" would make that obvious. Non-blocking.
