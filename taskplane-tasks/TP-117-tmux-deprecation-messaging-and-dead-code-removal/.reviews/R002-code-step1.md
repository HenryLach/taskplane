## Code Review: Step 1: Config deprecation messaging

### Verdict: APPROVE

### Summary
Step 1 implementation meets the stated outcomes: `spawn_mode: "tmux"` is marked deprecated in schema comments, `loadProjectConfig()` now emits a deprecation warning when effective config uses TMUX spawn mode, and extension-facing messaging now frames Runtime V2 as the default with TMUX as legacy-only. The config-loader behavior is covered by new tests and the targeted test suite passes. I did not find blocking correctness issues for this step.

### Issues Found
1. **[N/A] [minor]** — No blocking issues found in the Step 1 code changes.

### Pattern Violations
- None identified.

### Test Gaps
- No direct automated test coverage was added for the new `extension.ts` UI messaging paths (preflight/ready notifications).
- Deprecation warning tests currently cover YAML-based inputs; JSON config and user-preference override paths are implicitly covered by loader flow but not explicitly asserted.

### Suggestions
- Add a small extension-level test (or command-handler test) that asserts the new Runtime V2/TMUX-legacy messaging appears in the intended command flows.
- Add one config-loader regression test where `.pi/taskplane-config.json` sets `orchestrator.orchestrator.spawnMode: "tmux"`, and optionally one where user preferences override to `tmux`, to lock source-agnostic warning behavior.
