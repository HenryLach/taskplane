## Code Review: Step 5: Add behavioral regression test

### Verdict: REVISE

### Summary
The new test file adds useful coverage for `executeLaneV2` spawn-failure handling and correctly updates the `EXIT_CLASSIFICATIONS` length assertion. However, the step’s core requirement was a **behavioral regression test** proving engine-level visibility (`task-failure` alert emission and non-`executing` phase after spawn failure), and those checks are currently implemented as source-string assertions rather than runtime behavior. This leaves the exact failure mode from #561 insufficiently protected.

### Issues Found
1. **[extensions/tests/spawn-failure-visibility.test.ts:29-34, 375-413, 418-457] [important]** — Engine/resume assertions for retry guard, `task-failure` alert wiring, and wave phase transition are implemented as string matching against `engine.ts`/`resume.ts` source text, not executable behavior. This can pass even if runtime behavior regresses (e.g., dead code, unreachable branch, changed call path). **Fix:** replace these with at least one runtime test that drives engine wave execution with spawn-failure outcomes and asserts emitted alert payload (`context.exitCategory`) plus resulting `batchState.phase`.
2. **[extensions/tests/spawn-failure-visibility.test.ts:201-333] [important]** — The behavioral section only calls `executeLaneV2` directly; it does not validate the step’s requested one-task batch outcomes at engine level (`failedTasks === 1`, `task-failure` IPC alert fires, `phase !== "executing"`). **Fix:** add a focused engine-level regression test (mocking spawn helper/lane runner) that executes a minimal batch and asserts failed-task aggregation + alert emission + terminal phase transition.

### Pattern Violations
- None beyond the blocking gap above.

### Test Gaps
- Missing true behavioral assertion that `task-failure` IPC alert is emitted during orchestrator execution when spawn fails.
- Missing true behavioral assertion that engine phase leaves `executing` after all spawn-failed lanes in a wave.
- Missing behavioral check for `failedTaskIds.length === 1` in the single-task spawn-failure path.

### Suggestions
- Keep the new `executeLaneV2` behavioral tests as-is, but move source-string checks to optional guard tests (or remove them) once runtime tests are in place.
- Quality-check note: no configured static-check commands were discoverable (`.pi/taskplane-config.json` absent; no `typecheck`/`lint`/`format:check` scripts in root or `extensions/package.json`), so no lint/typecheck/format checks were run.
