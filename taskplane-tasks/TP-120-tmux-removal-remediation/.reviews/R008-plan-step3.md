## Plan Review: Step 3: Remove abort.ts TMUX code

### Verdict: APPROVE

### Summary
This revised Step 3 plan now covers the blocking gaps from R007 and is aligned with the PROMPT outcomes for making abort behavior V2-only. In particular, it no longer scopes the work only to `abort.ts`; it explicitly includes the active `/orch-abort` TMUX list/kill path in `extension.ts`, plus concrete non-TMUX session discovery behavior when only persisted state exists. The added abort test intent is sufficient for this step’s correctness goals.

### Issues Found
1. **[Severity: minor]** — No blocking issues found.

### Missing Items
- None.

### Suggestions
- After implementation, include one focused regression test where persisted batch state exists but runtime lane state is empty, to ensure graceful/hard abort still targets the correct V2 lane/merge processes without TMUX discovery.
- Consider capturing expected user-facing messaging updates (removing TMUX wording in abort logs/errors) as a follow-up cleanup, since behavior is now backend-neutral.
