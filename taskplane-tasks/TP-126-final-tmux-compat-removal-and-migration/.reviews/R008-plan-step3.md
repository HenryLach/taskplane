## Plan Review: Step 3: Tests and migration coverage

### Verdict: APPROVE

### Summary
The Step 3 plan is aligned with the PROMPT outcomes for this phase: it covers fixture updates, migration/failure regression tests, and explicit validation runs (full extension suite plus CLI smokes). Given the Step 0 migration policy and Step 1/2 contract removals already recorded in STATUS.md, this plan is sufficient to verify the final no-TMUX behavior without introducing unnecessary implementation-level checklist overhead.

### Issues Found
1. **[Severity: minor]** — No blocking gaps found in the stated Step 3 outcomes.

### Missing Items
- None.

### Suggestions
- In the migration/failure tests, explicitly include all three legacy paths from Step 0 policy so coverage is unmistakable: `tmuxPrefix` hard-fail with fix hint, `spawn_mode: "tmux"` hard-fail with fix hint, and persisted `lanes[].tmuxSessionName` migration warning + canonical rewrite behavior.
- When updating fixtures, ensure both project config and user-preferences fixtures are checked so legacy ingress is not accidentally reintroduced through one config path.
