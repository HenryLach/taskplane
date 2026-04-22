## Plan Review: Step 2: Add per-agent-type exclusion config

### Verdict: APPROVE

### Summary
The Step 2 plan is aligned with the prompt outcomes: it introduces exclusion fields for worker/reviewer/merge config, wires loader/default handling, and defines exact-match filtering behavior for forwarded extension specifiers. The scope is appropriate for this step and sets up Step 3 spawn wiring without over-prescribing implementation details. I don’t see any blocking gaps that would prevent this step from succeeding.

### Issues Found
1. **[Severity: minor]** — No blocking issues found.

### Missing Items
- None.

### Suggestions
- In `config-loader.ts`, explicitly ensure the new fields are carried through legacy adapters (`toTaskRunnerConfig` / `toOrchestratorConfig`) so Step 3 can consume exclusions without additional config re-loading paths.
- Consider normalizing `excludeExtensions` values (trim + dedupe) when loaded, so exact-match filtering remains deterministic even with accidental whitespace duplicates.
