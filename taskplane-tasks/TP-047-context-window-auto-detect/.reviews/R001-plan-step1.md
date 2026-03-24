## Plan Review: Step 1: Auto-detect context window from pi model registry

### Verdict: APPROVE

### Summary
The Step 1 plan covers the required outcomes from `PROMPT.md`: switching `worker_context_window` to an auto-detect sentinel default, runtime resolution precedence (config → model registry → 200K fallback), aligning config defaults in schema/loader, and adding operator-visible logging at worker spawn. The scope is appropriately sized and matches the existing touch points in `extensions/task-runner.ts` and unified config mapping. I don’t see any blocking gaps that would force rework later.

### Issues Found
1. **[Severity: minor]** — No blocking issues found for this step plan.

### Missing Items
- None.

### Suggestions
- Be explicit in implementation that sentinel values (`0` or non-positive) are treated as "unset" for auto-detect resolution, so `0` is not accidentally used as a real context window.
- Reuse one resolved `contextWindow` value across all worker code paths that currently read `config.context.worker_context_window` (`extensions/task-runner.ts` around context tracking/spawn usage) to avoid drift between tmux telemetry and subprocess mode.
- Include the resolution source in the spawn log (`configured`, `auto-detected`, or `fallback`) for clearer operator diagnostics.
