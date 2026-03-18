## Plan Review: Step 1: Add `orchBranch` to Runtime + Persisted State

### Verdict: REVISE

### Summary
The Step 1 plan captures the core schema and persistence edits (`STATUS.md:29-31`, `STATUS.md:130-133`) and is aligned with the prompt’s required outcomes (`PROMPT.md:70-74`). However, it does not yet cover the resume hydration path, and the backward-compat defaulting approach is underspecified in a way that can leave `orchBranch` undefined for older v2 state files. Tightening those two areas will make the step deterministic and compliant with project persistence/resume expectations.

### Issues Found
1. **[Severity: important]** The plan omits updating resume-side runtime reconstruction to carry `orchBranch` from persisted state. Current resume reconstruction only rehydrates `baseBranch` and `mode` (`extensions/taskplane/resume.ts:611-616`), and project standards require persistence/resume changes to be handled together (`AGENTS.md:135-139`). Add a Step 1 outcome to set `batchState.orchBranch = persistedState.orchBranch || ""` during resume reconstruction.
2. **[Severity: important]** Backward-compat defaulting is ambiguous. The note says to validate `orchBranch` “like `baseBranch`” (`STATUS.md:132`), but current `baseBranch` handling is only optional validation plus v1 upconvert (`extensions/taskplane/persistence.ts:300-304`, `360-367`); it does not guarantee defaulting for pre-field v2 files. The plan should explicitly state where `orchBranch` is normalized to `""` during load/validation for older state files.

### Missing Items
- Explicit test coverage intent for Step 1 compatibility paths:
  - serialization writes `orchBranch`
  - loading a state file without `orchBranch` yields `""`
  - resume rehydration preserves `orchBranch` from persisted state

### Suggestions
- Add one concrete normalization point (e.g., in `validatePersistedState()` before return) so all callers get a stable `PersistedBatchState` shape.
- During implementation, quickly grep for `PersistedBatchState` object literals in tests to handle required-field compile fallout in one pass.
