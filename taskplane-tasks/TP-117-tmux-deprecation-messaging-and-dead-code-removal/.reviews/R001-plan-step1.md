## Plan Review: Step 1: Config deprecation messaging

### Verdict: APPROVE

### Summary
The Step 1 plan covers the required outcomes from PROMPT.md: deprecating `spawn_mode: "tmux"` in schema, warning in config loading, and updating doctor/preflight messaging to reflect Runtime V2-first behavior. The scope is appropriately outcome-focused without over-specifying implementation details. This is sufficient to proceed.

### Issues Found
1. **[Severity: minor]** — No blocking issues found for this step plan.

### Missing Items
- None identified.

### Suggestions
- Ensure the deprecation warning is emitted regardless of config source (JSON, YAML fallback, and user preferences override), since all can produce an effective `spawn_mode: "tmux"`.
- In preflight messaging, explicitly clarify that TMUX is now legacy/optional for execution so operators with old config values understand behavior has shifted to V2.
- Add/adjust tests to lock the new warning and messaging behavior (especially around `runPreflight`/formatted output) to prevent regressions.