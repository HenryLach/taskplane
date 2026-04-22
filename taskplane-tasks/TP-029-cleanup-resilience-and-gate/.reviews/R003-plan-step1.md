## Plan Review: Step 1: Fix Per-Wave Cleanup Across All Repos

### Verdict: REVISE

### Summary
The Step 1 plan is directionally correct and the preflight notes show strong understanding of issue #93, but the checklist is still ambiguous on a few critical outcomes. In particular, repo-scope coverage and `.worktrees` parent cleanup safety need to be made explicit to avoid reintroducing stale state in workspace mode. Tightening these points now will make Step 2’s cleanup gate much easier to implement correctly.

### Issues Found
1. **[Severity: important]** — `taskplane-tasks/TP-029-cleanup-resilience-and-gate/STATUS.md:34-37` does not explicitly require terminal cleanup to run across all repos encountered in the batch (not only current-wave lanes). This is the core failure pattern currently visible at `extensions/taskplane/engine.ts:824` and can still leave stale worktrees in repos that were active in earlier waves. **Fix:** add a Step 1 outcome that tracks/uses an `encounteredRepoRoots`-style set for both inter-wave reset and final cleanup.
2. **[Severity: important]** — `taskplane-tasks/TP-029-cleanup-resilience-and-gate/STATUS.md:37` says “Remove empty .worktrees/ dirs” but does not capture the safety rule for `worktree_location`. Without an explicit guard, sibling-mode cleanup could target the wrong parent directory. **Fix:** state that only empty `.worktrees` base dirs in subdirectory mode are eligible for removal, and never force-remove non-empty parents (consistent with `extensions/taskplane/worktree.ts:195-210` and `:1551-1573`).
3. **[Severity: minor]** — `taskplane-tasks/TP-029-cleanup-resilience-and-gate/STATUS.md:36` does not specify which merge-worktree cleanup paths get fallback coverage. `extensions/taskplane/merge.ts` has both stale-prep cleanup (`:577-583`) and end-of-wave cleanup (`:887-895`). **Fix:** call out that fallback behavior should apply in both places so stale merge worktrees don’t persist between attempts.

### Missing Items
- Step 1-specific validation intent for: (a) repo active in wave N but not in final wave still cleaned, and (b) locked merge worktree path exercises fallback.

### Suggestions
- Add one short “Step 1 done when” block under Notes with explicit outcomes (repo coverage scope, merge fallback scope, parent-dir safety) to reduce interpretation drift during implementation.
- Clean up duplicate execution-log rows at `STATUS.md:110-113` in a follow-up housekeeping edit.
