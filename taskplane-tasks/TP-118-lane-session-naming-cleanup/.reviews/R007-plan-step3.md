## Plan Review: Step 3: Rename in tests

### Verdict: REVISE

### Summary
The Step 3 plan captures the core mechanics (rename test refs, run suite, fix failures), but it is missing one important outcome guard: preserving explicit backward-compat coverage for legacy `tmuxSessionName` inputs. Given the task-level requirement to keep reading prior persisted state, a blanket “update all test references” can accidentally remove the very tests that protect that contract.

### Issues Found
1. **[Severity: important]** — `STATUS.md` Step 3 currently says “Update all test references” (`STATUS.md:39`) without carving out legacy-compat test cases. This conflicts with the PROMPT “Do NOT break persisted batch-state.json from prior versions (must read old field name)” (`PROMPT.md:94`) if interpreted literally. **Suggested fix:** explicitly scope the rename to non-compat assertions, and retain (or add) tests that feed tmux-only persisted/legacy lane records (e.g., in persistence/resume/compat regression suites).

### Missing Items
- Explicit completion criterion: after Step 3, any remaining `tmuxSessionName` in tests is intentional compatibility coverage only (not stale naming).

### Suggestions
- Add a quick post-step grep summary for tests to show which residual references are compatibility-scoped.
- Where tests are not compatibility-focused, update assertion text/test names to `laneSessionId` for clarity and future maintenance.
