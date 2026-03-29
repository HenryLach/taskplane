# R001 — Plan Review (Step 1: Fix field name mismatch in sidecar tailing)

## Verdict
**Changes requested** — good diagnosis, but Step 1 plan is not yet specific enough for deterministic implementation.

## Reviewed artifacts
- `taskplane-tasks/TP-094-context-pressure-telemetry-fix/PROMPT.md`
- `taskplane-tasks/TP-094-context-pressure-telemetry-fix/STATUS.md`
- `extensions/task-runner.ts`
- `bin/rpc-wrapper.mjs`
- `extensions/tests/sidecar-tailing.test.ts`

## Blocking findings

### 1) Step 1 checklist is still too coarse for a high-impact bug
`STATUS.md` Step 1 currently has only 3 broad bullets (`STATUS.md:25-27`). For a critical safety path (85% wrap-up / 95% kill), this should be expanded into concrete edit units with explicit file/line targets.

### 2) Scope mismatch: “remove fallback entirely” vs “threshold decisions only”
Mission text requires removing manual token fallback entirely (`PROMPT.md:23`), but Step 1 checkbox narrows this to threshold decisions (`PROMPT.md:64`, `STATUS.md:27`).

Current code still has manual fallback in reviewer telemetry paths (`task-runner.ts:2467-2469`, `2674-2676`) in addition to worker path (`3303-3305`). Plan must explicitly decide whether reviewer fallback is removed now (recommended for consistency with mission) or deferred with rationale.

### 3) Missing explicit strategy for “authoritative metric unavailable” warning behavior
Step 1 requires warning when authoritative context metric is unavailable (`PROMPT.md:65`), but plan does not define **when/how often** to log. Naive per-tick logging in `onTelemetry` will spam logs.

Need a deterministic one-shot strategy (e.g., per worker iteration/session), plus clear trigger condition (e.g., after first successful telemetry cycle with no `contextUsage`, or at iteration end if never observed).

### 4) Data-shape normalization is underspecified
Parser currently gates on `cu.percentUsed` and stores `percentUsed` (`task-runner.ts:1509-1512`), while pi sends `percent` (per Step 0 findings).

Plan should explicitly define the internal normalized shape after parsing (keep `percentUsed` internal alias vs migrate to `percent` everywhere), and list all dependent reads (`task-runner.ts:2466`, `2673`, `3302`) to avoid partial fixes.

## What is already correct
- `rpc-wrapper` already passes through `event.data.contextUsage` as-is (`bin/rpc-wrapper.mjs:425-427`), so Step 1 there is verification-only unless additional normalization is intentionally added.

## Required plan updates before implementation
1. Expand Step 1 in `STATUS.md` into explicit substeps with file-level targets:
   - parser field fix (`task-runner.ts` sidecar response branch),
   - consumer updates (worker and reviewer if in scope),
   - warning behavior implementation.
2. Resolve and document fallback scope ambiguity (worker-only vs global removal) to align with mission text.
3. Define one-shot warning semantics for older pi versions (avoid log spam).
4. Define normalized `contextUsage` contract in `SidecarTelemetryDelta` and ensure all readers are covered.
5. Add a short Step 1 smoke verification plan (before Step 3 full-suite):
   - sidecar response with `percent` updates context pct,
   - no `contextUsage` leaves pct at 0 and emits single warning,
   - thresholds fire only from authoritative metric.

## Non-blocking note
- `sidecar-tailing.test.ts` still uses `percentUsed` fixtures (`sidecar-tailing.test.ts:626,660`); this is fine to schedule in Step 3, but call it out explicitly in Step 1 notes so implementation doesn’t forget compatibility coverage.