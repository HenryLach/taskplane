## Plan Review: Step 4: Documentation & Delivery

### Verdict: REVISE

### Summary
The Step 4 plan is too coarse for a documentation-heavy completion step. It captures the intent to update docs, but it does not explicitly cover all required documentation outcomes from the task prompt, especially the conditional `install.md` check. Tightening the plan to name required docs and key behavior to document will reduce the risk of shipping incomplete or misleading guidance.

### Issues Found
1. **[Severity: important]** — The plan item `Config reference docs updated` in `taskplane-tasks/TP-014-json-config-schema-and-loader/STATUS.md:66` is underspecified and does not explicitly enumerate the two required files from `PROMPT.md:91-94` (`docs/reference/configuration/task-runner.yaml.md` and `docs/reference/configuration/task-orchestrator.yaml.md`). Add outcome-level checklist items per file so completion is auditable.
2. **[Severity: important]** — The plan omits the required “check if affected” outcome for `docs/tutorials/install.md` from `PROMPT.md:95-96`. This is a real risk because `docs/tutorials/install.md:107-108` currently documents only YAML config files. Add an explicit conditional outcome: update the tutorial if onboarding/init now surfaces JSON-first config, or record why no update is needed.
3. **[Severity: minor]** — The documentation outcome does not call out key runtime semantics that changed and must be reflected (JSON-first precedence and `configVersion` validation/error behavior in `extensions/taskplane/config-loader.ts:257-305` and `:437-446`). Add a concise doc outcome ensuring these semantics are described alongside YAML fallback behavior.

### Missing Items
- Explicit per-file documentation outcomes for both required config reference docs.
- Explicit “checked `docs/tutorials/install.md` and updated or documented no-change rationale” outcome.
- A brief documentation parity check against implemented loader behavior (JSON precedence, YAML fallback, defaults/error semantics).

### Suggestions
- Replace the single docs checkbox with 3–4 outcome checkboxes: runner doc updated, orchestrator doc updated, install tutorial checked/updated, and final docs consistency pass.
- Keep `.DONE` creation gated on those documentation outcomes being complete.
