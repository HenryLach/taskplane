## Plan Review: Step 1 — Fix integration mode ordering

### Verdict: APPROVE

### Summary
The step's checkboxes correctly identify the key outcomes: check remotes before PR mode, reorder to FF → merge → PR, add logging, update the supervisor prompt, and run targeted tests. The scope is well-contained — the primary change is in `buildIntegrationPlan()` in `supervisor.ts` with a secondary update to the supervisor prompt template.

### Issues Found
None blocking.

### Missing Items
None. The checkboxes cover the required behavioral changes. The worker should be able to figure out implementation details from the codebase.

### Suggestions
- **Supervisor prompt line 155** (`templates/agents/supervisor.md`) says `offer to call orch_integrate(mode="pr")` — this should be updated to suggest ff-first or remove the mode default, aligning with the new ordering. This falls under the "Update supervisor prompt" checkbox already.
- **Test 17.2** (`auto-integration-deterministic.integration.test.ts:189`) currently asserts that `unknown` protection → PR mode. This test will need updating since the new behavior changes what happens when protection is "unknown" and no remotes exist. The worker should watch for this during "Run targeted tests."
- **Remote detection approach:** The simplest approach is `git remote` (returns non-empty if remotes exist) or `git remote show` — either works and doesn't depend on `gh` CLI availability. The existing `runGit` helper in `git.ts` or `execFileSync` in `supervisor.ts` can be used directly.
- Consider whether the `buildIntegrationPlan` function signature should gain a `hasRemotes` parameter (like the existing `protectionOverride`) to keep it testable without real git repos. This would simplify the deterministic test updates.
