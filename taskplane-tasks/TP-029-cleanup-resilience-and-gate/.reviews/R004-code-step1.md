## Code Review: Step 1: Fix Per-Wave Cleanup Across All Repos

### Verdict: REVISE

### Summary
The Step 1 implementation is directionally strong: it now tracks encountered repos and applies per-repo reset/cleanup, and merge worktree cleanup got a real force-remove fallback. However, the change introduces a new engine↔resume module cycle via an unused import, which should be removed before merging. Coverage was also only lightly adjusted (string-structure assertions), so the new cleanup behaviors are still missing direct behavioral protection.

### Issues Found
1. **[extensions/taskplane/engine.ts:19, extensions/taskplane/resume.ts:9] [important]** — `engine.ts` now imports `resolveRepoIdFromRoot` from `resume.ts`, while `resume.ts` already imports `executeOrchBatch` from `engine.ts`, creating a new circular dependency (`engine -> resume -> engine`). The imported symbol is also unused in `engine.ts`. **Fix:** remove the import from `engine.ts`; if reverse lookup is needed in future, move shared repo-root helpers into a neutral module (e.g., `workspace.ts`/`routing.ts`) to avoid cross-phase coupling.

### Pattern Violations
- Introduces a cross-module cycle between core execution modules (`engine.ts` and `resume.ts`) instead of keeping shared helpers in a leaf utility module.

### Test Gaps
- No behavioral test proving terminal cleanup covers repos that were active in earlier waves but not in the final wave.
- No behavioral test forcing merge-worktree cleanup fallback (`git worktree remove --force` failure -> rm/prune path).
- No explicit test for `.worktrees` base-dir cleanup safety split by mode (`subdirectory` remove-when-empty vs `sibling` never-remove-parent).

### Suggestions
- Add/extend `extensions/tests/cleanup-resilience.test.ts` with workspace-mode multi-repo lifecycle scenarios (wave N repo-only participation, post-merge cleanup verification per repo).
- Add one targeted test seam around merge cleanup fallback (mock/spawn failure injection) so TP-029 regressions are caught without relying on source-string assertions.
