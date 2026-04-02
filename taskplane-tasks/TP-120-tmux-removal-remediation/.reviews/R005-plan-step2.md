## Plan Review: Step 2: Remove merge health monitor TMUX polling

### Verdict: APPROVE

### Summary
This revision addresses the core gaps from R004: it now targets the actual remaining TMUX paths in `merge.ts` (capture helpers and `spawn("tmux", ...)` / `spawnSync("tmux", ...)`), and it explicitly calls for replacing pane-output health semantics with V2-safe signals. The plan also includes explicit test-update intent for merge monitoring behavior, which was previously missing. Overall, Step 2 is now outcome-focused and should achieve the stated task requirements.

### Issues Found
1. **[Severity: minor]** — The checklist item “Evaluate if entire health monitor is legacy dead code” could be slightly more explicit about required follow-through (remove monitor + engine wiring if confirmed unused), though this is already implied by existing items and does not block execution.

### Missing Items
- None blocking.

### Suggestions
- If dead-code evaluation confirms monitor removal, record that as a concrete done outcome in STATUS (including any `engine.ts` integration cleanup) to make completion unambiguous.
- Keep the V2 liveness cache seed/clear discipline in `poll()` if the monitor remains, as noted in prior review feedback.
