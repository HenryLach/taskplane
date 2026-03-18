## Plan Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The Step 4 checklist is directionally correct, but it is too narrow for the risk profile of `/orch-integrate`. In `STATUS.md` Step 4 currently focuses on parsing, branch safety, and generic error messages (`STATUS.md:68-72`), while the highest-risk behavior implemented in Step 3 (mode execution + cleanup semantics) is not explicitly included in the verification outcomes. Add explicit test intent for those paths before proceeding.

### Issues Found
1. **[Severity: important]** — Step 4 does not explicitly verify the three integration modes and their distinct failure paths (ff diverged, merge conflict, PR push/gh failures), even though these are core task outcomes and were newly implemented in Step 3. Suggested fix: add explicit checklist items to validate ff/merge/pr success and failure messaging, aligned with `extensions/tests/orch-integrate.test.ts` executeIntegration suites.
2. **[Severity: important]** — Cleanup/state-lifecycle behavior is not called out as a Step 4 verification target. Suggested fix: include explicit checks that cleanup runs only when `integratedLocally===true` (ff/merge success), and does **not** run in PR mode or any failure path, matching the Step 3 contract.
3. **[Severity: minor]** — Command registration visibility is implied but not explicit (“Command parsing verified” only). Suggested fix: add a verification item for command wiring/exposure (registration + session-start command list) to avoid regressions in discoverability.

### Missing Items
- Explicit verification matrix for mode behavior: ff / merge / pr (success + error paths).
- Explicit verification for cleanup gating and batch-state deletion behavior.
- Explicit note to run targeted integrate tests (`extensions/tests/orch-integrate.test.ts`) plus full suite (`cd extensions && npx vitest run`) and record result counts in STATUS.

### Suggestions
- Add a short “Scenario → Covered by test block” note in Step 4 to make review/audit faster.
- Record final vitest pass count and any focused test command outputs in the Execution Log when Step 4 completes.
