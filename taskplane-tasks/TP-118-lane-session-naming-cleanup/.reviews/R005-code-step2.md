## Code Review: Step 2: Rename in production code

### Verdict: REVISE

### Summary
The Step 2 rename is broadly applied across production modules and dashboard paths, with sensible `laneSessionId || tmuxSessionName` compatibility fallbacks in most files. However, there is a critical regression in `execution.ts` where the new lane-session helper recursively calls itself instead of falling back to `tmuxSessionName`. That bug can crash runtime paths (especially resume/reconnect lanes that may only set `tmuxSessionName`) with a stack overflow.

### Issues Found
1. **[extensions/taskplane/execution.ts:576-577] [critical]** — `laneSessionIdOf()` is implemented as `return lane.laneSessionId || laneSessionIdOf(lane);`, which causes infinite recursion whenever `laneSessionId` is absent. This will throw `RangeError: Maximum call stack size exceeded` in compatibility scenarios (e.g., resume-created `AllocatedLane` objects that only set `tmuxSessionName` at `resume.ts:1134` / `1215`). **Fix:** change fallback to the deprecated alias field directly, e.g. `return lane.laneSessionId || lane.tmuxSessionName;` (optionally with a defensive error if both are unexpectedly empty).

### Pattern Violations
- None beyond the blocking bug above.

### Test Gaps
- Add/adjust execution/resume coverage for the compatibility path where a lane has only `tmuxSessionName` populated (no `laneSessionId`) to ensure helper fallback behavior is safe and non-recursive.

### Suggestions
- After fixing the helper, run at least one resume-path test that exercises `executeLaneV2` with a compatibility-shaped lane object to prevent regression in Step 3/4 cleanup.
