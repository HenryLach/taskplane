## Plan Review: Step 2: Expand global preferences schema

### Verdict: REVISE

### Summary
The Step 2 plan captures the main goal (expanding `GlobalPreferences` and updating extraction/application logic), but it is missing a critical compatibility outcome for existing `preferences.json` files. As written, the move to a TaskplaneConfig-shaped schema risks breaking current users who already rely on flat keys like `workerModel`/`reviewerModel`. It also needs an explicit guard to preserve existing preferences-only behavior.

### Issues Found
1. **[Severity: important]** — **No explicit backward-compatibility strategy for existing global preferences shape.** The plan says preferences should mirror `TaskplaneConfig` (optional), but current persisted files use flat keys (e.g., `workerModel`, `sessionPrefix`, `mergeModel`). Without explicit dual-read support or migration, existing user preferences will silently stop applying. **Suggested fix:** add a concrete outcome in Step 2: support legacy flat keys during transition (and optionally auto-migrate file format atomically).
2. **[Severity: important]** — **Plan does not explicitly preserve preferences-only fields (`dashboardPort`, `initAgentDefaults`).** Expanding to config-shaped preferences could unintentionally drop these current behaviors, regressing dashboard/init UX. **Suggested fix:** add an explicit Step 2 item that these fields remain supported and are not merged into runtime config unless intentionally mapped.

### Missing Items
- Explicit compatibility outcome for legacy flat-key preferences files (read compatibility and/or migration path).
- Explicit test coverage intent for:
  - legacy flat-key preferences still working,
  - expanded nested/global fields parsing,
  - preservation of preferences-only fields.

### Suggestions
- Consider defining `GlobalPreferences` as a typed deep-partial of config sections plus a small `preferencesOnly` extension; this reduces drift as config schema evolves.
- Keep allowlist logic centralized (single extractor/normalizer) to avoid field-by-field omissions when new config keys are added later.
