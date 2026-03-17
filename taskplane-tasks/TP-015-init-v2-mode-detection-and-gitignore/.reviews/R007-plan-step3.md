## Plan Review: Step 3: tmux and Environment Detection

### Verdict: REVISE

### Summary
The Step 3 plan is directionally correct but still too thin for a high-impact `cmdInit()` change. It captures the headline outcomes (detect tmux, show guidance), but it does not yet call out key compatibility and integration risks that are already visible in current code. Tightening those outcomes now will prevent regressions in preset/dry-run behavior and future workspace-mode parity.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly cover how detected tmux state will be wired into generated config output. Today `spawn_mode` is hardcoded to `"subprocess"` in `generateOrchestratorYaml()` (`bin/taskplane.mjs:223-237`), so Step 3 should explicitly include replacing this with a detected value propagated through init vars. Also ensure alignment with the JSON transition contract noted in status (`STATUS.md:180-181`) so YAML/JSON do not diverge.
2. **[Severity: important]** — The plan is missing non-obvious behavior constraints from the spec: tmux-present path should be silent, tmux-missing path should emit clear install guidance (`settings-and-onboarding-spec.md:272-280`). Current Step 3 bullets in status (`STATUS.md:61-62`) do not mention silence-on-success or message semantics, which risks noisy or inconsistent UX.
3. **[Severity: important]** — The plan does not mention compatibility/risk handling for existing init flows (`--preset`, `--dry-run`, `runner-only`) that must remain stable (`PROMPT.md:128`, `STATUS.md:166-174`). Step 3 should state when detection runs, when messages print, and how behavior differs when orchestrator config is skipped (runner-only).

### Missing Items
- Step 3 validation intent: at minimum test/verify tmux-present vs tmux-absent branches, dry-run output behavior, and preset/non-interactive execution.
- Reuse intent for workspace init parity: spec requires tmux detection during any init mode (repo and workspace) (`settings-and-onboarding-spec.md:274`), so the plan should call out a reusable detection helper for Step 4.

### Suggestions
- Add one explicit outcome: “Introduce `detectSpawnMode()` (or equivalent) and pass its result through init variable assembly.”
- Record exact user-facing warning text (or required content) in the plan to avoid drift across iterations.
