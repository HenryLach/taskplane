## Code Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The new tests substantially expand pure-function coverage for `quality-gate.ts`, and the suite is green (`cd extensions && npx vitest run` → 31 files / 1290 tests passing). However, Step 4’s checklist claims runtime behaviors that are still not actually exercised in tests. There is also a large accidental duplication of suites (`4.x`–`7.x`) that inflates maintenance cost and obscures what is truly covered.

### Issues Found
1. **[extensions/tests/quality-gate.test.ts:1308] [important]** — Duplicate test suites were appended (`4.x`, `5.x`, `6.x`, `7.x` already exist at lines 436, 523, 638, 717 and are repeated again at 1308, 1390, 1512, 1582). This creates redundant execution and makes future updates error-prone. **Fix:** remove the duplicated second block and keep one canonical version of each suite.
2. **[extensions/tests/quality-gate.test.ts:885,900,911,967,1051 + taskplane-tasks/TP-034-quality-gate-structured-review/STATUS.md:64-69] [important]** — Tests are labeled as runtime coverage for `.DONE` creation, remediation cycles, and fix-agent timeout/crash/non-zero handling, but they only validate pure helper logic (`applyVerdictRules`, `readAndEvaluateVerdict`, string generation) and never execute `executeTask()`, `doQualityGateReview()`, or `doQualityGateFixAgent()` branches in `extensions/task-runner.ts` (e.g., 1920-2039, 2686-2709, 2853-2904). This leaves the highest-risk control-flow paths unverified while status claims they are covered. **Fix:** add integration-style tests that drive task-runner quality-gate flow with mocked/spied agent spawn outcomes and assert `.DONE` presence/absence plus execution-log outcomes; or adjust STATUS claims to match actual unit-only coverage.

### Pattern Violations
- Duplicate numbered suites (`4.x`–`7.x`) in a single test file deviate from the existing test organization pattern and create ambiguous “source of truth” tests.

### Test Gaps
- No test currently validates that quality-gate disabled path actually writes `.DONE` via `executeTask()`.
- No test validates quality-gate PASS path writes `.DONE` with quality-gate metadata.
- No test validates terminal failure path leaves `.DONE` absent and records summary from real runner execution.
- No test validates fix-agent abnormal exits (timeout/crash/non-zero) consume budget in the real remediation loop.

### Suggestions
- Keep the strong pure-function matrix coverage, but split true runtime-path tests into a dedicated `task-runner` integration test file using controlled stubs for agent process outcomes.
- After deduplicating suites, update STATUS test counts (it currently references 1229/69 while current run is 1290/130).
