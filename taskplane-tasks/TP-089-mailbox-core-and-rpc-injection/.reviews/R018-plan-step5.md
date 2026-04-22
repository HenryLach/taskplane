## Plan Review: Step 5 — Batch cleanup for mailbox directory

### Verdict: REVISE

### Summary
The direction is correct (post-batch mailbox removal + 7-day stale sweep), but the plan is still missing two implementation-critical details that affect operator visibility and cleanup safety.

### Blocking findings

1. **Mailbox cleanup count must be wired through all result/report paths (not just added in-place).**
   In current code, post-integrate cleanup reporting is hard-coded to three counters:
   - `cleanup.ts` `PostIntegrateCleanupResult` + `formatPostIntegrateCleanup(...)`
   - `extension.ts` `/orch-integrate` output (`totalCleaned = telemetry + merge + prompt`)

   If Step 5 only adds mailbox deletion logic without explicitly updating these report paths, mailbox cleanup can occur but remain invisible in operator-facing summaries.

   **Required plan correction:** explicitly include mailbox counter propagation in:
   - `PostIntegrateCleanupResult` shape + initialization
   - total/segment math in `formatPostIntegrateCleanup(...)`
   - `/orch-integrate` notification math/string in `extension.ts`

2. **Age-based mailbox sweep needs explicit directory-safe semantics and non-fatal handling.**
   Existing `sweepStaleArtifacts()` logic is file-oriented (`stat.isFile()` + `unlinkSync`). Step 5 says “sweep mailbox subdirectories,” but does not yet pin down how this will be implemented safely.

   **Required plan correction:** make explicit that mailbox sweep will:
   - iterate only immediate children of `.pi/mailbox/`
   - process **directories only** (skip files)
   - age-check by directory `mtimeMs` against the same cutoff
   - remove stale dirs with `rmSync(..., { recursive: true, force: true })`
   - keep per-entry try/catch warning behavior so failures stay non-fatal

### Non-blocking note
- Add at least one focused test for post-integrate mailbox batch-dir deletion and one for stale mailbox-dir sweep behavior (older vs recent), since this step changes artifact lifecycle semantics.
