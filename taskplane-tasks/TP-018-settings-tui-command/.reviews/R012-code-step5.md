## Code Review: Step 5: Documentation & Delivery

### Verdict: REVISE

### Summary
Step 5 covers the required documentation surfaces and task-closure artifacts (`README.md`, `docs/reference/commands.md`, `docs/tutorials/install.md`, `.DONE`, `STATUS.md`). However, the new `/settings` reference includes at least one behavior claim that does not match runtime behavior. Because this step is explicitly documentation-focused, these accuracy issues should be corrected before approval.

### Issues Found
1. **[docs/reference/commands.md:450] [important]** — The `/settings` “Common responses” section claims an error when “config root cannot be resolved,” but `resolveConfigRoot()` falls back to `cwd` instead of throwing (`extensions/taskplane/config-loader.ts:557-569`). Actual user-visible failures are the exec-context guard (`extensions/taskplane/extension.ts:84-92`) or generic load/save failures (`extensions/taskplane/extension.ts:657-659`). **Fix:** Replace this line with real, stable user-facing error conditions/messages.
2. **[docs/reference/commands.md:446] [minor]** — The Advanced section description says it lists only “collection/Record/array fields,” but implementation surfaces any uncovered leaf field, including primitives (`extensions/taskplane/settings-tui.ts:816`) and explicitly tests `configVersion` visibility (`extensions/tests/settings-tui.test.ts:1439`). **Fix:** Reword to “read-only listing of uncovered/non-editable fields” (or equivalent).

### Pattern Violations
- `docs/reference/commands.md:5` still frames slash commands as only ``/task`` and ``/orch*`` even though `/settings` is now documented; this creates an internal reference-page inconsistency.

### Test Gaps
- No doc-validation checks assert that command-reference “Common responses” match actual command output paths.

### Suggestions
- Keep all pi slash commands grouped together in the reference structure (or explicitly explain why `/settings` is separated under “Configuration Commands”).
