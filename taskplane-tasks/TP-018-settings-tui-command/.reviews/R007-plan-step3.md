## Plan Review: Step 3: Implement Write-Back

### Verdict: REVISE

### Summary
The Step 3 plan is much stronger than the previous revision: it now covers destination routing, confirmation behavior, and atomic writes. However, it still leaves one high-risk outcome underspecified for YAML-only projects, and the test intent remains too broad for a risky migration path. Tightening those two items will make the write-back behavior safe and predictable.

### Issues Found
1. **[Severity: critical]** — The YAML-only write-back outcome can silently drop existing project settings. `STATUS.md:67` says to create a new JSON file when only YAML exists, but does not require seeding JSON with the current Layer-1 config. Because the loader is JSON-first (`extensions/taskplane/config-loader.ts:574-575`, `extensions/taskplane/config-loader.ts:595-603`), a minimal JSON file would override YAML and reset non-edited fields to defaults on next load. **Suggested fix:** explicitly require: when bootstrapping JSON from YAML-only, initialize JSON from the current effective Layer-1 config (or merged raw YAML) plus `configVersion`, then apply only the edited field.
2. **[Severity: important]** — Test coverage intent is still too generic for this risk profile. Step 4 currently only says “Write-back tested” (`STATUS.md:77`) without naming key regression scenarios. **Suggested fix:** add explicit test intent for (a) YAML-only → JSON bootstrap preserves pre-existing YAML values, (b) L1+L2 destination choice + confirm/cancel no-op behavior, and (c) optional/unset clear semantics for both layers.

### Missing Items
- Explicit migration-preservation rule for YAML-only projects (preserve all existing L1 values, not just the edited key).
- Explicit requirement that bootstrapped JSON includes valid `configVersion` (required by loader validation at `extensions/taskplane/config-loader.ts:290-303`).
- Concrete Step 4 scenarios for high-risk write-back paths.

### Suggestions
- Add one Step 3 contract bullet: “YAML-only bootstrap writes full current L1 snapshot + patch, never partial skeleton.”
- In Step 4, include at least one fixture-based test for YAML-only projects to prevent future regressions.
