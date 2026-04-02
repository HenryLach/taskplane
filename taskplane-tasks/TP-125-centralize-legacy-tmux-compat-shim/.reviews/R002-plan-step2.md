## Plan Review: Step 2: Replace scattered compatibility logic

### Verdict: APPROVE

### Summary
The Step 2 plan is aligned with the task’s core outcome: moving remaining legacy TMUX compatibility handling behind the new shim while preserving current behavior. It correctly targets the two highest-impact ingress points (`config-loader.ts` and `persistence.ts`) and keeps a catch-all outcome for the remaining ingress call sites identified in Step 0. This is sufficient to proceed without re-planning.

### Issues Found
1. **[Severity: minor]** — The plan item “Update other ingress paths” is a bit broad; ensure this explicitly includes the Step 0 call sites in `worktree.ts` and `extension.ts` so no scattered spawn-mode compatibility checks are left behind.

### Missing Items
- None.

### Suggestions
- When executing this step, track each Step 0 call site to closure in STATUS.md (migrated to shim vs intentionally retained), so Step 4’s “exact legacy inputs still supported and where” can be completed directly from that ledger.
- Reuse shim helpers for both classification and message formatting where practical to avoid subtle wording/logic drift across warning surfaces.
