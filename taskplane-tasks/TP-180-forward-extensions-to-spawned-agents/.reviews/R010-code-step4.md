## Code Review: Step 4: Add Settings TUI submenu

### Verdict: REVISE

### Summary
The new `Agent Extensions` section is a solid start: it adds discovery, per-agent toggles, persistence, and a clear empty-state message. However, there are two functional correctness issues around root selection and exclusion list mutation that can produce incorrect behavior in workspace/pointer and YAML-fallback setups. In addition, this step currently leaves an existing test suite failing.

### Issues Found
1. **[extensions/taskplane/settings-tui.ts:1341] [important]** — Extension discovery uses `loadPiSettingsPackages(resolvedRoot)` where `resolvedRoot` is the config root (can be pointer-resolved), not the runtime/project state root used by spawn paths. In workspace mode this can show an empty/wrong package list in TUI while agents still forward extensions from `workspaceRoot`. **Fix:** discover from the same root used by runtime forwarding (`configRoot`/state root), and keep `resolvedRoot` only for config read/write.
2. **[extensions/taskplane/settings-tui.ts:1426-1439] [important]** — Toggle mutations are based on `readRawProjectJson(resolvedRoot)` only. In YAML-only or mixed legacy setups, `currentExcludeList` becomes `[]`, so toggling one package can overwrite existing YAML exclusions instead of incrementally adding/removing from effective state. **Fix:** derive the base list from merged effective config (or JSON+YAML raw fallback) before applying add/remove.
3. **[extensions/tests/settings-tui.test.ts:512] [important]** — Step 4 increases sections from 13→14, but tests still assert 13 (`expect(SECTIONS).toHaveLength(13)`), causing test failure (`tests/settings-tui.test.ts`). **Fix:** update the section-schema test(s) to reflect the new `Agent Extensions` section.

### Pattern Violations
- Runtime consistency pattern: extension package discovery in TUI should use the same root semantics as worker/reviewer/merge forwarding to avoid operator-visible mismatch.

### Test Gaps
- No test coverage yet for Agent Extensions toggle write-back behavior (add/remove exact package).
- No coverage for pointer/workspace mode discovery root alignment.
- No coverage for YAML-seeded exclusion preservation when first JSON override is written.

### Suggestions
- Consider grouping rows by agent type (or a type-first submenu) for better UX when package count grows.
