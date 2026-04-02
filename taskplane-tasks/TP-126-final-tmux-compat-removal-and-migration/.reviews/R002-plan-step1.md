## Plan Review: Step 1: Remove remaining compatibility paths

### Verdict: APPROVE

### Summary
The revised Step 1 plan now aligns with both the PROMPT requirements and the Step 0 migration contract. It explicitly preserves one-release migration-only handling for `lanes[].tmuxSessionName` while still retiring TMUX compatibility paths for config aliases and spawn mode acceptance. The operator-guidance requirement is also clearly represented through explicit migration-hint messaging.

### Issues Found
1. **[Severity: minor]** — No blocking issues found.

### Missing Items
- None.

### Suggestions
- When implementing the warning path for legacy `lanes[].tmuxSessionName`, ensure the warning text distinguishes “accepted for migration this release” from normal supported contract to reduce operator confusion.
- Consider recording a short acceptance criterion in Step 1 notes that canonical rewrite is validated by a save/load roundtrip test in Step 3.
