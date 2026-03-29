# R003 Code Review — Step 1: Fix field name mismatch in sidecar tailing

## Verdict
**CHANGES REQUESTED**

## Scope Reviewed
Diff reviewed against baseline `5029768dc41ca650b712ee1fefd37479215dfd01..HEAD`.

Changed files:
- `extensions/task-runner.ts`
- `taskplane-tasks/TP-094-context-pressure-telemetry-fix/STATUS.md`

Neighbor/context checked:
- `bin/rpc-wrapper.mjs` (sidecar event emission + `get_session_stats` flow)
- `extensions/tests/sidecar-tailing.test.ts` (tailing behavior expectations)

## What looks good
- `SidecarTelemetryDelta.contextUsage` is normalized to `percent` and all tmux/reviewer consumers were updated.
- Sidecar parser now accepts both `percent` and legacy `percentUsed` (`cu.percent ?? cu.percentUsed`), preserving compatibility.
- Manual token fallback was removed from tmux worker/reviewer context% decisions, aligning with TP-094 intent.

## Findings

### 1) One-shot “no contextUsage” warning can fire on healthy sessions before stats are available
- **Severity:** Medium
- **Files:**
  - `extensions/task-runner.ts:1912-1914`
  - `extensions/task-runner.ts:1446`
  - `extensions/task-runner.ts:3313-3316`
  - `bin/rpc-wrapper.mjs:820-823,829`
  - `bin/rpc-wrapper.mjs:847-850`
- **Issue:**
  The warning condition is `!delta.contextUsage` on any telemetry tick with events. But `delta.hadEvents` is true for *all* event types (including `agent_start`), and `onTelemetry` is called for every such tick. Since `get_session_stats` is only queried after `message_end`, early ticks can legitimately have no `contextUsage` yet.

  Result: warning can be emitted even when pi does support authoritative context usage and will provide it shortly after.
- **Why it matters:**
  The warning text says context thresholds are disabled, which can be false and mislead operators during incident/debug workflows.
- **Recommended fix:**
  Gate the warning on a stronger signal, e.g.:
  1. emit only after a `response` event is observed **without** usable `contextUsage`, or
  2. emit after a grace window once at least one `message_end` has occurred and no valid contextUsage has ever been seen.

  In practice, adding a dedicated flag from `tailSidecarJsonl` (e.g., `sawStatsResponseWithoutContextUsage`) is the most deterministic approach.

## Validation Notes
- Ran required diff commands:
  - `git diff 5029768dc41ca650b712ee1fefd37479215dfd01..HEAD --name-only`
  - `git diff 5029768dc41ca650b712ee1fefd37479215dfd01..HEAD`
- Ran targeted test file:
  - `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/sidecar-tailing.test.ts`
  - Observed 2 expected failures in legacy assertions still checking `contextUsage.percentUsed` (planned for Step 3).