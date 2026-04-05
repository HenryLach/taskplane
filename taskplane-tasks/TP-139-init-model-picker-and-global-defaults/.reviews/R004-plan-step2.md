## Plan Review: Step 2: Interactive model selection in init

### Verdict: APPROVE

### Summary
The Step 2 plan in `STATUS.md` covers the core required outcomes from `PROMPT.md`: provider→model selection, inherit-first behavior, per-agent vs shared selection, thinking mode prompting, config write-back, and graceful fallback when models are unavailable. The scope is appropriately focused on init UX integration and is consistent with the dependency on Step 1 model discovery. I do not see a blocking gap that would force rework later.

### Issues Found
1. **[Severity: minor]** — The plan does not explicitly call out preserving non-interactive init paths (`--preset`, `--dry-run`) and both init modes (repo/workspace) when wiring prompts and config writes. Suggest adding an explicit guard/check in implementation (and tests) so interactive prompts only run in interactive flows and the generated config is updated consistently in both modes.

### Missing Items
- None.

### Suggestions
- Add targeted tests for: (a) inherit/skipped picker path, (b) “same for all” vs per-agent selection, and (c) degraded mode when `pi --list-models` is unavailable.
- Keep the model/thinking prompt defaults aligned with TP-138 inherit semantics (`"inherit"` UI mapped to empty-string config values).
- Reuse existing init config generation hooks where possible so the new selections are applied uniformly to both repo and workspace scaffolding paths.
