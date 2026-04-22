# R001 — Plan Review (Step 1: Fix tailJsonlFile for Large Files)

## Verdict
**Changes requested** — the plan is close, but it is missing one critical state-update rule and one scope guard needed for correctness.

## Reviewed artifacts
- `taskplane-tasks/TP-064-dashboard-telemetry-crash/PROMPT.md`
- `taskplane-tasks/TP-064-dashboard-telemetry-crash/STATUS.md`
- `dashboard/server.cjs` (`tailJsonlFile`, `loadTelemetryData`)

## Blocking findings

### 1) Offset progression is underspecified (risk: silent data loss)
The plan says capped reads should paginate and be continued on the next tick (`PROMPT.md:67`), but it does **not** explicitly require offset advancement by the bytes actually read.

In current code, offset is set to full file size (`dashboard/server.cjs:324`). If read size is capped (`dashboard/server.cjs:309`), this jumps to EOF and drops unread middle data.

**Required plan update:**
- Explicitly require: `tailState.offset = startOffset + bytesRead` (or `tailState.offset += bytesRead`), not `fileSize`.
- Prefer using the return value of `fs.readSync` (`bytesRead`) for correctness.

### 2) “Fresh start” condition needs explicit definition
Plan text says skip-to-tail is for **fresh dashboard start** (`PROMPT.md:74-76`), but the proposed condition is just `tailState.offset === 0` (`PROMPT.md:78`).

`offset` is also reset to `0` on truncation/recreation (`dashboard/server.cjs:287-292`). Reusing the same condition after reset can skip beginning-of-file unexpectedly and break post-reset accumulator rebuild behavior.

**Required plan update:**
- Define fresh-start detection explicitly (e.g., only when tail state is newly created / first-read flag), not any `offset===0` state.

## Required plan updates before implementation
1. Add explicit offset-update semantics based on `bytesRead`.
2. Define a deterministic “fresh start” predicate that excludes truncation-reset paths.
3. Add focused verification for pagination correctness (at least one manual/automated check):
   - File size > `2 * MAX_TAIL_BYTES`
   - Confirm multiple ticks are needed
   - Confirm no skipped middle region and no crash.

## Non-blocking notes
- `STATUS.md` says Step 1 is “Not Started” (`STATUS.md:21`), but `dashboard/server.cjs` already contains partial Step 1-style edits (`dashboard/server.cjs:298-310`). Consider reconciling status vs working tree before code review.
- Buffer guard in step item 3 is redundant if `bytesToRead` is already capped, but harmless.
