## Code Review: Step 4: Settings TUI — source badges and save behavior

### Verdict: REVISE

### Summary
The Step 4 changes correctly implement most required outcomes: source badges are now `(global)`/`(project)` only, global is the default destination, sparse project writes are in place, and the remove-override path is implemented. However, there is one blocking interaction bug in the save-destination flow: cancelling the destination picker currently still performs a write to global preferences. This can cause unintended config mutations.

### Issues Found
1. **[extensions/taskplane/settings-tui.ts:545, 1379] [important]** — Esc/cancel from destination selection is treated as an implicit global save.
   - `ctx.ui.select("Save this change to:", options)` can return no selection on cancel/escape.
   - `resolveWriteAction()` currently maps `!destinationChoice` to the default destination (`"prefs"`), so a cancelled picker still writes.
   - This is inconsistent with cancellation semantics used elsewhere in the same TUI (e.g., section selection uses `null` to cancel) and can silently mutate preferences when the operator intended to abort.
   - **Suggested fix:** treat `null`/`undefined` destination choice as `"skip"` (cancel), while keeping global as the default *selected option* in the picker UI. Update tests accordingly.

### Pattern Violations
- None beyond the cancellation handling bug above.

### Test Gaps
- Add coverage for destination-picker cancellation semantics (`null`/escaped select should not write).
- Add explicit unit coverage for the `"remove-project"` route in `resolveWriteAction()` and for the corresponding write path.

### Suggestions
- Minor cleanup: several test names still reference legacy wording (`'default'`, `'user'`, `'Project config (shared)'`) even though behavior/messages were updated; renaming would improve maintainability and readability.