## Plan Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The Step 4 plan is currently too generic to reliably verify the riskier parts of `/settings`. It lists broad outcomes, but it does not yet encode the specific scenarios required by the prompt and by prior review findings. Tightening the test intent now will prevent regressions in YAML handling, source-badge behavior, and write destination safety.

### Issues Found
1. **[Severity: important]** — The test plan bullets are too broad (`taskplane-tasks/TP-018-settings-tui-command/STATUS.md:81-83`) and do not specify the required JSON/YAML matrix from the task prompt (`taskplane-tasks/TP-018-settings-tui-command/PROMPT.md:83-85`). This is risky given custom YAML→raw conversion and fallback logic in `extensions/taskplane/settings-tui.ts:251-285` and `extensions/taskplane/settings-tui.ts:877-883`. **Suggested fix:** add explicit Step 4 scenarios for JSON-only, YAML-only, and JSON+YAML precedence when computing displayed values/source badges.
2. **[Severity: important]** — The plan does not call out verification of destination choice and confirmation/cancel no-op paths in the main settings loop (`extensions/taskplane/settings-tui.ts:1051-1072`). Existing tests are helper-focused (`extensions/tests/settings-tui.test.ts:4-19`) and do not cover this interaction flow. **Suggested fix:** add at least one interaction-level test (or explicit manual verification script) for L1+L2 destination selection, project confirm decline, and “Cancel” producing zero file mutation.
3. **[Severity: important]** — No Step 4 test intent is documented for the “new parameters are immediately discoverable” completion criterion (`taskplane-tasks/TP-018-settings-tui-command/PROMPT.md:25-26,106`). The implementation relies on dynamic traversal plus a curated subsection list (`extensions/taskplane/settings-tui.ts:724-814`), which can drift as schema evolves. **Suggested fix:** include a regression test intent ensuring uncovered/new fields appear in Advanced/JSON-only surfacing.

### Missing Items
- Explicit scenario list for source-indicator correctness under YAML-backed configs (including empty-string preference clear semantics).
- Explicit zero-side-effect verification for canceled writes (destination cancel and project confirmation decline).
- Explicit discoverability regression coverage for schema additions/uncovered fields.

### Suggestions
- Add a short “Step 4 verification matrix” block in `STATUS.md` with named scenarios and expected outcomes.
- Keep one fast unit-fixture suite (`settings-tui.test.ts`) plus one behavior-level flow test around `showSectionSettingsLoop` decision paths.
