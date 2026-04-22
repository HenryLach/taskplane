## Plan Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The Step 4 checklist covers most of the required Tier 0 scenarios, but two critical outcomes are still underspecified for this codebase. As written, it can pass without proving escalation payload correctness on exhaustion, and without directly verifying the new cleanup-gate Tier 0 recovery path. Add those outcomes so verification actually covers all TP-039 behavior introduced in Steps 1–3.

### Issues Found
1. **[Severity: important]** Exhaustion testing is too vague and does not explicitly require validating `tier0_escalation` event content.
   - Evidence: Step 4 currently lists `Exhaustion-pauses test` and `Event logging test` only (`taskplane-tasks/TP-039-tier0-watchdog-integration/STATUS.md:62,65`), while the prompt requires exhaustion to pause **with escalation event** (`PROMPT.md:106`) and Step 3 introduced a typed escalation payload (`extensions/taskplane/persistence.ts:1636-1640,1650-1686`).
   - Suggested fix: Add an explicit Step 4 outcome to assert that exhaustion emits both `tier0_recovery_exhausted` and `tier0_escalation`, and that escalation context fields are populated (`pattern`, `attempts`, `maxAttempts`, `lastError`, `affectedTasks`, `suggestion`).

2. **[Severity: important]** The plan omits direct verification of cleanup-gate Tier 0 retry behavior.
   - Evidence: TP-039 Step 1 required post-merge cleanup recovery (`PROMPT.md:72`), and engine now contains non-trivial retry/success/exhaustion branches for `cleanup_gate` (`extensions/taskplane/engine.ts:1423-1567`), but Step 4 checklist has no cleanup-gate-specific test (`STATUS.md:61-66`).
   - Suggested fix: Add a Step 4 outcome covering cleanup-gate retry semantics (retry once before pausing, continue on successful retry, pause+escalate on exhaustion).

### Missing Items
- Explicit exhaustion assertion for `tier0_escalation` event payload shape.
- Explicit cleanup-gate Tier 0 recovery test coverage.

### Suggestions
- Keep the new scenarios in `extensions/tests/tier0-watchdog.test.ts` (per task file scope) and reuse existing test utilities from resilience/cleanup tests to avoid brittle setup duplication.
