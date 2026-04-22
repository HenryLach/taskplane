## Plan Review: Step 3: Thinking picker in /taskplane-settings

### Verdict: REVISE

### Summary
The Step 3 plan covers most core picker mechanics (switching from free-text, fixed inherit/on/off options, reuse of `selectScrollable()`, current-value checkmark, and write destination handling). However, it currently misses one explicit mission requirement from `PROMPT.md` for model-change UX guidance. Without that item, this step can complete while still failing a stated task outcome.

### Issues Found
1. **[Severity: important]** — Missing required “model changed → suggest thinking on” behavior. `PROMPT.md:36` explicitly requires: when a model is changed to one with thinking support, suggest setting thinking to `"on"`. The current Step 3 checklist in `STATUS.md:40-44` does not include this outcome, so implementation may omit it.

### Missing Items
- Add an explicit Step 3 plan item to implement the model-change suggestion behavior from `PROMPT.md:36` (including how to determine “thinking support” from model metadata and where the suggestion is shown in the `/taskplane-settings` flow).

### Suggestions
- Keep picker persistence semantics explicit in the implementation notes: selecting “inherit” should persist as empty string (`""`) / clear semantics, not a literal label string.
- Reuse the same picker UX pattern for all three thinking fields so source badges and save-destination behavior remain consistent with existing settings flows.
