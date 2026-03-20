## Plan Review: Step 5: Documentation & Delivery

### Verdict: REVISE

### Summary
The Step 5 plan is too minimal for the documentation surface changed by TP-034. It includes a generic “Config docs updated” checkbox, but does not specify key outcomes needed to keep docs aligned with the new quality-gate runtime behavior and config contract. Expand the plan to cover affected-doc checks and config-key mapping updates before delivery.

### Issues Found
1. **[Severity: important]** — The plan omits the required “check if affected” documentation outcomes from the task prompt. `PROMPT.md:120-122` explicitly calls out `docs/explanation/execution-model.md` and `docs/reference/status-format.md`; however `STATUS.md:79-82` only tracks config docs + `.DONE`. Given `.DONE` semantics changed in code (`extensions/task-runner.ts:1920-2036`) and execution-model docs still show unconditional completion (`docs/explanation/execution-model.md:23,120-126`), Step 5 should explicitly include updating that doc (and recording a rationale if status-format is unchanged).
2. **[Severity: important]** — “Config docs updated” is underspecified for the actual config surface added. The reference doc currently has no `quality_gate` section in schema/field tables (`docs/reference/configuration/task-runner.yaml.md:15-29,35-120`) and no YAML→JSON key mappings for new keys (`docs/reference/configuration/task-runner.yaml.md:200-237`). The plan should explicitly require documenting all new fields/defaults (`enabled`, `review_model`, `max_review_cycles`, `max_fix_cycles`, `pass_threshold`) and their JSON equivalents (`taskRunner.qualityGate.*`) from `extensions/taskplane/config-schema.ts:170-182,445-450` and `extensions/taskplane/config-loader.ts:870-875`.
3. **[Severity: minor]** — Delivery closure criteria are not explicit beyond creating `.DONE`. Add an outcome to verify docs match implemented behavior (opt-in gate, fail-open, threshold semantics) before final completion, so Step 5 remains auditable against `PROMPT.md:126-130`.

### Missing Items
- Explicit Step 5 checkbox for `docs/explanation/execution-model.md` update (or documented “not affected” rationale).
- Explicit Step 5 checkbox for assessing/updating `docs/reference/status-format.md` with a recorded rationale.
- Explicit config-doc scope: section entry + defaults + threshold behavior + YAML/JSON mapping table + example JSON snippet including `taskRunner.qualityGate`.

### Suggestions
- Keep Step 5 outcome-oriented: one checkbox per affected doc and one for final doc/code consistency pass.
- When updating docs, cross-check defaults against `config-schema.ts` to avoid drift.
