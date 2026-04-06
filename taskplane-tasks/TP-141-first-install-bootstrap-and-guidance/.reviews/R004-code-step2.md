## Code Review: Step 2: Cross-provider model guidance in first init

### Verdict: APPROVE

### Summary
Step 2’s implementation in `bin/taskplane.mjs` achieves the stated outcomes: first-init detection via bootstrap metadata/missing reviewer+merger defaults, provider counting, cross-provider recommendation messaging for multi-provider setups, single-provider fallback messaging, persistence of first-run selections to global preferences, and skipping repeat guidance on subsequent configured runs. The test updates in `extensions/tests/init-model-picker.test.ts` cover the primary new branches and pass in targeted execution. I also checked this against the prior Step 2 plan review (R003): the provider-aware guidance behavior is now concretely implemented and exercised.

### Issues Found
1. **[bin/taskplane.mjs:787-791, 610-623] [minor]** If the worker is left as `inherit` on first run, `workerProviderHint` stays empty, so reviewer/merger provider prompts default back to `inherit` instead of a concrete alternate provider. This doesn’t break correctness, but it weakens the intended cross-provider nudge in a common path. Suggested fix: when cross-provider guidance is active and no worker provider can be derived, default reviewer/merger provider selection to the first non-`inherit` provider option.

### Pattern Violations
- None blocking.

### Test Gaps
- No explicit test for the “worker left as inherit during first-run cross-provider guidance” path to verify reviewer/merger provider defaults still nudge away from `inherit`.
- No explicit test for partial preconfigured state (e.g., reviewer set, merger unset) to validate guidance triggering/defaulting behavior for mixed cases.

### Suggestions
- Consider adding a small assertion that the first-run guidance copy still appears when defaults are missing but `wasBootstrapped === false` (existing prefs file without init defaults), since that is part of the intended first-init detection behavior.
