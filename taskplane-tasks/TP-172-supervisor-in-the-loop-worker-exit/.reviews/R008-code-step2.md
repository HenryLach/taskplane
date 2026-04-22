## Code Review: Step 2: Add Supervisor Escalation to lane-runner

### Verdict: REVISE

### Summary
The new `onPrematureExit` wiring in `lane-runner.ts` is generally well-structured: escalation alert composition, 60s supervisor wait, stale-message timestamp guard, and reprompt-vs-close handling are all in place. This addresses the major Step 2 flow and also incorporates the stale-reply mitigation noted during plan review. However, one required behavior is still missing: exits after logging a blocker are treated as “no progress” and escalated, which conflicts with the task’s visible-progress contract.

### Issues Found
1. **[extensions/taskplane/lane-runner.ts:375-383] [important]** — The interception decision only checks checkbox delta (`midTotalChecked > prevTotalChecked`). It does **not** account for blocker logging, so a worker that exits after adding a concrete blocker entry in `STATUS.md` is still escalated/reprompted as if it made no visible progress. That contradicts TP-172’s mission/exit contract (“no checkbox updates, no blocker logged”). **Fix:** extend the pre/post progress check to include blocker-state changes (e.g., parse Blockers section before iteration and in callback; if a new non-`*None*` blocker entry was added, return `null` and allow normal session close).

### Pattern Violations
- None.

### Test Gaps
- No targeted lane-runner test coverage was added for the new interception callback branches (timeout, close directives, instructional reprompt).
- Missing regression test for the blocker-progress branch (worker logs blocker, session should close normally without escalation).

### Suggestions
- Add a small helper for interception eligibility (checkbox delta + blocker delta) so the same progress semantics are explicit and testable.
- Consider broadening close-directive parsing slightly (e.g., tolerate punctuation/extra words like `"let it fail - blocked"`) to reduce accidental reprompts.
