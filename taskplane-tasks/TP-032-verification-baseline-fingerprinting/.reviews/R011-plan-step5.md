## Plan Review: Step 5: Documentation & Delivery

### Verdict: REVISE

### Summary
The Step 5 plan is directionally correct but too minimal to reliably close TP-032 documentation work. In `STATUS.md`, the plan only states “Config reference docs updated” and “.DONE created,” which does not cover the explicit “check if affected” requirement for command docs or the multiple config-doc surfaces that now need synchronization. Tightening the plan outcomes will reduce the chance of shipping partial or inconsistent docs after a substantial behavior change.

### Issues Found
1. **[Severity: important]** — The plan omits the required “check if affected” pass for command documentation.
   - Evidence: `taskplane-tasks/TP-032-verification-baseline-fingerprinting/PROMPT.md:121-123` requires checking `docs/reference/commands.md` if verification affects merge output, but Step 5 in `taskplane-tasks/TP-032-verification-baseline-fingerprinting/STATUS.md:72-75` has no such outcome.
   - Suggested fix: Add an explicit Step 5 outcome to review `docs/reference/commands.md` and either update it or record “no change required” with rationale.

2. **[Severity: important]** — “Config reference docs updated” is too coarse for the actual verification surface area and can pass with incomplete docs.
   - Evidence: the orchestrator config doc currently has no verification section in schema overview or field tables (`docs/reference/configuration/task-orchestrator.yaml.md:15-23`, `:68-92`), no key mapping for `flaky_reruns` (`:168-190`), no section mapping entry for `verification` (`:193-206`), and no `verification` object in the JSON example (`:209-253`).
   - Suggested fix: Expand the Step 5 plan with explicit documentation outcomes covering those sections and the semantics introduced in code (`extensions/taskplane/config-schema.ts:309-355`), including enabled default, strict/permissive behavior, and flaky reruns.

### Missing Items
- Explicit documentation of the distinction between orchestrator baseline verification and merge-agent verification (`taskRunner.testing.commands` vs `merge.verify`) to prevent operator misconfiguration.
- A concrete “documentation validation” check (e.g., quick consistency pass across schema overview, field table, key mapping, section mapping, and JSON example) before marking Step 5 done.

### Suggestions
- When Step 5 lands, include a short STATUS note summarizing what was updated in docs and whether `commands.md` changed.
- After docs are finalized, create `.DONE` only once the above checks are captured to keep delivery criteria auditable.
