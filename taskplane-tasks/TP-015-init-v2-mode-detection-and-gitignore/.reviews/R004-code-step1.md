## Code Review: Step 1: Mode Auto-Detection

### Verdict: REVISE

### Summary
The step adds the requested mode-detection structure and integrates it into `cmdInit()`, including ambiguous-mode prompting and the no-repo error path. However, the current sub-repo detection logic is incorrect and causes false ambiguous detection in normal monorepos. There is also a path-mapping bug in the ambiguous→workspace flow that can misreport where existing workspace config was found.

### Issues Found
1. **[bin/taskplane.mjs:571-600] [critical]** — `findSubdirectoryGitRepos()` uses `isGitRepo()` based on `git rev-parse --is-inside-work-tree`, which returns true for *any* directory inside the current repo (not just nested repos). In a standard monorepo, most child directories are therefore incorrectly classified as git repos, forcing `ambiguous` mode.  
   **Repro:** from this repo, `node bin/taskplane.mjs init --dry-run --preset minimal` prints “Ambiguous layout detected...” even though there are no nested repos.  
   **Fix:** differentiate “inside a worktree” vs “repo root”. For subdirectory detection, require that `git rev-parse --show-toplevel` for the child resolves to that child path (or check for a `.git` entry in the child and validate with git).

2. **[bin/taskplane.mjs:643-650, 769-773] [important]** — In ambiguous mode, `existingConfigPath` is set to `dir/.pi` (monorepo config), but if the user selects workspace mode, the code treats that path as if it were `<repo>/.taskplane` and prints a bogus repo name/path.  
   **Repro:** git repo with one nested repo + local `.pi/task-runner.yaml`; choose `w` at prompt → message reports `<workspace-root>/.taskplane/` as existing config.  
   **Fix:** keep separate fields for monorepo-initialized vs workspace-config-detected, or recompute workspace existing-config detection after resolving `workspace` mode.

### Pattern Violations
- None beyond the functional issues above.

### Test Gaps
- No automated coverage was added for mode detection edge cases (normal monorepo, true nested-repo ambiguity, workspace root, and ambiguous + workspace selection with existing local `.pi` config).

### Suggestions
- Add a small pure helper test matrix around mode classification before Step 4 builds on this behavior.
