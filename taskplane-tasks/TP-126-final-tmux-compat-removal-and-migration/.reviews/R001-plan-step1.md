## Plan Review: Step 1: Remove remaining compatibility paths

### Verdict: REVISE

### Summary
The plan is close to the required outcomes for removing TMUX-era config/runtime compatibility, and it correctly keeps migration guidance in scope. However, it is currently ambiguous on the persisted-state path (`lanes[].tmuxSessionName`), where Step 0 explicitly chose a one-release migration grace rather than hard removal. Tightening that outcome in Step 1 is important to avoid an accidental contract break.

### Issues Found
1. **[Severity: important]** — The Step 1 checklist item “Remove/retire `tmuxSessionName` persisted-lane ingress handling” does not explicitly preserve the Step 0 migration policy (accept legacy field for one release with warning, normalize to `laneSessionId`, and persist canonical on next write). As written, this could be implemented as immediate rejection and violate the task’s safety requirement. **Suggested fix:** make this item explicit about migration-only acceptance + warning + canonical rewrite behavior for this release.

### Missing Items
- Explicit Step 1 outcome for `lanes[].tmuxSessionName`: migration-only ingest (not normal runtime contract), warning emission, in-memory normalization, and canonical persistence rewrite.

### Suggestions
- Consider adding a short “Step 1 guardrail” note that all hard failures (`tmuxPrefix`, `spawn_mode: tmux`) must include concrete fix hints (`sessionPrefix`, `subprocess`) to keep operator guidance consistent.
