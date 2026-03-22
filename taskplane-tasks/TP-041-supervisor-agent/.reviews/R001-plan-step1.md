## Plan Review: Step 1: Supervisor System Prompt + Activation

### Verdict: APPROVE

### Summary
The Step 1 plan is aligned with the required outcomes: introducing a supervisor module, activating it after non-blocking `/orch` start, and handling model inheritance with override support. The planned direction is consistent with the existing TP-040 architecture and the current extension lifecycle. I don’t see blocking gaps that would force rework later.

### Issues Found
1. **Severity: minor** — The Step 1 checklist wording in `STATUS.md` captures identity/context/capabilities, but it does not explicitly restate the required standing orders and explicit `supervisor-primer.md` read instruction. Suggested fix: include those two prompt elements explicitly in the Step 1 implementation notes/checklist text to reduce drift risk.

### Missing Items
- None blocking.

### Suggestions
- Make the activation guard explicit in implementation notes: supervisor system-prompt injection should only apply while a batch is active (to avoid persona bleed into normal non-orch turns).
- When implementing `supervisor.model`, explicitly trace it through the existing config chain (`taskplane-config.json` + user preferences + `/taskplane-settings`) so the setting is clearly operator-visible and testable.
