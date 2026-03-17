## Plan Review: Step 4: Workspace Mode Init (Scenario C)

### Verdict: REVISE

### Summary
The Step 4 plan is directionally correct, but it is currently too compressed to guarantee all Scenario C outcomes. The checklist in `STATUS.md` captures high-level intent, yet it omits several required behaviors from the task prompt/spec that are easy to miss during implementation. Tightening the plan now will reduce rework risk in Step 5 and Step 6.

### Issues Found
1. **[Severity: important]** — Step 4 checklist under-specifies required outcomes versus the task prompt. `STATUS.md:71-73` has 3 broad items, while `PROMPT.md:78-83` requires explicit coverage for subrepo scan, repo selection, `.taskplane/` artifact creation, pointer creation, config-repo gitignore updates, and merge guidance. Add outcome-level items so completion is auditable.
2. **[Severity: important]** — The plan does not explicitly include config-repo `.gitignore` enforcement for workspace mode. This is required by `PROMPT.md:82` and spec guidance (`settings-and-onboarding-spec.md:429-431`), and should leverage the existing prefix-capable helper (`bin/taskplane.mjs:585-672`) so `.taskplane/` runtime artifacts are ignored in the selected config repo.
3. **[Severity: important]** — Workspace config content requirements are not explicit enough. The current plan says “`.taskplane/` creation” (`STATUS.md:71`) but does not call out `workspace.json` construction inputs (repo inventory + tasks-management location prompt/default from spec `settings-and-onboarding-spec.md:414-416,423-426`) nor pointer payload fields (`config_repo`, `config_path`; `:436-442`). Without that, implementation can produce incomplete or non-portable workspace init output.
4. **[Severity: minor]** — The plan lacks explicit risk mitigation for existing non-interactive and mode-branch behavior. Workspace mode currently short-circuits (`bin/taskplane.mjs:1023-1028`), and Step 4 should state compatibility intent for dry-run/preset/force paths while preserving Scenario D handoff behavior already signaled in `bin/taskplane.mjs:1006-1012`.

### Missing Items
- Explicit outcome for adding required gitignore entries in the **selected config repo** (with workspace-prefix handling) and reporting dry-run behavior.
- Explicit outcome for generating `workspace.json` with repo mapping + task-area location prompt/default.
- Explicit outcome for pointer JSON shape (`config_repo`, `config_path`) and location (`<workspace-root>/.pi/taskplane-pointer.json`).
- Step-level validation intent (at least: interactive selection, dry-run output, and generated-path correctness in config repo vs workspace root).

### Suggestions
- Split the first checkbox into two outcomes: “config repo selection” and “create `.taskplane/` files (`taskplane-config.json`, `workspace.json`, `agents/*`)”.
- Add one compatibility checkbox: “workspace flow preserves preset/dry-run safety and does not regress Scenario D detection path.”
