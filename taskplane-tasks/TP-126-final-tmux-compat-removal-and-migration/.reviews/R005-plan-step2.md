## Plan Review: Step 2: Update schema/types/docs/templates

### Verdict: APPROVE

### Summary
The Step 2 plan is aligned with the PROMPT outcomes for this phase: it covers schema/type cleanup, template + config doc updates, and command/doctor documentation alignment for the final no-TMUX contract. It also incorporates the prior cross-step review feedback (R003) by explicitly including settings/UI metadata alignment so the UX does not advertise removed values. I do not see any blocking gaps that would prevent this step from achieving its stated outcomes.

### Issues Found
1. **[Severity: minor]** — No blocking issues found.

### Missing Items
- None.

### Suggestions
- While updating docs, ensure the migration-oriented spec note (`docs/specifications/framework/taskplane-runtime-v2/06-migration-and-rollout.md`) is kept consistent with the final no-TMUX contract, even if finalized in Step 4.
- In command/doctor doc updates, call out expected user-facing guidance for legacy fields/values (e.g., `tmuxPrefix`, `spawn_mode: tmux`) so operator remediation remains explicit.
