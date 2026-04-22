# R005 — Plan Review (Step 3: Testing & Verification)

## Verdict
**REVISE** — good intent, but the Step 3 plan is currently too thin to guarantee coverage of TP-094 acceptance criteria.

## Reviewed artifacts
- `taskplane-tasks/TP-094-context-pressure-telemetry-fix/PROMPT.md`
- `taskplane-tasks/TP-094-context-pressure-telemetry-fix/STATUS.md`
- `extensions/task-runner.ts`
- `extensions/taskplane/cleanup.ts`
- `extensions/tests/sidecar-tailing.test.ts`
- `extensions/tests/rpc-wrapper.test.ts`
- `extensions/tests/persistent-reviewer-context.test.ts`

## Blocking findings

### 1) Step 3 plan lacks explicit test matrix and file-level scope
`STATUS.md` Step 3 currently has only two broad checkboxes. For a regression fix in safety-critical telemetry thresholds, the test plan needs concrete test cases mapped to files.

### 2) Existing failing tests are known but not yet planned as concrete fixes
Running the required suite currently fails in `sidecar-tailing.test.ts` due legacy assertions on `percentUsed`:
- `tests/sidecar-tailing.test.ts:622`
- `tests/sidecar-tailing.test.ts:654`

These must be explicitly called out as first-step repairs in Step 3.

### 3) Missing planned coverage for “authoritative-only” threshold behavior
Mission requires manual token fallback removal from threshold decisions. Current plan says this in prose, but no explicit test is listed to prove worker/reviewer paths no longer use `(latestTotalTokens / contextWindow) * 100`.

### 4) Snapshot schema coverage is incomplete in plan (critical)
Prompt requires snapshot fields:
`iteration, contextPct, tokens, contextWindow, cost, toolCalls, timestamp, exitReason`.

Current implementation of `writeContextSnapshot()` does **not** include `contextWindow` (see `extensions/task-runner.ts`, snapshot object near lines ~470-480). Step 3 plan must include a test that validates full schema so this gap is caught.

### 5) Cleanup lifecycle coverage for `context-snapshots/` is not explicitly planned
Step 2 added cleanup support in `cleanup.ts`, but Step 3 plan does not explicitly include tests that verify:
- post-integrate deletion of `.pi/context-snapshots/{batchId}/`
- stale sweep deletion for old context-snapshot batch directories

Without tests, Step 2 changes remain weakly verified.

## Required plan updates before execution
1. Expand Step 3 in `STATUS.md` into explicit substeps with file targets.
2. In `sidecar-tailing.test.ts`, add/update tests for:
   - canonical `contextUsage.percent`
   - legacy compatibility (`percentUsed` still accepted)
   - `sawStatsResponseWithoutContextUsage` behavior for older pi responses.
3. Add explicit tests proving worker/reviewer context % decisions are authoritative-only (no token fallback path).
4. Add snapshot tests that verify:
   - snapshot write occurs at iteration boundary,
   - required JSONL fields include `contextWindow`.
5. Add cleanup tests for context-snapshot directory lifecycle (`cleanupPostIntegrate` + `sweepStaleArtifacts`).
6. Keep full-suite requirement, but include a triage note: rerun once to rule out unrelated flake, then fix/justify any remaining failures.

## Non-blocking recommendation
Add one focused `rpc-wrapper.test.ts` assertion that `response.data.contextUsage` is preserved into session state/exit summary unchanged (defends against future field-renaming regressions).