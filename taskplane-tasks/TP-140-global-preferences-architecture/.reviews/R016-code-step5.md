## Code Review: Step 5: Sparse project config in taskplane init

### Verdict: REVISE

### Summary
The core Step 5 implementation in `generateProjectConfig()` is directionally correct: project JSON is now sparse, agent model/thinking fields are no longer persisted, and explicit orchestrator overrides are supported. However, this change currently leaves the init integration suite in a broken state because existing tests still assume `projectConfig.orchestrator.orchestrator` always exists. Before this step can be considered complete, those affected init tests need to be updated to the new sparse-config contract.

### Issues Found
1. **[extensions/tests/init-mode-detection.integration.test.ts:773,793,806,826] [important]** — Init integration tests now fail with `TypeError: Cannot read properties of undefined (reading 'orchestrator')` after the sparse-config change in `bin/taskplane.mjs` (`generateProjectConfig`, around lines 701–731). These tests still assert unconditional orchestrator JSON fields and directly mutate `config.orchestrator.orchestrator.*`. Update them to match Step 5 semantics (no orchestrator block by default) and keep legacy-migration coverage by constructing explicit orchestrator overrides in test fixtures before injecting legacy keys.

### Pattern Violations
- None in runtime code.

### Test Gaps
- Missing end-to-end init assertions in the existing integration suite for the new contract:
  - default init writes **no** `orchestrator` block in `taskplane-config.json`
  - non-default interactive `max_lanes` writes only `orchestrator.orchestrator.maxLanes`
- Current targeted unit coverage in `init-model-picker.test.ts` is good, but integration coverage is not yet aligned.

### Suggestions
- Minor UX follow-up (non-blocking): if init still prompts for agent model/thinking in interactive mode while project JSON no longer stores them, print a brief note that these are global/default preferences rather than project-persisted fields.
