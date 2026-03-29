# R002 — Plan Review (Step 1: Fix field name mismatch in sidecar tailing)

## Verdict
**APPROVE** — Step 1 plan is now sufficiently concrete and aligned with the task mission.

## Reviewed artifacts
- `taskplane-tasks/TP-094-context-pressure-telemetry-fix/PROMPT.md`
- `taskplane-tasks/TP-094-context-pressure-telemetry-fix/STATUS.md`
- `extensions/task-runner.ts`
- `bin/rpc-wrapper.mjs`
- `extensions/tests/sidecar-tailing.test.ts`

## What is now correct
1. **Explicit edit plan with concrete targets**
   - Step 1 is decomposed into deterministic substeps (`1a`–`1g`) with file/line anchors.
2. **Data-shape normalization is defined**
   - Internal contract moves to `contextUsage.percent` and parser compatibility is explicit (`cu.percent ?? cu.percentUsed`).
3. **All known consumer reads are in scope**
   - Worker and both reviewer telemetry consumers are enumerated.
4. **Fallback scope ambiguity resolved**
   - Manual token-based context % fallback removal is explicitly planned across worker + reviewer paths.
5. **rpc-wrapper scope is correctly constrained**
   - Verification-only is appropriate; current passthrough of `event.data.contextUsage` is already correct.

## Non-blocking implementation notes
- For the one-shot missing-metric warning, prefer triggering after a confirmed stats-response cycle without usable `contextUsage` (or after a short grace period) to avoid an early false warning if `message_end` is tailed before its corresponding `response` event.
- In Step 3, include at least one compatibility test covering legacy `percentUsed` input path plus canonical `percent` path.

No blocking plan changes required before implementation.