## Plan Review: Step 1: Implement Preferences Loader

### Verdict: REVISE

### Summary
The Step 1 plan captures the main outcomes (schema, loader, merge), but it is still under-specified on the most failure-prone boundary: exactly which fields are allowed to override project config. Given the explicit “Do NOT” constraint, the plan should lock an allowlisted merge contract before implementation to avoid accidental broad deep-merge behavior.

### Issues Found
1. **Severity: important** — The plan does not explicitly define the Layer 2 allowlist for merge behavior. `STATUS.md:29` says “Merge logic with project config correct,” but it does not anchor correctness to the dependency/constraint in `PROMPT.md:29` and `PROMPT.md:96` (only user-overridable fields; no Layer 1 overrides). **Fix:** add a concrete Step 1 outcome that enumerates which runtime fields can be overridden by preferences and confirms all other fields are ignored.
2. **Severity: important** — Key-shape mapping is not called out, despite schema mismatch risk: Step 1 preferences are defined in snake_case (`PROMPT.md:58`), while runtime config is camelCase (e.g., `tmuxPrefix`, `operatorId`, `worker.model` in `extensions/taskplane/config-schema.ts:105-119,204-219`). Without an explicit mapping outcome, values may be silently dropped or merged into wrong keys. **Fix:** add a plan item documenting snake_case→runtime-field mapping and where it is applied (ideally in unified load path, e.g., `loadProjectConfig()` in `extensions/taskplane/config-loader.ts:437-453`).

### Missing Items
- An explicit non-goal/guardrail that unknown preference keys are ignored (not deep-merged) to preserve Layer 1 boundaries.
- A failure-path outcome for malformed `preferences.json` (fallback/repair behavior) so config loading remains resilient.
- Test intent (Step 2 linkage) for “attempted override of non-user field is ignored.”

### Suggestions
- Add a short discovery note listing the exact preference-to-config mapping table to make Step 2 assertions straightforward.
- Keep the merge entry point centralized in `config-loader.ts` so orchestrator and task-runner inherit identical behavior.
