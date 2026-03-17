## Code Review: Step 1: Design Settings Navigation

### Verdict: REVISE

### Summary
Step 1 now contains a much stronger design artifact, especially around field contracts and non-editable field discoverability. However, there are still important internal inconsistencies that can cause incorrect Step 2 implementation choices (navigation structure and source badge behavior). These should be resolved in STATUS before proceeding.

### Issues Found
1. **[taskplane-tasks/TP-018-settings-tui-command/STATUS.md:317,410] [important]** — The navigation structure is internally inconsistent: Step 1 states a top-level SelectList with **11 items**, but later introduces an **"Advanced (JSON Only)" section #12**. This undermines the "final taxonomy/order" outcome and can cause implementation drift. **Fix:** Update one canonical section list/order (including Advanced if intended) and make all references consistent.
2. **[taskplane-tasks/TP-018-settings-tui-command/STATUS.md:334,349] [important]** — Source-badge rules still use broad "non-undefined" / "field present" language for user prefs, which conflicts with runtime merge semantics where empty-string string prefs are treated as not set (`extensions/taskplane/config-loader.ts:491-516`). This can mislabel `(user)` when effective value is actually project/default. **Fix:** Define source precedence per type: string prefs require non-empty value, enum/number prefs require defined valid value; align all generic rules with the field contract table.

### Pattern Violations
- Documentation consistency violation within a single design artifact (multiple conflicting "source of truth" statements for menu structure and source logic).

### Test Gaps
- No explicit Step 2 test intent for the empty-string preference edge case (`""` should clear preference and revert source/value to project/default).
- No explicit test intent for section rendering count/order consistency (including whether Advanced/JSON-only appears as a top-level section).

### Suggestions
- Add a single "Canonical Navigation Map" block near the top of Step 1 and reference it everywhere else.
- Add 3 source-badge examples that include the empty-string string-pref case to lock behavior before implementation.
