## Plan Review: Step 0: Preflight

### Verdict: REVISE

### Summary
The preflight checklist in `STATUS.md` covers the four files listed in the task prompt, but it is missing one critical surface that Step 1 explicitly depends on: persisted state serialization/validation. As written, the plan increases the chance of implementing `orchBranch` in runtime types but missing backward-compatible load/default behavior in persistence paths. A slightly broader preflight pass will materially reduce resume/schema regressions.

### Issues Found
1. **[Severity: important]** — `Step 0` currently scopes preflight to four files only (`taskplane-tasks/TP-020-orch-managed-branch-schema/STATUS.md:16-19`), but `Step 1` requires persistence serialization/deserialization changes (`STATUS.md:28`). The plan should explicitly include reading `extensions/taskplane/persistence.ts` sections that validate/default persisted state (`validatePersistedState`, defaults near `persistence.ts:323-646`) and serialize runtime state (`serializeRuntimeState`, object assembly near `persistence.ts:774-799`).
2. **[Severity: minor]** — Preflight does not include test-surface reconnaissance for the TUI/config contract, which is where regressions will be caught first. Add a quick scan of `extensions/tests/settings-tui.test.ts` coverage around section schema constraints and Advanced discoverability (`settings-tui.test.ts:520-560`, `1406-1522`) and legacy config adapter mapping in `extensions/taskplane/config-loader.ts:718-760`.

### Missing Items
- Add a preflight checkpoint to identify **where backward-compat defaults are applied** for new persisted fields (so `orchBranch` can safely default to `""` when absent).
- Add a preflight checkpoint to confirm **both config shapes** are covered for `integration`: unified camelCase config and legacy snake_case adapter output.

### Suggestions
- Record preflight discoveries in `STATUS.md` with file+line anchors before Step 1 starts; this will make later code review faster and reduce missed contract updates.
