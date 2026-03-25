## Code Review: Step 2: Refactor Prompt Building to Use Templates

### Verdict: REVISE

### Summary
The refactor is close, but there are two blocking correctness gaps: one runtime placeholder mismatch in the supervisor template path, and one requirement miss around local override composition for routing mode. Both are fixable with small targeted changes.

### Issues Found
1. **[templates/agents/supervisor.md:25,55,92 + extensions/taskplane/supervisor.ts:1961-1980] [important]** — Placeholder name mismatch leaves unresolved `{{autonomy}}` tokens in the generated supervisor prompt.
   - Template uses `{{autonomy}}`, but the replacement map provides `autonomyLabel` (not `autonomy`).
   - Result: runtime prompt still contains literal braces in multiple places (Current Batch Context, Standing Orders, Autonomy table header).
   - **Fix:** either rename template placeholders to `{{autonomyLabel}}` or add `autonomy: autonomyLabel` to the vars map.

2. **[extensions/taskplane/supervisor.ts:1819-1821,2187] [important]** — Routing prompt does not append the intended local override file.
   - `loadSupervisorTemplate(name, stateRoot)` always resolves local file as `.pi/agents/${name}.md`.
   - `buildRoutingSystemPrompt()` calls `loadSupervisorTemplate("supervisor-routing", ...)`, so it looks for `.pi/agents/supervisor-routing.md`.
   - Step requirements specify `.pi/agents/supervisor.md` as the local override, and init scaffolds only `supervisor.md`.
   - **Fix:** allow `loadSupervisorTemplate` to accept a separate local-override name (e.g., base `supervisor-routing`, local `supervisor`) or compose routing template with `supervisor.md` explicitly.

### Pattern Violations
- None beyond the requirement miss above.

### Test Gaps
- Add/adjust tests to catch unresolved placeholders in rendered supervisor prompt (assert no `{{...}}` remains for known required vars).
- Add a routing composition test proving project-local `.pi/agents/supervisor.md` content is appended in routing mode (or explicitly document and scaffold a separate routing local file if that is the chosen contract).

### Suggestions
- Consider a tiny helper that validates required placeholders were replaced before returning the prompt (fail-soft log + fallback), which would prevent silent token leaks in future template edits.