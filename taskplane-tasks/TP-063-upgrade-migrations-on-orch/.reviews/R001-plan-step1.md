## Plan Review: Step 1: Add Migration Runner

### Verdict: REVISE

### Summary
The migration runner structure is a good start (registry + idempotent pass + additive file creation behavior), but the current plan/implementation misses a core task requirement: migration state is being tracked in a new `.pi/migration-state.json` file instead of `.pi/taskplane.json`. That is a contract mismatch for this task and should be corrected before proceeding.

### Issues Found
1. **[Severity: important]** Requirement mismatch on state location (`extensions/taskplane/migrations.ts:11,46,55,58,79`) — the task explicitly requires migration completion to be tracked in `.pi/taskplane.json`, but this plan introduces `.pi/migration-state.json`.
   - **Why this blocks:** Step 1 completion criteria explicitly call out `.pi/taskplane.json` state tracking, so current direction will fail acceptance.
   - **Fix:** Load/merge/save migration metadata under `.pi/taskplane.json` (e.g., a `migrations.applied` map), preserving existing fields like `version`, `installedAt`, `lastUpgraded`, and `components`.

2. **[Severity: important]** Template-missing path is treated as successful skip (`extensions/taskplane/migrations.ts:123-125` + `182-185`) — when the source template is missing, the migration returns `null`, then is marked applied permanently.
   - **Why this matters:** Packaging/path regressions would be silently masked and never retried.
   - **Fix:** Treat missing template as a migration error (throw), so it is reported and retried later instead of being marked applied.

### Missing Items
- Explicit schema/update strategy for `.pi/taskplane.json` migration fields (including backward-compatible behavior when file is absent, malformed, or missing expected keys).
- A note that writes to `.pi/taskplane.json` must be merge-safe and non-destructive to existing version tracker metadata.

### Suggestions
- Keep `runMigrations()` pure around state shape by adding dedicated helpers like `loadTaskplaneMeta()` / `saveTaskplaneMeta()` to reduce accidental overwrite risk.
- Consider replacing the `__dirname` fallback in `resolvePackageRoot()` with a deterministic ESM-safe path strategy only (or an explicit injected `packageRoot`) to avoid runtime edge cases.