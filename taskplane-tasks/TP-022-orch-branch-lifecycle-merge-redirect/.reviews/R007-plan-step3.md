## Plan Review: Step 3: Replace Fast-Forward with update-ref in Merge

### Verdict: REVISE

### Summary
The Step 3 plan captures the high-level direction (swap `ff-only` for `update-ref` and remove stash/pop), but it is currently too thin for a safety-critical merge-path change. It does not yet define failure-state behavior for the new git operations, and it lacks explicit test intent for the ref-update regression boundary. Tightening those outcomes is necessary to preserve determinism and recoverability.

### Issues Found
1. **[Severity: critical]** — `taskplane-tasks/TP-022-orch-branch-lifecycle-merge-redirect/STATUS.md:63-65` does not define failure handling for the new `rev-parse`/`update-ref` path. In current code, the ff block in `extensions/taskplane/merge.ts:761-787` explicitly sets `failedLane/failureReason` when branch advancement fails. If Step 3 swaps commands without equivalent failure semantics, `mergeWave()` can incorrectly report success while cleanup (`merge.ts:790-798`) deletes the temp branch, losing merged commits. **Suggested fix:** add an explicit Step 3 outcome that both commands are checked, errors are surfaced in `failureReason`, and status remains `partial/failed` (not silent success) when ref advancement fails.
2. **[Severity: important]** — The plan does not include concrete Step 3 test coverage for this behavioral change (only generic Step 5 bullets at `STATUS.md:82-86`). Existing contract-style checks already live in `extensions/tests/orch-direct-implementation.test.ts:225-420`; Step 3 should add explicit assertions for: presence of `rev-parse` + `update-ref` path, absence of `merge --ff-only`/`stash` flow, and failure-path mapping to merge result status. **Suggested fix:** add Step 3-specific test intent now (with target test files), not just a generic “tests passing” checkbox later.

### Missing Items
- Explicit failure-path outcome for `git rev-parse <tempBranch>` and `git update-ref refs/heads/<targetBranch> <sha>` (including status/error propagation).
- Explicit non-regression outcome that no repo-root `git merge --ff-only` / `git stash` calls remain in merge flow.
- Step 3-specific test scenarios (success + update-ref failure path), with intended files.

### Suggestions
- Add one operator-facing exec log outcome for successful ref update (and one for failure) to keep merge diagnostics as clear as the current ff path.
- Clean up the duplicate `R006` review row in `STATUS.md:107-108` while touching the file.
