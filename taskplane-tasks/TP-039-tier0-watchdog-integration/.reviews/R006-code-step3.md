## Code Review: Step 3: Escalation Interface

### Verdict: APPROVE

### Summary
The Step 3 implementation satisfies the stated escalation outcomes: `EscalationContext` is defined in `types.ts`, `tier0_escalation` is added to the Tier 0 event schema in `persistence.ts`, and `engine.ts` now emits escalation events alongside exhaustion events across the documented Tier 0 exhaustion paths. The new helper keeps payload shape consistent and preserves existing pause/fall-through behavior. I also ran the test suite (`cd extensions && npx vitest run`), and all tests passed.

### Issues Found
1. **[None] [minor]** No blocking correctness issues found in this step.

### Pattern Violations
- None identified.

### Test Gaps
- Step-specific assertions for `tier0_escalation` payload contents at each exhaustion path (worker crash, stale worktree, merge timeout, cleanup gate) are not present yet in this step; this appears deferred to Step 4.

### Suggestions
- In Step 4 tests, assert that `escalation.pattern`, `escalation.attempts`, `escalation.lastError`, and `escalation.affectedTasks` are populated as expected for each path so TP-041 can rely on stable payload semantics.
