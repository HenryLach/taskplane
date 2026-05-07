## Code Review: Step 1: Cluster A — Defensive tests + helper hardening

### Verdict: REVISE

### Summary
Most of Cluster A is in good shape: the new wiring/runtime/worktree tests are clear and the targeted suite passes. However, the fenced-block hardening in `isStepMarkedComplete` is still incorrect for valid mixed-fence content and can produce false positives, and the new runtime guard test does not cover the required `type='test'` refusal path from the step checklist. No project-level typecheck/lint/format-check commands were discoverable in `.pi/taskplane-config.json` / legacy runner config or `package.json` scripts, so quality checks were not run.

### Issues Found
1. **[extensions/taskplane/agent-bridge-extension.ts:180-193] [important]** — Fence handling toggles on *any* `````/`~~~` line, regardless of opener type/length, so a `~~~` line inside an open backtick fence prematurely closes `inFence` and allows `**Status:** ✅ Complete` inside that same code block to be matched. This defeats the hardening goal in legitimate markdown content. **Fix:** track fence opener character and length (e.g., ``` vs ~~~~, n chars), only close when a matching delimiter (same char, length >= opener length) is seen, and only evaluate `nextStepHeadingRe` when not inside a fence.
2. **[extensions/tests/review-step-guard-runtime.test.ts:165-309] [important]** — Step 1 Item 2 requires runtime coverage for `review_step(step=2, type='test')` being refused on a Complete step, but this file currently tests `type='code'` refused, `type='plan'` allowed, and `type='code'` on In Progress. The required `type='test'` refusal branch is missing. **Fix:** add a test mirroring the code-refused assertions for `type='test'` (REFUSED payload, no spawn, review counter unchanged).

### Pattern Violations
- None beyond the fence-state bug above.

### Test Gaps
- Missing explicit runtime assertion for `type='test'` refusal path in `review_step` guard behavior.
- Missing regression test for mixed fence delimiters inside the same fenced block (e.g., backtick fence containing a `~~~` line).

### Suggestions
- Keep the additional `type='code'` In-Progress sanity test; it is useful defense-in-depth even after adding the required `type='test'` blocked case.
