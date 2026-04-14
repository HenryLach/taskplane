## Plan Review: Step 6: Fix no progress shown for non-final segment execution (#494)

### Verdict: APPROVE

### Summary
The Step 6 plan is aligned with the prompt outcome: use sidecar-provided segment-scoped progress when available, and avoid showing misleading 0% when that data is missing. It stays correctly scoped to dashboard rendering logic and preserves the task’s no-runtime-code constraint. This approach should resolve the operator-facing progress confusion for non-final segment execution.

### Issues Found
1. **[Severity: minor]** The plan should explicitly state that the fallback "executing" indicator applies to **running** tasks only, so pending/failed/succeeded states keep their existing semantics.

### Missing Items
- None blocking.

### Suggestions
- Add an explicit verification case for both paths: (a) sidecar segment counts present (shows real-time `X/Y`), (b) sidecar segment counts absent/zero during running (shows "executing", not `0%`).
- Keep the existing succeeded-task 100% override untouched while implementing this fallback logic.
