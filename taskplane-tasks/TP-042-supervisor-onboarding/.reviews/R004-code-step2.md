## Code Review: Step 2: Onboarding Flow (Scripts 1-5)

### Verdict: REVISE

### Summary
Step 2 makes solid progress by adding a dedicated routing-mode supervisor prompt and expanding the supervisor primer with Scripts 1-8 guidance. However, there is a state-transition bug that breaks the onboarding-to-execution handoff, and the onboarding config template currently conflicts with the project’s JSON config schema. These are correctness issues that should be fixed before moving on.

### Issues Found
1. **[extensions/taskplane/supervisor.ts:902-903,1060-1076] [critical]** — `activateSupervisor()` sets `state.routingContext` when routing mode is used, but never clears it when later activating in normal batch-monitoring mode. If a user runs `/orch` (no args) for onboarding and then starts a batch with `/orch all`, `registerSupervisorPromptHook()` will keep injecting the routing prompt instead of the batch supervisor prompt.
   **Fix:** Clear routing mode on non-routing activation (e.g., set `state.routingContext = routingContext ?? null` near activation start, or explicitly set `state.routingContext = null` before the non-routing path).

2. **[extensions/taskplane/supervisor-primer.md:952] [important]** — The onboarding config template shows `taskRunner.testing.commands` as an array (`["<detected-test-command>"]`), but the schema expects a map/object (`Record<string, string>`) (`extensions/taskplane/config-schema.ts:85`). This can produce malformed config shape during onboarding.
   **Fix:** Update the template/example to object form, e.g. `"testing": { "commands": { "test": "<detected-test-command>" } }`, and keep examples consistent with config docs.

### Pattern Violations
- Onboarding template content in `supervisor-primer.md` diverges from canonical config schema (`taskRunner.testing.commands` type mismatch).

### Test Gaps
- No regression test for the routing→batch transition ensuring the prompt hook switches from `buildRoutingSystemPrompt()` to `buildSupervisorSystemPrompt()` after `/orch all`.
- No test/assertion validating onboarding-generated config shape for `taskRunner.testing.commands`.

### Suggestions
- Add a small unit test around `activateSupervisor()` that exercises both routing and non-routing activations in sequence and asserts `state.routingContext` transitions correctly.
