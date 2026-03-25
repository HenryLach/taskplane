# Task: TP-065 - Artifact Cleanup and Log Rotation

**Created:** 2026-03-25
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds cleanup/rotation logic across integrate, preflight, and supervisor paths. Deletes files — must be careful not to remove active batch artifacts. Medium blast radius across multiple modules.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-065-artifact-cleanup-and-rotation/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Several runtime artifact files grow without bounds across batches:

| File | Pattern | Risk |
|------|---------|------|
| `.pi/telemetry/*.jsonl` | One per agent per batch, never deleted | Caused #213 crash at ~512MB |
| `.pi/merge-result-*.json` | One per lane per wave, never deleted | Disk accumulation |
| `.pi/supervisor/events.jsonl` | Appended every batch, never rotated | Unbounded growth |
| `.pi/supervisor/actions.jsonl` | Appended every batch, never rotated | Unbounded growth |
| `.worktrees/` | Containers per batch, partial cleanup | Residual worktrees |

Implement a multi-layer cleanup strategy so no single failure path leads to unbounded disk growth or dashboard crashes.

## Dependencies

- **None** (TP-064 fixes the dashboard read side; this task fixes the source/accumulation side)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `extensions/taskplane/extension.ts` — `/orch-integrate` command handler, existing cleanup logic
- `extensions/taskplane/engine.ts` — batch preflight, where age-based sweep would run
- `extensions/taskplane/merge.ts` — merge result file paths
- `extensions/taskplane/execution.ts` — telemetry path generation (`resolveLaneLogPath`, sidecar paths)

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/extension.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/migrations.ts` (or new `cleanup.ts`)
- `extensions/tests/artifact-cleanup.test.ts` (new)

## Steps

### Step 0: Preflight

- [ ] Read `/orch-integrate` cleanup logic in `extension.ts` — understand what's already cleaned up
- [ ] Read telemetry path generation in `execution.ts` — understand filename patterns
- [ ] Read merge result file naming in `merge.ts`
- [ ] Read `/orch` preflight path in `engine.ts` — find the right hook for sweep logic

### Step 1: Post-Integrate Cleanup (Layer 1)

After successful `/orch-integrate` (or `orch_integrate` tool), clean up artifacts from the completed batch:

**Delete:**
- `.pi/telemetry/*-{batchId}-*.jsonl` — telemetry sidecar files for this batch
- `.pi/telemetry/*-{batchId}-*-exit.json` — exit summaries for this batch
- `.pi/telemetry/lane-prompt-*.txt` — temporary prompt files created for RPC wrapper
- `.pi/merge-result-*-{batchId}.json` — merge result files for this batch

**Keep:**
- `.pi/batch-state.json` — overwritten by next batch
- `.pi/supervisor/*-summary.md` — small, useful for history
- `.pi/supervisor/events.jsonl` — handled by Layer 3 rotation
- `.pi/supervisor/actions.jsonl` — handled by Layer 3 rotation

**Safety:**
- Only delete files whose names contain the completed batchId
- Log what was cleaned: "Cleaned up N telemetry files, M merge results for batch {batchId}"
- Never delete if batch phase is not "completed" — guard against partial cleanup

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified — add cleanup after integrate success)

### Step 2: Age-Based Sweep on Preflight (Layer 2)

On `/orch` preflight (before batch starts), sweep for stale artifacts from old batches:

**Sweep:**
- `.pi/telemetry/*.jsonl` files older than 7 days → delete
- `.pi/telemetry/*-exit.json` files older than 7 days → delete
- `.pi/telemetry/lane-prompt-*.txt` files older than 7 days → delete
- `.pi/merge-result-*.json` files older than 7 days → delete

**Safety:**
- Use file mtime for age detection (not filename parsing)
- Skip files modified within the last 7 days
- If a batch is currently running (batch-state phase=executing), skip ALL cleanup to avoid deleting active telemetry
- Log sweep results: "Preflight cleanup: removed N stale artifacts (>7 days old)"
- Non-fatal — if sweep fails, warn and continue with batch start

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified — add sweep to preflight)
- Or new `extensions/taskplane/cleanup.ts` if the logic is substantial

### Step 3: Size-Capped Rotation for Append-Only Logs (Layer 3)

Rotate `events.jsonl` and `actions.jsonl` when they exceed a size threshold:

**Rotation policy:**
- Max size: 5MB per file
- On `/orch` preflight, check file sizes
- If over threshold: rename current file to `.old` (e.g., `events.jsonl` → `events.jsonl.old`), overwriting any existing `.old` file
- Start a fresh file for the new batch
- Keep exactly one generation of history (current + .old)

**Safety:**
- Only rotate during preflight (not mid-batch)
- If rename fails, warn and continue (non-fatal)
- The `.old` file is purely for manual debugging — not consumed by any code path

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified — add rotation to preflight)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Create `extensions/tests/artifact-cleanup.test.ts` with:
  - Post-integrate cleanup: correct files deleted by batchId, non-matching files preserved
  - Age-based sweep: files older than 7 days removed, recent files kept
  - Running batch guard: no cleanup during active batch
  - Log rotation: files over 5MB rotated, under 5MB left alone
  - Non-fatal behavior: cleanup failures warn but don't block
  - Source-based tests for integration points
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Build passes: `node bin/taskplane.mjs help`

### Step 5: Documentation & Delivery

- [ ] Update `docs/how-to/troubleshoot-common-issues.md` — add section on disk usage and manual cleanup
- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `docs/how-to/troubleshoot-common-issues.md` — disk usage troubleshooting

**Check If Affected:**
- `extensions/taskplane/supervisor-primer.md` — mention cleanup behavior

## Completion Criteria

- [ ] Post-integrate deletes batch-specific telemetry and merge results
- [ ] Preflight sweep removes artifacts older than 7 days
- [ ] events.jsonl and actions.jsonl rotate at 5MB
- [ ] Active batch artifacts are never deleted
- [ ] All cleanup is non-fatal (warn + continue)
- [ ] All tests passing
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-065): complete Step N — description`

## Do NOT

- Delete batch-state.json (overwritten by next batch)
- Delete supervisor summary files (small, useful history)
- Delete .worktrees during preflight (integrate handles this)
- Change telemetry filename patterns
- Make cleanup blocking — all cleanup must be non-fatal
- Clean up during an active batch (executing/merging phase)

---

## Amendments
