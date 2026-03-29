## Plan Review: Step 5 — Batch cleanup for mailbox directory

### Verdict: REVISE

### Summary
The plan is close and moving in the right direction. It now covers both required cleanup layers (post-integrate batch cleanup and 7-day stale sweep). 

However, there are still two implementation-critical gaps to resolve before this is execution-ready.

### Blocking findings

1. **Mailbox cleanup count propagation is still underspecified across operator-facing report paths.**

   Current code paths are explicitly 3-counter based:
   - `cleanup.ts`: `PostIntegrateCleanupResult` + `formatPostIntegrateCleanup(...)`
   - `extension.ts` (`/orch-integrate`): `totalCleaned = telemetry + merge + prompt` and hardcoded summary string

   Your plan says “Add mailbox dir count to cleanup result,” but does not explicitly require updating all report/math callsites. If missed, cleanup can happen silently (or totals will be wrong).

   **Required plan correction:** explicitly include mailbox counter updates in:
   - `PostIntegrateCleanupResult` shape + initialization
   - `formatPostIntegrateCleanup(...)` total/segment composition
   - `/orch-integrate` cleanup summary math/string in `extension.ts`

2. **Stale mailbox sweep needs explicit directory-safe behavior contract (matching existing non-fatal cleanup style).**

   `sweepStaleArtifacts()` currently uses a file-oriented helper (`stat.isFile()` + `unlinkSync`). Mailbox cleanup is directory-oriented, so the plan must pin down how to avoid accidental or fatal behavior drift.

   **Required plan correction:** explicitly state that mailbox sweep will:
   - iterate immediate children of `.pi/mailbox/`
   - process directories only (`stat.isDirectory()`), skipping files
   - age-check by directory `mtimeMs` against the same cutoff
   - remove stale dirs via `rmSync(path, { recursive: true, force: true })`
   - preserve per-entry try/catch warning behavior (non-fatal)

### Non-blocking notes

- Prefer using `MAILBOX_DIR_NAME` (or mailbox path helper) instead of hardcoded `"mailbox"` to stay aligned with TP-089 mailbox path conventions.
- Add focused tests for:
  - post-integrate deletion of `.pi/mailbox/{batchId}`
  - stale sweep deleting old mailbox batch dirs while preserving recent ones.
