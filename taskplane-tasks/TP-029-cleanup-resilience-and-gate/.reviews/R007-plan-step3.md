## Plan Review: Step 3: Integrate Cleanup into /orch-integrate

### Verdict: APPROVE

### Summary
The Step 3 plan now covers the key TP-029 outcomes at the right level: it scopes cleanup verification to all workspace repos, defines batch-scoped autostash targeting, and introduces a deterministic reporting helper for pass/fail cleanup status. It also addresses execution ordering by requiring acceptance checks before final state cleanup and includes targeted tests for autostash handling plus dirty/clean acceptance outcomes. This is sufficient to proceed.

### Issues Found
1. **[Severity: minor]** — `taskplane-tasks/TP-029-cleanup-resilience-and-gate/STATUS.md:69` has conflicting wording (“after all repos integrated + batch state deleted” vs “Acceptance runs BEFORE final state cleanup”). Clarify the sequence in one unambiguous sentence to prevent implementation drift.

### Missing Items
- None blocking.

### Suggestions
- In the Step 3 test checklist text, explicitly mention stale orch-branch and non-empty `.worktrees/` detection to mirror all five acceptance criteria already listed in the plan.
