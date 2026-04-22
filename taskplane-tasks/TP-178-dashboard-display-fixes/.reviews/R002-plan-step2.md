## Plan Review: Step 2: Fix lane step label that never updates (#488)

### Verdict: APPROVE

### Summary
The Step 2 plan is aligned with the prompt outcome: it targets per-poll step-label refresh from Runtime V2 lane snapshot data and includes a fallback to `STATUS.md` parsing when sidecar step data is unavailable. The STATUS architecture note correctly pinpoints the current rendering gap in `dashboard/public/app.js` (step cell currently using only `statusData.currentStep`). This is a focused, low-risk plan that should resolve issue #488 without broad changes.

### Issues Found
1. **[Severity: minor]** The plan should explicitly preserve task scoping when consuming lane snapshot step text (i.e., only apply V2 `currentStep` to the active task for that lane) to avoid accidentally showing one task’s step label on other tasks in the same lane.

### Missing Items
- None blocking.

### Suggestions
- In implementation, prefer V2 `currentStep` only when it is non-empty/non-`Unknown`, then fall back to `statusData.currentStep`.
- Add a brief verification note in STATUS.md showing both paths were validated: (a) live sidecar step updates, and (b) fallback behavior when V2 step data is missing/stale.
