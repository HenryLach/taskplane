## Plan Review: Step 3: Testing & Verification

### Verdict: REVISE

### Summary
The Step 3 plan is directionally correct, but it is too broad for the risk profile of the new unified loader. Given the regressions already found in Step 2, the test plan needs explicit outcome-level coverage for precedence, adapter compatibility, and workspace-root resolution behavior. Without those additions, it is likely to miss contract breaks while still reporting green test runs.

### Issues Found
1. **[Severity: important]** — The planned test outcomes in `taskplane-tasks/TP-014-json-config-schema-and-loader/STATUS.md:52-54` do not explicitly cover the JSON/YAML precedence and failure-path matrix implemented in `extensions/taskplane/config-loader.ts:257-305` and `:437-453` (JSON present-valid, JSON malformed, missing version, unsupported version, JSON absent + YAML present, none present). Add an explicit matrix outcome so error semantics are verified, not inferred.
2. **[Severity: important]** — The plan does not call out regression coverage for dictionary-key preservation in adapter/mapping logic (`extensions/taskplane/config-loader.ts:179-247`, `:468-543`). This is a known risk area from R006 (e.g., `assignment.size_weights`, `pre_warm.commands`, task area IDs), and current tests in `extensions/tests/discovery-routing.test.ts:1170-1238` and `:1536-1668` only validate `repo_id` behavior, not broader key-preservation contracts.
3. **[Severity: important]** — The plan omits explicit verification of workspace-root config resolution behavior (`extensions/taskplane/config-loader.ts:397-421`), especially the case where `cwd/.pi` exists but config files are only at `TASKPLANE_WORKSPACE_ROOT`. Add a dedicated regression outcome for this path, since it previously regressed and is central to orchestrated/worktree execution.

### Missing Items
- Explicit compatibility test intent for `loadOrchestratorConfig()` and `loadTaskRunnerConfig()` wrapper contracts in `extensions/taskplane/config.ts:26-38` (legacy snake_case output shape remains stable).
- Explicit distinction between loader-level throw behavior and task-runner fallback behavior (`extensions/task-runner.ts:149-156`) when JSON is malformed.
- A targeted test scope statement (e.g., a focused `config-loader` test file) so failures localize to loader behavior instead of only surfacing through broad integration suites.

### Suggestions
- Keep the Step 3 checklist outcome-based, but add 4–6 named scenarios covering precedence/errors, key preservation, workspace-root fallback, and adapter compatibility.
- Run the focused tests first, then full `cd extensions && npx vitest run` as the final gate.
