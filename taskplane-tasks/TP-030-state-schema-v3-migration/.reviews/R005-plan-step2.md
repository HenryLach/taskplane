## Plan Review: Step 2: Implement Migration

### Verdict: REVISE

### Summary
The Step 2 plan now covers most of the right migration outcomes (v1/v2 upconversion, corrupt-state handling direction, serializer carry-forward intent, and upgrade-guidance messaging). However, two important outcome gaps remain: explicit v3-field validation is not planned, and the preservation strategy for loaded v3 metadata is not yet grounded in the current runtime state model. These should be clarified before implementation to avoid silent data loss or accepting malformed v3 files.

### Issues Found
1. **[Severity: important]** — Missing explicit outcome for validating required v3 sections on read.
   - Evidence: `PROMPT.md:79` requires “v3 read: validate required fields, use defaults for optional,” but Step 2 checklist in `STATUS.md:43-47` does not include validation of `resilience`, `diagnostics`, or `tasks[].exitDiagnostic` shape.
   - Current risk surface: `validatePersistedState()` currently validates legacy fields and returns after upconversion (`extensions/taskplane/persistence.ts:382-735`) without v3-structure checks.
   - Suggested fix: add an explicit Step 2 outcome to validate v3-required fields/subfields and reject malformed v3 with `STATE_SCHEMA_INVALID`, while defaulting only documented optional subfields.

2. **[Severity: important]** — The plan’s “carry forward from runtime state” outcome is underspecified against current types, so preservation may still fail.
   - Evidence: Step 2 says to preserve non-default v3 fields via runtime (`STATUS.md:45`), but `OrchBatchRuntimeState` has no `resilience`, `diagnostics`, or unknown-field bucket (`extensions/taskplane/types.ts:854-899`). Serializer still overwrites with defaults (`extensions/taskplane/persistence.ts:871-899`), and resume reconstruction drops `exitDiagnostic` when rebuilding outcomes (`extensions/taskplane/resume.ts:1014-1031`).
   - Suggested fix: add an explicit outcome for a persistence bridge (e.g., runtime-attached persisted metadata snapshot) that survives load→resume→persist, including `exitDiagnostic` and unknown-field roundtrip behavior.

### Missing Items
- Test-coverage intent for unsupported/future schema version messaging (`PROMPT.md:81`) is missing from Step 3 (`STATUS.md:53-58`).
- A specific verification that corrupt-state startup does **not** delete `.pi/batch-state.json` and results in paused+diagnostic behavior is not explicitly listed.
- Clarify unknown-field preservation scope (top-level only vs nested records) so implementation/tests match `PROMPT.md:70`.

### Suggestions
- Keep `paused-corrupt` as a distinct startup recommendation and map it to runtime `paused` semantics in command handling, to avoid conflating corruption with a normal user pause.
