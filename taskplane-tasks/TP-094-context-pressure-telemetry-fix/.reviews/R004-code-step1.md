# R004 Code Review — Step 1: Fix field name mismatch in sidecar tailing

## Verdict
**APPROVE**

## Scope Reviewed
Diff reviewed against baseline `5029768dc41ca650b712ee1fefd37479215dfd01..HEAD`.

Changed files:
- `extensions/task-runner.ts`
- `taskplane-tasks/TP-094-context-pressure-telemetry-fix/STATUS.md`

Neighbor/context checked:
- `bin/rpc-wrapper.mjs` (response/contextUsage passthrough behavior)
- `extensions/tests/sidecar-tailing.test.ts` (current fixture expectations)

## Assessment
Step 1 implementation now aligns with the intended fix and addresses the prior code-review concern:

1. **Field mismatch fix is correctly implemented**
   - `SidecarTelemetryDelta.contextUsage` now uses `percent`.
   - Parser accepts canonical + legacy input: `cu.percent ?? cu.percentUsed`.

2. **Consumers are consistently updated**
   - Worker and both reviewer telemetry paths now read `delta.contextUsage.percent`.

3. **Manual fallback removal is correctly applied**
   - Token-based context `%` fallback was removed from tmux worker/reviewer telemetry decisions.
   - Context thresholds now depend only on authoritative `contextUsage`.

4. **False-positive warning issue from R003 is addressed**
   - Added `sawStatsResponseWithoutContextUsage` and warning is now gated on that explicit signal.
   - This avoids warning on early non-stats events before `get_session_stats` has returned.

## Validation Notes
- Ran required diff commands:
  - `git diff 5029768dc41ca650b712ee1fefd37479215dfd01..HEAD --name-only`
  - `git diff 5029768dc41ca650b712ee1fefd37479215dfd01..HEAD`
- Ran focused tests:
  - `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/rpc-wrapper.test.ts` ✅
  - `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/sidecar-tailing.test.ts` → 2 expected fixture failures still asserting `percentUsed` (already planned for Step 3).
