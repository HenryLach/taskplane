## Plan Review: Step 5 — Batch cleanup for mailbox directory

### Verdict: REVISE

### Summary
The plan still has the right high-level intent (batch mailbox deletion + 7-day stale sweep), but it is not yet execution-safe against current code patterns in `cleanup.ts` and `extension.ts`.

### Blocking findings

1. **Mailbox cleanup counter/report propagation is still incomplete in the plan.**

   Current integration output math is hard-coded to three counters in `extension.ts` (`telemetry + merge + prompt`) and `cleanup.ts` formatter logic is also 3-bucket.

   If Step 5 only adds mailbox deletion in `cleanupPostIntegrate()` without explicit propagation, operator-facing cleanup totals/messages will be wrong or mailbox cleanup will be invisible.

   **Required plan correction:** explicitly include updates to:
   - `PostIntegrateCleanupResult` shape + initialization
   - `formatPostIntegrateCleanup(...)` total + segment composition
   - `/orch-integrate` cleanup summary math/string in `extension.ts` (currently manually assembled)

2. **Mailbox stale sweep behavior is still underspecified versus the current file-only sweep helper.**

   `sweepStaleArtifacts()` currently uses a file-oriented path (`stat.isFile()` + `unlinkSync`). Mailbox cleanup requires directory-oriented deletion (`.pi/mailbox/{batchId}/...`).

   **Required plan correction:** make directory handling explicit:
   - sweep only immediate children under `.pi/mailbox/`
   - process directories only (`stat.isDirectory()`), skip stray files
   - use directory `mtimeMs` against existing cutoff
   - remove stale batch dirs with `rmSync(path, { recursive: true, force: true })`
   - preserve per-entry non-fatal warning behavior (continue on errors)

### Non-blocking notes

- Prefer `MAILBOX_DIR_NAME` from `types.ts` over hardcoded `"mailbox"`.
- Add focused tests in Step 6 for:
  - post-integrate deletion of `.pi/mailbox/{batchId}`
  - stale sweep deleting old mailbox batch dirs while preserving recent ones.
