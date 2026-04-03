## Plan Review: Step 1: Dashboard segment visibility

### Verdict: APPROVE

### Summary
The Step 1 plan covers the required dashboard outcomes from PROMPT.md: active segment visibility per lane, per-task segment progress, packet home repo display, and clean handling for repo-singleton tasks. Step 0 preflight work indicates the worker has already validated data availability in lane snapshots/batch state, which reduces implementation risk. For this task size/review level, the plan is sufficient to proceed.

### Issues Found
1. **[Severity: minor]** — The Step 1 checkbox “Show active segment per lane” is slightly ambiguous versus PROMPT wording (“active segment (repoId) per lane”). Suggested tweak: explicitly mention `repoId` in the step note so the display requirement is unambiguous.

### Missing Items
- None blocking.

### Suggestions
- In implementation, ensure dashboard rendering degrades safely when segment fields are absent in older/non-segment snapshots (avoid undefined access and avoid visual noise).
- Keep segment labels concise (e.g., `Segment 2/3 · api-service`) to preserve scanability in lane/task cards.
