## Code Review: Step 1: Expand Age Sweep Scope

### Verdict: REVISE

### Summary
The step correctly lowers the stale-artifact threshold to 3 days and adds sweep patterns for worker conversation and lane-state artifacts. However, the new verification sweep does not actually clean the verification snapshots used by runtime code, so one of the stated Step 1 outcomes is not met. This needs a small structural fix in `sweepStaleArtifacts` before approval.

### Issues Found
1. **[extensions/taskplane/cleanup.ts:296-297] [important]** — Verification cleanup only scans top-level files in `.pi/verification/` via `sweepDir(...)`, and `sweepDir` explicitly skips directories (`stat.isFile()` guard). Runtime verification artifacts are persisted under per-op subdirectories (`.pi/verification/{opId}/...`, e.g. `extensions/taskplane/merge.ts:1023`, `extensions/taskplane/merge.ts:1425`), so stale verification snapshots are never deleted.  
   **Fix:** Sweep `.pi/verification/` as stale directories (like mailbox/context-snapshots), or recursively sweep files within subdirectories based on mtime.

### Pattern Violations
- None.

### Test Gaps
- Missing test coverage for stale `.pi/verification/{opId}/...` cleanup (old directory/file deleted, recent preserved).

### Suggestions
- Consider deriving the user-facing `>3 days old` text from `maxAgeMs` to avoid future drift between behavior and message text.
