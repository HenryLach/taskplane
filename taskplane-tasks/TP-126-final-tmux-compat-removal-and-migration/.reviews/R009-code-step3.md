## Code Review: Step 3: Tests and migration coverage

### Verdict: APPROVE

### Summary
Step 3 changes are aligned with the stated outcomes: TMUX-era fixture defaults were updated to canonical subprocess values, and explicit regression tests were added for legacy JSON fields (`tmuxPrefix`, `spawnMode: "tmux"`) with migration guidance assertions. The modified suites pass locally with the current branch state. This is a solid coverage increment for the final no-TMUX contract.

### Issues Found
1. None.

### Pattern Violations
- None observed in this diff.

### Test Gaps
- No blocking gaps found for this step. Existing suite coverage already includes persisted-state legacy lane key handling (`lanes[].tmuxSessionName`) outside this diff, while this step adds init-generated JSON migration-failure checks.

### Suggestions
- Minor: In `extensions/tests/init-mode-detection.integration.test.ts` (new 5.11/5.12), consider temporarily sandboxing `HOME`/user-preferences lookup to make these assertions fully hermetic against host-level `~/.pi/agent/taskplane/preferences.json` state.