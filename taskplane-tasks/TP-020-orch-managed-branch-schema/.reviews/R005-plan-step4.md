## Plan Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The Step 4 plan is directionally correct, but it is too high-level to be deterministic for a verification step. In `STATUS.md`, the checklist currently uses broad items (`taskplane-tasks/TP-020-orch-managed-branch-schema/STATUS.md:60-63`) and does not yet encode all required verification outcomes from `PROMPT.md` (`taskplane-tasks/TP-020-orch-managed-branch-schema/PROMPT.md:109-113`, `130-134`). Tighten the plan to explicitly cover the compatibility and contract checks this task introduced.

### Issues Found
1. **[Severity: important]** The plan does not explicitly include the required full-suite command from the prompt (`cd extensions && npx vitest run`) and only states a generic outcome (`Unit tests passing`) in `STATUS.md:60`. For Step 4, the execution command should be explicit so review can confirm the “ZERO test failures” requirement in `PROMPT.md:107-110` was actually exercised.
2. **[Severity: important]** “Schema defaults verified” (`STATUS.md:61`) is underspecified relative to prompt-required checks (`PROMPT.md:110-112`). The plan should name the exact outcomes to validate: `freshOrchBatchState().orchBranch === ""` (`extensions/taskplane/types.ts:911-917`) and `DEFAULT_ORCHESTRATOR_CONFIG.orchestrator.integration === "manual"` (`extensions/taskplane/types.ts:147-157`).
3. **[Severity: important]** The plan misses explicit backward-compat verification intent for persisted-state loading with missing `orchBranch`, even though this is a completion criterion (`PROMPT.md:133`) and a key risk area touched in code (`extensions/taskplane/persistence.ts:369-379`).

### Missing Items
- Explicit Step 4 check for backward-compatible load behavior: persisted v2 state without `orchBranch` is normalized to `""`.
- Explicit reference to the existing integration default/mapping test path (`extensions/tests/project-config-loader.test.ts:658-671`) as part of verification intent.
- Explicit Advanced discoverability validation anchor (`extensions/tests/settings-tui.test.ts:1509-1519`) for ensuring editable fields (including integration) are excluded from Advanced.

### Suggestions
- Use a two-stage test flow: run targeted files first (persistence/config/settings), then run full `npx vitest run` before marking Step 4 complete.
- Log which assertions/files were used for each Step 4 checkbox in `STATUS.md` so completion is auditable.
