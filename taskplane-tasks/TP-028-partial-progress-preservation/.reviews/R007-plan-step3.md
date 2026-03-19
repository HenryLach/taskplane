## Plan Review: Step 3: Testing & Verification

### Verdict: REVISE

### Summary
The Step 3 checklist covers core happy-path behavior (saved branch creation, naming in repo/workspace mode, and outcome stamping), but it is too narrow for the risk profile of the Step 1/2 changes. The current plan omits failure-path and state-contract tests that protect against the main regression vectors introduced in this task. Expand the plan to cover unsafe-branch handling and persistence/resume round-trips before implementation proceeds.

### Issues Found
1. **[Severity: important]** — The plan does not include tests for the new **preservation-failed-with-commits** safety path (`STATUS.md:60-65`), which is central to preventing data loss. Step 1 introduced `unsafeBranches` in `preserveFailedLaneProgress` (`extensions/taskplane/worktree.ts:2152-2157,2276-2281`) and reset skipping in both execution flows (`extensions/taskplane/engine.ts:589-593`, `extensions/taskplane/resume.ts:1410-1414`). Add explicit tests that simulate failed preservation with commitCount>0 and verify unsafe branch signaling + reset-skip behavior.
2. **[Severity: important]** — “Test outcome includes partial progress fields” is underspecified for the actual contract boundary. The critical behavior is serialize/validate/resume compatibility for optional fields (`extensions/taskplane/persistence.ts:561-573,794-800`, `extensions/taskplane/resume.ts:1027-1029`). Add round-trip tests for both cases: (a) fields absent/undefined and (b) fields present, ensuring persisted state remains loadable and values survive resume reconstruction.
3. **[Severity: important]** — No test intent is listed for idempotent/collision behavior despite deterministic saved-branch naming. `savePartialProgress` explicitly resolves collisions (`extensions/taskplane/worktree.ts:2088-2113`) to support retries/resume, so Step 3 should include at least one rerun scenario (existing saved branch same SHA) and one divergent-SHA collision scenario.

### Missing Items
- Explicit coverage for both execution paths where preservation is invoked: inter-wave and terminal cleanup in `engine.ts` and `resume.ts`.
- A persistence-focused test artifact plan (e.g., `extensions/tests/partial-progress.test.ts` plus updates to existing persistence tests) instead of only behavior-level bullet points.
- Test intent for preservation error handling (branch missing/target missing/git failure) to ensure operator-visible warnings without silent regressions.

### Suggestions
- Structure Step 3 into two buckets: (1) branch-preservation behavior tests (repo/workspace, collisions, failure paths) and (2) state-contract tests (apply → serialize → validate → resume).
- Run focused test files first, then full suite (`cd extensions && npx vitest run`) as the final gate.
