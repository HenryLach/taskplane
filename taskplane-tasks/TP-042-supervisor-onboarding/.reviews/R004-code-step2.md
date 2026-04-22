## Code Review: Step 2: Onboarding Flow (Scripts 1-5)

### Verdict: REVISE

### Summary
The routing-mode supervisor prompt and onboarding script coverage are substantially improved, and the prior routing-context transition bug in `activateSupervisor()` is fixed. However, the onboarding guidance still contains conflicting config-shape instructions, and the required `.pi/agents` override artifacts are not consistently required in the high-priority artifact lists. These conflicts can cause onboarding to generate incomplete or malformed setup output.

### Issues Found
1. **[extensions/taskplane/supervisor-primer.md:1005] [important]** — `testing.commands` is still documented with an array example (`["cd extensions && npx vitest run"]`), which conflicts with the schema contract (`Record<string,string>`) in `extensions/taskplane/config-schema.ts:85`.
   **Fix:** Change the example to object form, e.g. ``{"test":"cd extensions && npx vitest run"}``, and ensure all onboarding references use the same shape.

2. **[extensions/taskplane/supervisor.ts:595] [important]** — The routing prompt’s required artifact list says `.pi/agents/` should be created as “dir + README”, and Script 1 mirrors that (`extensions/taskplane/supervisor-primer.md:756`), while the detailed config section expects actual override files (`extensions/taskplane/supervisor-primer.md:1036-1040`). This inconsistency can miss the Step 2 requirement to generate `.pi/agents` overrides.
   **Fix:** Update the top-level artifact lists (routing prompt + Script 1, and thus Script 2/3 by inheritance) to explicitly require `task-worker.md`, `task-reviewer.md`, and `task-merger.md` (README optional).

### Pattern Violations
- Onboarding guidance is internally inconsistent about required artifact shape/content (schema examples and artifact lists disagree).

### Test Gaps
- No focused test asserts the onboarding prompt/primer contract for generated artifacts (`.pi/agents` override files + `testing.commands` object shape).

### Suggestions
- Add a small prompt-generation unit test that snapshots key required lines in `buildRoutingSystemPrompt()` for the `no-config` route so future edits don’t regress required onboarding artifacts.
