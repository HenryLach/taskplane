## Code Review: Step 3 — Thread mailbox-dir through spawn paths

### Verdict: APPROVE

### Scope reviewed
- Diff range: `1a59745677294d066ffbccdad89e4edbe3d4fd40..HEAD`
- Changed files:
  - `extensions/task-runner.ts`
  - `extensions/taskplane/engine.ts`
  - `extensions/taskplane/merge.ts`
  - `taskplane-tasks/TP-089-mailbox-core-and-rpc-injection/STATUS.md`
- Neighboring context checked:
  - `extensions/taskplane/execution.ts` (lane env + ORCH_BATCH_ID threading)
  - `extensions/taskplane/resume.ts` (re-exec ORCH_BATCH_ID pattern)
  - `extensions/taskplane/mailbox.ts` (mailbox path conventions)
  - `bin/rpc-wrapper.mjs` (mailbox-dir expectations)

### Findings
No blocking issues found.

The Step 3 requirements are satisfied:
- `spawnAgentTmux()` now derives mailbox path from sidecar root and session name when `ORCH_BATCH_ID` is present, creates `inbox/`, and passes `--mailbox-dir`.
- `spawnMergeAgent()` accepts `batchId`, creates mailbox `inbox/`, and passes `--mailbox-dir`.
- Both `mergeWave()` spawn callsites pass `batchId` through.
- Tier-0 retry callsites in `engine.ts` now propagate `ORCH_BATCH_ID` for retry lane spawns (including model-fallback retry).

### Non-blocking notes
- Mailbox path construction currently uses literal `"mailbox"` strings in spawn sites rather than `MAILBOX_DIR_NAME` from `types.ts`. This is acceptable, but consolidating constants later would reduce drift risk.
- Dedicated test coverage for this spawn plumbing is still pending (expected in Step 6).

### Validation performed
- `git diff 1a59745677294d066ffbccdad89e4edbe3d4fd40..HEAD --name-only`
- `git diff 1a59745677294d066ffbccdad89e4edbe3d4fd40..HEAD`
- `node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/rpc-wrapper.test.ts tests/task-runner-rpc.test.ts` (pass)
