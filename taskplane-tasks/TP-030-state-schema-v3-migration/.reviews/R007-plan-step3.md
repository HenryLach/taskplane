## Plan Review: Step 3: Testing & Verification

### Verdict: REVISE

### Summary
The Step 3 plan covers the main happy-path migration checks, but it is still too thin for the risk profile of TP-030. The current checklist does not lock in the strict-v3 validation behavior added in Step 2 or the compatibility/error-guidance requirement from the mission. Tightening those outcomes now will prevent regressions in resumability and operator safety.

### Issues Found
1. **[Severity: important]** — Missing explicit regression outcomes for strict v3 rejection and nested v3 shape validation.
   - Evidence: Step 2 explicitly added strict checks for required v3 sections and deep nested validation (`STATUS.md:48-49`), and the validator now enforces these paths (`extensions/taskplane/persistence.ts:743-876`).
   - Gap: Step 3 only lists a generic “v3 clean read test” (`STATUS.md:58`) and does not include negative cases (e.g., `schemaVersion: 3` missing `resilience`/`diagnostics`, non-numeric `retryCountByScope` values, malformed `diagnostics.taskExits` entries).
   - Suggested fix: Add explicit test outcomes for malformed v3 payload rejection with `STATE_SCHEMA_INVALID` and targeted assertions for each deep-validated sub-structure.

2. **[Severity: important]** — The plan omits verification of unsupported-version upgrade guidance, which is a core mission requirement.
   - Evidence: Mission requires old runtimes to fail gracefully on v3 (`PROMPT.md:23-25`), and Step 2 notes upgrade-guidance messaging as a required behavior (`STATUS.md:47`; implemented in `extensions/taskplane/persistence.ts:408-409`).
   - Gap: Step 3 checklist (`STATUS.md:56-61`) does not include a test asserting the actionable version-mismatch message.
   - Suggested fix: Add an explicit test case for unsupported schema version error text containing upgrade guidance.

3. **[Severity: important]** — “Corrupt state test” is underspecified relative to the required paused-and-preserve semantics.
   - Evidence: Requirement is “enter `paused` with diagnostic, never auto-delete” (`PROMPT.md:24-25`, `PROMPT.md:80`), and `/orch` handler now sets paused phase in `paused-corrupt` branch (`extensions/taskplane/extension.ts:783-787`).
   - Gap: Step 3 only states “Corrupt state test” (`STATUS.md:60`) without asserting both no-deletion and runtime phase/diagnostic updates.
   - Suggested fix: Make the corrupt-state test outcome explicit: state file remains on disk, `orchBatchState.phase` becomes `paused`, and user-facing diagnostic is emitted.

### Missing Items
- Explicit intent to add the new migration-focused test artifact in scope (`extensions/tests/state-migration.test.ts`, per `PROMPT.md:52`) and what remains in `extensions/tests/orch-state-persistence.test.ts`.
- Explicit negative-case coverage for strict-v3 validation branches added in Step 2.

### Suggestions
- Use table-driven fixtures for v1/v2/v3 inputs so defaults/preservation checks are easy to extend.
- Keep unknown-field preservation scope explicit in assertions (top-level only) to avoid ambiguity.
