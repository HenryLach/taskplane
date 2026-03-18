## Plan Review: Step 2: Add `integration` to Orchestrator Config

### Verdict: REVISE

### Summary
The plan is close and correctly targets the three core files for this step (`types.ts`, `config-schema.ts`, `config-loader.ts`). However, the current Step 2 checklist is still too ambiguous around the unified config defaulting path, and it lacks explicit test coverage intent for the JSON/YAML + adapter contract this step changes. Tightening those two areas will reduce regression risk for backward-compatible config loading.

### Issues Found
1. **[Severity: important]** Step 2 checklist wording does not explicitly require updating the **camelCase runtime schema default** in `DEFAULT_ORCHESTRATOR_SECTION` (it currently says “add to `config-schema.ts` validation” in `STATUS.md:42`). This step must ensure `integration` exists in both `OrchestratorCoreConfig` and `DEFAULT_ORCHESTRATOR_SECTION` (`extensions/taskplane/config-schema.ts:204-219`, `extensions/taskplane/config-schema.ts:421-430`) so JSON/YAML loads always have a stable default.
2. **[Severity: important]** Test intent is underspecified for a config contract change. Step 4 is currently generic (`STATUS.md:54-60`), but this step needs explicit scenarios for: JSON load defaulting/override, YAML load mapping, and snake_case adapter projection (`toOrchestratorConfig`) where fields are manually mapped (`extensions/taskplane/config-loader.ts:718-729`). Existing adapter assertions (`extensions/tests/project-config-loader.test.ts:594-654`) should be extended to include `integration`.

### Missing Items
- Explicit Step 2 outcome: `integration` added to **both** legacy (`types.ts`) and unified (`config-schema.ts`) config models, including defaults.
- Explicit test coverage intent for:
  - JSON config path (`taskplane-config.json`) with/without `integration`
  - YAML path (`task-orchestrator.yaml`) with `orchestrator.integration`
  - Adapter output path (`toOrchestratorConfig` / `loadOrchestratorConfig`) including `orchestrator.integration`

### Suggestions
- Keep `mapOrchestratorYaml()` simple: `orchestrator` is already structural (`convertStructuralKeys`), so no special-case transform is needed for `integration`; focus mapping work on `toOrchestratorConfig()` and tests.
- Promote the useful preflight notes (`STATUS.md:132-138`) into the Step 2 checkbox text so implementation and review use the same explicit acceptance criteria.
