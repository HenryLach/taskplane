## Plan Review: Step 5: Workspace Join (Scenario D)

### Verdict: REVISE

### Summary
The Step 5 plan is heading in the right direction, but it is too minimal to reliably deliver Scenario D without regressions. It currently captures discovery and pointer creation, but misses key required outcomes and compatibility/risk handling already visible in the current `cmdInit()` flow. Tightening these outcomes now should prevent another code-review bounce.

### Issues Found
1. **[Severity: important]** — The checklist omits a required Scenario D outcome: explicit confirmation of which existing config repo was found. `PROMPT.md:87-89` requires this, but `STATUS.md:86-87` only tracks discovery + pointer creation. Add an explicit outcome for the user-facing confirmation message.
2. **[Severity: important]** — The plan does not explicitly cover the control-flow change needed to make Scenario D pointer-only. In current code, workspace mode still proceeds through Scenario C scaffolding/prompt paths (`bin/taskplane.mjs:1034-1270`) after detection (`bin/taskplane.mjs:1016-1022`). Step 5 must state an early Scenario D branch that skips config-repo selection, `.taskplane/` scaffolding, gitignore updates, tracked-artifact prompts, and auto-commit.
3. **[Severity: important]** — Idempotency/overwrite behavior for the pointer file is not planned. Scenario D is user bootstrap and should be safe to re-run; plan should define behavior when `.pi/taskplane-pointer.json` already exists (reuse, overwrite prompt, or `--force` semantics), including dry-run output.
4. **[Severity: minor]** — No test/verification intent is stated for Step 5-specific branches. Given recent regressions in mode branching, include outcome-level validation for: workspace join happy path, dry-run pointer-only behavior, and preservation of Scenario C when no existing `.taskplane/` is found.

### Missing Items
- Explicit “show found config repo/path” outcome for Scenario D UX.
- Explicit “pointer-only early return” outcome that prevents Scenario C file generation and git side effects.
- Pointer idempotency behavior definition (`existing pointer`, `--force`, `--dry-run`, non-interactive/preset).
- Step-level validation intent for Scenario D-specific paths.

### Suggestions
- Keep Step 5 to 3-5 outcome-level checkboxes, but include one compatibility item: “Scenario D branch does not regress Scenario C selection/scaffold flow.”
- Reuse the existing detection result (`effectiveConfigPath`) as the single source for both confirmation messaging and pointer payload.
