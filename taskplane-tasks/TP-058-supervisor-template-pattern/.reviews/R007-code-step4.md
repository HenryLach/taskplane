## Code Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
This step introduces a major regression: the TP-058 template-based supervisor/routing prompt implementation was removed from `supervisor.ts`, reverting behavior back to inline-only prompts. In addition, the new test surface is currently failing due to missing exported template loader functionality, so Step 4’s verification criteria are not met.

### Issues Found
1. **[extensions/taskplane/supervisor.ts:1773-1988, 2016-2163] [critical]** — TP-058 template composition behavior was effectively reverted.
   - `buildSupervisorSystemPrompt()` and `buildRoutingSystemPrompt()` now build inline prompts only.
   - Template loading/replacement path (`loadSupervisorTemplate`, placeholder substitution, routing template composition) is gone.
   - This breaks core task completion criteria for TP-058 (supervisor prompt must be template-based with fallback).

2. **[extensions/taskplane/supervisor.ts + extensions/tests/supervisor-template.test.ts] [critical]** — `loadSupervisorTemplate` is no longer exported/defined, breaking Step 4 tests.
   - Running `cd extensions && npx vitest run tests/supervisor-template.test.ts` yields 7 failing tests.
   - Failures include `TypeError: loadSupervisorTemplate is not a function` and local override composition assertions failing.

3. **[taskplane-tasks/TP-058-supervisor-template-pattern/STATUS.md:53-55] [important]** — Step 4 status claims verification succeeded, but current branch state does not support that claim.
   - STATUS says full suite passed except 3 pre-existing failures, but targeted Step 4 test file currently fails in multiple cases due this regression.

### Pattern Violations
- Reintroduced large inline prompt blocks instead of keeping the new base+local template pattern for supervisor/routing.

### Test Gaps
- Regression tests exist but are currently red because runtime code no longer exposes/uses the template loader path.
- No passing proof in this step that template variables are replaced and local override composition works after the latest edits.

### Suggestions
- Restore the template-loading helpers and wiring in `supervisor.ts` (including routing template + local override behavior), then re-run `tests/supervisor-template.test.ts` and update STATUS with actual results.
- Keep inline prompt text only as fallback path when template resolution fails, not as the primary/default path.