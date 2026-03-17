## Plan Review: Step 3: Implement Write-Back

### Verdict: REVISE

### Summary
The Step 3 plan is currently too thin to safely implement write-back behavior without regressions. It states the two headline goals, but it does not yet define critical outcomes around dual-layer destination selection, workspace/YAML path semantics, and failure-safe write behavior. Tightening those outcomes now should prevent routing mistakes and rework in Step 4.

### Issues Found
1. **[Severity: important]** — Step 3 is still only two generic checklist bullets (`taskplane-tasks/TP-018-settings-tui-command/STATUS.md:66-67`), but the implementation needs an explicit destination workflow for L1+L2 fields. The current UI seam is only a placeholder notify (`extensions/taskplane/settings-tui.ts:866-873`), while Step 1 already defines user-vs-project save choices for dual-layer fields (`taskplane-tasks/TP-018-settings-tui-command/STATUS.md:416-421`). **Suggested fix:** add a Step 3 outcome that formalizes the destination matrix (L1-only, L2-only, L1+L2) including clear/unset behavior per field type.
2. **[Severity: important]** — The plan does not explicitly cover workspace-root resolution and YAML-backed project scenarios, despite hard requirements for config-repo writes in workspace mode (`PROMPT.md:77`) and JSON/YAML verification (`PROMPT.md:83-84`). Existing loader semantics are strict here (`extensions/taskplane/config-loader.ts:557-570`). **Suggested fix:** add an outcome stating Layer 1 always writes to `<resolveConfigRoot(...)>/.pi/taskplane-config.json`, including intentional behavior when source config is YAML-only.
3. **[Severity: important]** — Risk handling for writes is missing: confirmation scope, cancel/no-op behavior, directory creation, and partial-write safety are not yet in the plan. Preferences path creation has existing precedent (`extensions/taskplane/config-loader.ts:406-433`), and the codebase uses temp-write + rename for durable state writes (`extensions/taskplane/persistence.ts:835-866`). **Suggested fix:** add a Step 3 safety outcome covering confirmation gate for project writes, no side effects on cancel, and robust write/error handling strategy.

### Missing Items
- A concise **Step 3 implementation contract** (write destination rules + confirmation rules + clear/unset semantics).
- Explicit intent for post-write behavior (e.g., keep current “restart session to apply” policy from Step 2, or refresh in-memory view deliberately).
- Step 3/4 test-intent bullets for: confirm accept/decline, L1+L2 destination choice, and YAML-only project -> JSON write-back path.

### Suggestions
- Add 3–4 outcome-level bullets under Step 3 in `STATUS.md` mirroring the above contract.
- Reuse existing loader/path helpers instead of introducing new path resolution logic.
