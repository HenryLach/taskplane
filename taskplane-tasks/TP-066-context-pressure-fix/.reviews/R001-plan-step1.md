# R001 — Plan Review (Step 1: Fix Context Percentage Calculation)

## Verdict
**Approved with minor adjustments** — the Step 1 plan is directionally correct and implementation-ready.

## Reviewed artifacts
- `taskplane-tasks/TP-066-context-pressure-fix/PROMPT.md`
- `taskplane-tasks/TP-066-context-pressure-fix/STATUS.md`
- `extensions/task-runner.ts`
- `dashboard/server.cjs`
- `bin/rpc-wrapper.mjs`
- `dashboard/public/app.js`

## What looks good
1. **Root cause is correctly identified**: `usage.totalTokens` (from pi) excludes `cacheRead` for Anthropic, so context pressure is undercounted.
2. **Correct fix surface identified**: all runtime consumers that derive context pressure from `totalTokens` are covered in plan notes:
   - subprocess path (`spawnAgent` / `onContextPct`)
   - tmux sidecar path (`tailSidecarJsonl` → `latestTotalTokens`)
   - dashboard telemetry accumulator (`loadTelemetryData`)
3. **Choice of Option A is reasonable**: patching calculation at each consumer is low-risk and keeps behavior explicit.

## Minor adjustments requested (non-blocking)
1. **Status consistency:** Step 1 currently shows `Not Started` while its checklist items are checked. Please reconcile status fields before/with implementation.
2. **Explicitly record scope decision for dashboard UI token line:** `dashboard/public/app.js` still renders `usage.totalTokens || (usage.input + usage.output)` for conversation usage text. This does not drive safety-net thresholds, but it can still look inconsistent to operators. Either:
   - include it in this task, or
   - explicitly defer it in STATUS as out-of-scope for Step 1.
3. **Add a quick grep guard in execution notes:** after edits, run a repo search for remaining legacy pattern(s) to avoid missing another consumer.

## Suggested Step 1 acceptance checks
- Cache-heavy telemetry event (high `cacheRead`, low input/output) yields high context % in both subprocess and tmux flows.
- Dashboard `latestTotalTokens` reflects cache-inclusive totals.
- No changes to warn/kill thresholds (85/95) or context-window detection behavior.

Overall: the plan is solid and safe to execute after the small status/scope clarifications above.
