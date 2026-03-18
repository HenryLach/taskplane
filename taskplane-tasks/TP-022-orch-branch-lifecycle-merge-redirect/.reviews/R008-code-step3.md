## Code Review: Step 3: Replace Fast-Forward with update-ref in Merge

### Verdict: REVISE

### Summary
The merge flow change in `merge.ts` correctly removes `merge --ff-only`/stash usage and moves branch advancement to `rev-parse` + `update-ref`, which aligns with the orch-branch isolation goal. However, the new ref update drops the fast-forward safety invariant and can overwrite concurrent ref movement silently. Test coverage for this step is also structural-only (source-string matching), so it does not validate runtime behavior of the new merge/ref-advance path.

### Issues Found
1. **[extensions/taskplane/merge.ts:778] [important]** — `git update-ref` is called without an expected old OID, so if `refs/heads/${targetBranch}` moves between temp-branch creation and final update, this can silently clobber newer commits. The prior `--ff-only` path rejected such divergence. Suggested fix: capture the target branch OID before merges (or at temp-branch creation) and call `git update-ref <ref> <new> <old>` (compare-and-swap), treating mismatch as a merge failure.
2. **[extensions/tests/orch-direct-implementation.test.ts:441-514] [important]** — Step 3 tests are implementation-string checks only; they do not execute merge behavior. This won’t catch runtime regressions like wrong ref target, incorrect cwd/repo root, or failure/status handling bugs. Suggested fix: add at least one behavior test (temp git repo or existing merge harness) that asserts target ref advancement on success and failure-state propagation when ref update fails.

### Pattern Violations
- High-risk merge behavior changes are not covered by execution-level tests; this diverges from the project’s behavior-first testing expectations for orchestration/merge flows.

### Test Gaps
- No runtime assertion that `mergeWave()` advances `refs/heads/<targetBranch>` to the merged temp-branch commit.
- No runtime failure-path assertion for `update-ref` error leading to expected merge status and failure reason.

### Suggestions
- Keep the structural non-regression checks, but pair them with behavior tests in `extensions/tests/merge-repo-scoped.test.ts` (or a focused new test file) so future refactors don’t break semantics while still passing string checks.
