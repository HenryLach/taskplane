## Code Review: Step 2: Interactive model selection in init

### Verdict: APPROVE

### Summary
This implementation delivers the Step 2 outcomes: provider → model selection with inherit-first behavior, same-for-all vs per-agent selection, follow-up thinking selection, config write-through, and graceful fallback when model discovery is unavailable. It is wired into both repo and workspace init paths while preserving non-interactive preset behavior (`interactive: !isPreset`). Coverage in `extensions/tests/init-model-picker.test.ts` validates the key picker branches and config application behavior.

### Issues Found
1. None.

### Pattern Violations
- None observed.

### Test Gaps
- No blocking gaps for this step.
- Optional future hardening: add a lightweight integration-style init test for interactive gating across `--preset` / `--dry-run` in both repo and workspace modes.

### Suggestions
- Consider making the default choice in the model submenu the first model (instead of `back`) to reduce accidental provider-looping when users press Enter quickly.
- The invalid input message in `promptMenuChoice()` currently says “Enter a menu number,” but aliases are also accepted; a slightly broader hint could reduce confusion.
