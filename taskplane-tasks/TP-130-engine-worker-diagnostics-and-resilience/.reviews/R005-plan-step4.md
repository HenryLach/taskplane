## Plan Review: Step 4: Tests

### Verdict: REVISE

### Summary
The current Step 4 plan covers only the new fatal-handler wiring in `engine-worker.ts`, but it does not cover the other two behavior changes delivered in Steps 2 and 3. As written, this test step would leave key resilience outcomes (stderr persistence/tail surfacing and snapshot-failure degradation) unverified. I also checked prior review context: R003/R004 explicitly suggested adding a threshold behavior test, and that is still missing from the test plan.

### Issues Found
1. **[Severity: important]** — The Step 4 checklist in `STATUS.md` only includes handler-existence tests (`STATUS.md:41-44`) and omits coverage for Step 2 behavior in `extension.ts` (stderr tee + persisted log + tail included in failure alert; see `extension.ts:1011-1058` and `1133-1194`). **Suggested fix:** add at least one source/contract test that asserts stderr log path wiring and inclusion of stderr tail text in supervisor-alert summaries.
2. **[Severity: important]** — The plan still omits a targeted test for the Step 3 failure-threshold logic (`lane-runner.ts:315-333`, `628-695`), including both threshold disable behavior and success-reset behavior. This was already called out in earlier review notes (`STATUS.md:55`). **Suggested fix:** add a focused test (mocked timing or extracted helper) that validates: (a) 5 consecutive `emitSnapshot=false` events disable refresh, and (b) an `ok=true` event resets the consecutive counter.

### Missing Items
- Test coverage for Step 2 stderr capture + failure alert tail behavior.
- Test coverage for Step 3 consecutive-failure threshold and reset semantics.

### Suggestions
- Keep these as lightweight contract/source tests if full integration tests are expensive; the key is to lock the behavioral contract, not to overbuild test harnesses.
- You can extend existing files (`engine-worker-thread.test.ts`, `supervisor-alerts.test.ts`, or `lane-runner-v2.test.ts`) to keep diagnostics/resilience assertions discoverable.