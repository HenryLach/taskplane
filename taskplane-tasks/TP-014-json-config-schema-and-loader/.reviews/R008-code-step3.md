## Code Review: Step 3: Testing & Verification

### Verdict: REVISE

### Summary
The new `extensions/tests/project-config-loader.test.ts` suite is comprehensive for loader precedence, workspace-root fallback, adapter key preservation, and non-mutation behavior, and the suite passes locally (`cd extensions && npx vitest run` → 16 files / 434 tests). However, one claimed behavior is not actually exercised: the task-runner `loadConfig()` malformed-JSON fallback path is only described, not tested.

### Issues Found
1. **[extensions/tests/project-config-loader.test.ts:727-742] [important]** — Test case `4.5` is labeled as validating task-runner `loadConfig()` error swallowing, but it never calls `loadConfig()` (or any task-runner entrypoint). It only calls `toTaskConfig()` with a hand-constructed default object, so the contract in `extensions/task-runner.ts:149-156` is not verified. **Fix:** add a real failure-path regression that executes the task-runner config load path with malformed `.pi/taskplane-config.json` and asserts default fallback behavior (or rename this case and remove the completion claim if that path is intentionally out of scope).

### Pattern Violations
- Test intent and assertion scope are mismatched in case `4.5` (name/comment promise load-path behavior, body asserts adapter/default mapping only).

### Test Gaps
- Missing direct test that distinguishes:
  - loader behavior (`loadProjectConfig` throws on malformed JSON), and
  - task-runner wrapper behavior (`loadConfig` catches and returns defaults).

### Suggestions
- Optional cleanup: de-duplicate repeated rows in `taskplane-tasks/TP-014-json-config-schema-and-loader/STATUS.md` review/log tables to keep history readable.
