## Plan Review: Step 1: Gitignore and Tracked Artifact Checks

### Verdict: APPROVE

### Summary
The Step 1 plan captures the required outcomes from the task prompt: validate required `.gitignore` entries, detect tracked runtime artifacts, and provide actionable remediation. The preflight notes in `STATUS.md` show strong grounding in existing `cmdDoctor()` patterns and reusable helpers, which reduces implementation risk and keeps scope tight. The plan is appropriately outcome-focused for this phase and does not over-specify implementation details.

### Issues Found
1. **[Severity: minor]** The plan does not explicitly state that tracked artifact detection should gracefully degrade when run outside a git repository (or when git commands fail), though this is likely already handled by existing doctor patterns. Suggested fix: include a fallback/skip outcome in Step 1 acceptance notes.

### Missing Items
- Explicit mention of non-git-repo behavior for `git ls-files` check (skip with informative warning vs fail).

### Suggestions
- Reuse existing constants from `bin/gitignore-patterns.mjs` (`TASKPLANE_GITIGNORE_ENTRIES`, `ALL_GITIGNORE_PATTERNS`) to avoid drift between `init` and `doctor`.
- Keep severity levels aligned with spec intent: missing ignore entries as WARN, tracked runtime artifacts as FAIL with `git rm --cached ...` remediation examples.
- In Step 5, include at least one verification case for partial matches in `.gitignore` (e.g., comment/whitespace variants) to avoid false negatives.
