## Code Review: Step 1: Implement Force-Resume Policy

### Verdict: APPROVE

### Summary
The Step 1 implementation correctly wires `/orch-resume --force` through argument parsing, eligibility checks, diagnostics gating, and force-intent recording. The resume matrix behavior in `resume.ts` matches the TP-031 contract (`stopped`/`failed` allowed only with `--force`, `completed` always rejected), and diagnostics failure cleanly aborts force-resume before state mutation. I also ran the full extension test suite (`cd extensions && npx vitest run`): **32 files, 1321 tests passed**.

### Issues Found
1. **[extensions/taskplane/extension.ts:1030] [minor]** — `/orch-resume --help` is surfaced as an error (`❌ ...`) because `parseResumeArgs()` returns help text via the error channel (`extension.ts:138-139`).
   - **Suggested fix:** Handle `--help` as a non-error info path (similar to `/orch-integrate` help handling) so users don’t see usage as a failure.

### Pattern Violations
- None blocking.

### Test Gaps
- No direct unit tests were added for the new Step 1 behavior:
  - `parseResumeArgs()` flag/usage handling
  - `checkResumeEligibility(state, force)` for `stopped`/`failed`/`completed`
  - force-resume diagnostics pass/fail gating and `resilience.resumeForced` mutation path

### Suggestions
- Add focused tests for force-resume policy in Step 4 to lock in the new matrix and diagnostics failure path.
- Consider persisting force intent (`resilience.resumeForced`) immediately after diagnostics pass to maximize crash recoverability in mid-resume interruptions.
