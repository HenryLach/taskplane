## Code Review: Step 3: Remove abort.ts TMUX code

### Verdict: APPROVE

### Summary
Step 3’s implementation meets the stated outcomes: TMUX session listing/kill logic was removed from abort flow, `/orch-abort` now delegates to `executeAbort(...)`, and abort target discovery is now sourced from Runtime V2 in-memory/persisted state. The new `discoverAbortSessionNames(...)` helper covers the persisted-only recovery case and is wired into `executeAbort(...)` correctly. Added tests validate both removal of TMUX list-sessions usage in abort paths and the new discovery behavior.

### Issues Found
1. None blocking.

### Pattern Violations
- None identified for this step.

### Test Gaps
- No blocking gaps. A future enhancement could add a behavioral (non-string-scan) integration test that runs `executeAbort(...)` end-to-end with persisted-only state and asserts kill targeting/results, but current coverage is adequate for this step.

### Suggestions
- **[extensions/taskplane/abort.ts:24] [minor]** Update the stale docstring text `All TMUX session names matching the prefix` to backend-neutral wording (e.g., “discovered session names matching the prefix”) to fully reflect the Runtime V2 migration.
- **[extensions/taskplane/types.ts:2916,2922] [minor]** Consider deprecating/renaming `ABORT_TMUX_LIST_FAILED` in a follow-up so abort error taxonomy is also backend-neutral.
