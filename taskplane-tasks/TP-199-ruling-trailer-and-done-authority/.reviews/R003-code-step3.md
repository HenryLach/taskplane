## Code Review: Step 3: `Taskplane-Ruling:` trailer validation

### Verdict: REVISE

### Summary
The R002 formatting and stale-import findings are fixed: typecheck and format-check pass, lint is back at the 283-warning baseline, and the combined targeted suite passes 134/134. The trailer parser/validator and post-iteration diagnostics are sound, but resume still has a fail-open difference from the live completion authority when a ratified worktree contains uncommitted source drift.

### Issues Found
1. **[extensions/taskplane/resume.ts:521-547] [important]** — Resume deliberately omits `workingTreeDrift`, so `authorizeCompletion` substitutes an always-clean probe (`completion-authority.ts:233`). A `.DONE` marker with an otherwise valid linked ratification is therefore accepted after a crash even if the lane worktree has uncommitted source changes that the live finalize path rejects (`lane-runner.ts:2934-2940`). Those changes can subsequently be swept into the merge candidate by the engine's `git add -A` safety net (`engine.ts:4222-4237`), defeating the ratification's proof-to-code binding and the requirement that resume refuse completion exactly as live does. When the persisted worktree exists, pass the same fail-closed `collectChangedPaths` / `unratifiedWorkingTreePaths` probe with the resolved task-artifact prefixes; add a resume regression test showing `.DONE` + valid linked APPROVE + dirty source is not collected (and that runtime-only task artifacts remain allowed).

### Pattern Violations
- Resume and live finalization call the shared predicate with different authority-relevant evidence despite a usable persisted worktree being available.

### Test Gaps
- No resume test covers a valid ratification with uncommitted source drift (or a failed git drift probe), so the fail-open default is not detected.

### Suggestions
- None.
