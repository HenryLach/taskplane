## Code Review: Step 1: Transaction Envelope

### Verdict: REVISE

### Summary
The transactional envelope scaffolding is mostly in place (new `TransactionRecord` model, ref capture, rollback status propagation, and engine/resume pause override). However, there is a critical safe-stop gap in workspace-mode merge orchestration: rollback failure does not immediately stop subsequent repo-group merges. That behavior conflicts with the Step 1 safe-stop requirement to preserve state for manual recovery.

### Issues Found
1. **[extensions/taskplane/merge.ts:1752-1801] [critical]** — `mergeWaveByRepo()` continues processing repo groups even after `groupResult.rollbackFailed` is detected.
   - Why this is a problem: Step 1 safe-stop semantics require halting on rollback failure and preserving branches/worktrees. Current loop sets `anyRollbackFailed = true` but still merges later repos, which can advance refs and run cleanup in other repos before engine-level pause is applied.
   - Suggested fix: short-circuit the repo-group loop when `groupResult.rollbackFailed` is true (or check `anyRollbackFailed` at top of each iteration and break). Ensure aggregate `MergeWaveResult` carries the rollback failure and that unprocessed repo groups are left untouched.

2. **[extensions/taskplane/merge.ts:552-573] [important]** — Transaction record persistence is treated as silent best-effort, but safe-stop messaging depends on those artifacts.
   - Why this is a problem: On write failure, operator guidance points to `.pi/verification/.../txn-*.json` files that may not exist.
   - Suggested fix: surface persistence failure in merge outcome (or at least batch errors/notification) so recovery guidance remains actionable when file persistence fails.

### Pattern Violations
- `AGENTS.md` emphasizes recoverability and operator clarity; continuing repo merges after rollback failure weakens “stop-the-world” recovery behavior.

### Test Gaps
- No behavior test verifies that workspace-mode merge processing halts immediately after a rollback failure in one repo group.
- No integration-style assertion verifies that subsequent repo groups do **not** update refs or clean merge worktrees once safe-stop is triggered.
- No test covers transaction-record write failure path and operator-facing diagnostics.

### Suggestions
- Add a targeted `mergeWaveByRepo` test fixture with two repo groups where the first group simulates rollback reset failure; assert second group is never merged.
- Add an engine/resume-level test confirming forced `paused` is applied regardless of `on_merge_failure` when `rollbackFailed` is set.
