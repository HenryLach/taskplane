## Plan Review: Step 2: Route Worktrees and Merge to Orch Branch

### Verdict: REVISE

### Summary
The revised plan is much stronger: it now includes engine + resume parity and explicitly calls out an `orchBranch` guard on resume. However, one workspace-mode branch-resolution edge case is still underspecified, and the test intent does not yet cover the new legacy-state compatibility boundary introduced by the guard. Tightening those two outcomes will make Step 2 safer and more deterministic.

### Issues Found
1. **[Severity: important]** — `taskplane-tasks/TP-022-orch-branch-lifecycle-merge-redirect/STATUS.md:50` marks `resolveBaseBranch()` as “No changes needed,” but `extensions/taskplane/waves.ts:564-596` falls back to `batchBaseBranch` when repo branch detection/default-branch lookup fails, and that value is consumed in worktree provisioning (`extensions/taskplane/waves.ts:993`). After Step 2, `batchBaseBranch` passed into this path becomes `orchBranch`, which may not exist in non-primary workspace repos. **Suggested fix:** add an explicit outcome for this failure path (e.g., ensure orch branch existence per repo before use, or define/document an intentional non-orch fallback for workspace mode when detection fails).
2. **[Severity: important]** — The plan adds a resume fail-fast on empty `orchBranch` (`STATUS.md:47`), but Step 2 test intent (`STATUS.md:51`) does not explicitly cover that compatibility boundary. Persisted state loading currently defaults missing `orchBranch` to `""` (`extensions/taskplane/persistence.ts:369-378`), so this is a real edge path. **Suggested fix:** add one explicit test scenario for resume with empty/missing `orchBranch`, validating the expected behavior and user-facing message.
3. **[Severity: minor]** — Discovery notes still say empty `orchBranch` is “already handled by persistence validation” (`STATUS.md:135`), which conflicts with the Step 2 fail-fast outcome (`STATUS.md:47`). **Suggested fix:** reconcile notes so there is one clear compatibility strategy.

### Missing Items
- Explicit risk-mitigation outcome for workspace-mode branch-resolution fallback when repo branch detection fails.
- Explicit Step 2 test intent for the empty/missing `orchBranch` resume path.

### Suggestions
- Clean up the duplicate `R004` review row in `STATUS.md` once Step 2 edits are finalized to keep review history unambiguous.
