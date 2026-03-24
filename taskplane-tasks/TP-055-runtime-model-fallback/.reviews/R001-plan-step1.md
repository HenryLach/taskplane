## Plan Review: Step 1 — Add Exit Classification for Model Access Errors

### Verdict: REVISE

### Summary
The Step 1 direction is mostly correct (new `model_access_error` classification + dedicated detection path), but I can’t approve it yet because the plan/acceptance criteria are not fully aligned with the repo’s current contracts and test baseline.

### Issues Found
1. **[Severity: important] Existing classification tests are now failing and the Step 1 plan does not account for this compatibility update.**
   - `diagnostics.ts` now adds a 10th class (`model_access_error`) and reclassifies rate-limit/auth-like retry errors (`extensions/taskplane/diagnostics.ts:57-83`, `324-339`).
   - But current tests still assume “all 9 classification paths” and expect those rate-limit examples to remain `api_error` (`extensions/tests/exit-classification.test.ts:54-75`, `456-466`).
   - Repro: `cd extensions && npx vitest run tests/exit-classification.test.ts` → 3 failing tests.

2. **[Severity: important] Step 1 acceptance language is ambiguous/misaligned with current taxonomy.**
   - STATUS still says “distinct from generic `agent_error`” (`taskplane-tasks/TP-055-runtime-model-fallback/STATUS.md:32`), but the active classification taxonomy uses `api_error` (not `agent_error`) (`extensions/taskplane/diagnostics.ts:47-60`).
   - This makes completion criteria unclear for reviewers and risks inconsistent implementation decisions.

### Suggestions
- Update Step 1 acceptance wording to: **“distinct from generic `api_error`.”**
- Add explicit Step 1/Step 4 test outcomes for:
  - positive model-access matches (401/403/429/model unavailable/key expired),
  - negative controls that should remain `api_error`/`process_crash`,
  - updated `EXIT_CLASSIFICATIONS` cardinality (10).
- Keep the new classification precedence, but ensure tests codify it so Step 3 fallback logic has a stable contract.
