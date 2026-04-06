## Plan Review: Step 3: Thinking level picker enhancement

### Verdict: REVISE

### Summary
The Step 3 plan is close and captures most core outcomes (full thinking levels, inherit option, and updates in both Settings TUI and CLI init). However, it currently drops a key requirement from the PROMPT: unsupported-thinking models must still allow thinking selection with only an informational note. Without that explicit outcome, implementation could incorrectly block or constrain user choices.

### Issues Found
1. **[Severity: important]** The plan item `Thinking column from pi --list-models` (STATUS.md) is too ambiguous and does not explicitly preserve the required permissive behavior from PROMPT.md Step 3 (`show note but still allow setting`). Suggested fix: add an explicit checklist item that unsupported models are annotated/informed only, while users can still choose any thinking level (runtime ignores unsupported settings).

### Missing Items
- Explicit outcome: **Do not block or hide thinking selection for models with `thinking=no`; only show guidance/note.**
- Targeted test intent for this behavior (unsupported model still permits selection and persists value).

### Suggestions
- Add a compatibility note/test for legacy values (`on`/`off`) mapping cleanly to new level-based picker defaults.
- Add parser coverage to ensure `pi --list-models` thinking column is consumed robustly even if column order/spacing varies.
