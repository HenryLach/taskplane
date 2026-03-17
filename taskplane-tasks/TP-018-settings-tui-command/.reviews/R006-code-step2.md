## Code Review: Step 2: Implement /settings Command

### Verdict: REVISE

### Summary
The `/settings` command is wired correctly in `extension.ts` and the new TUI module is substantial and readable. However, there are a few important correctness gaps before this is safe to treat as complete: source-badge logic can diverge from actual merged-value semantics, numeric validation does not match the stated contract, and schema discoverability is still hardcoded rather than automatic.

### Issues Found
1. **[extensions/taskplane/settings-tui.ts:342-353]** [important] — `detectFieldSource()` marks L2 fields as `(user)` based on raw key presence, but does not enforce the same allowlist/type semantics used by `loadUserPreferences()/extractAllowlistedPreferences()` in `config-loader.ts`. Example: invalid raw prefs values (wrong type) can produce a `(user)` badge while the displayed value actually comes from project/default. **Fix:** normalize source detection through the same typed/allowlisted preference extraction path (or equivalent per-field type guards) before applying source rules.
2. **[extensions/taskplane/settings-tui.ts:428-436]** [important] — Number validation accepts `0` (`num < 0`), while the implementation contract says “positive integers” and the error text says “Must be a positive number.” This will permit values that violate the declared validation policy. **Fix:** enforce `num > 0` by default and add a small field-specific bounds map for constrained fields (e.g., percent thresholds).
3. **[extensions/taskplane/settings-tui.ts:91-187,470-505,870-881]** [important] — Settings coverage is manually enumerated (`SECTIONS`, advanced items, JSON-only footer map). This does not satisfy the task requirement that new schema parameters are immediately discoverable without manual updates. **Fix:** derive displayable fields from schema/default structure (or a generated descriptor table) and route unknown/non-editable fields into Advanced automatically.

### Pattern Violations
- Behavior-heavy addition (`/settings` UI, parsing, validation, provenance logic) landed without corresponding automated tests in `extensions/tests/`, which conflicts with project guidance to add/update tests for behavior changes.

### Test Gaps
- No tests for source-badge precedence edge cases (especially invalid-type prefs vs allowlisted merge behavior).
- No tests for numeric validation boundary behavior (`0`, negatives, non-integers, percent-like fields).
- No tests asserting field discoverability behavior when schema/default objects gain new keys.

### Suggestions
- Add focused unit tests around `detectFieldSource()`, `getFieldDisplayValue()`, and `validateFieldInput()`; these are pure and easy to harden.
- Consider caching `resolveConfigRoot(configRoot)` once in `openSettingsTui()` instead of resolving twice.
