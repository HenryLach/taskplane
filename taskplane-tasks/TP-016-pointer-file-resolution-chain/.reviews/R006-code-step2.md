## Code Review: Step 2: Thread Through Task-Runner

### Verdict: REVISE

### Summary
Step 2 successfully threads pointer-based config roots into `loadProjectConfig()` and keeps repo-mode behavior intact for config loading. The new precedence chain in `config-loader.ts` is clear and covered by passing tests. However, one functional requirement from Step 0/1 is not fully carried through: pointer fallback warnings are computed but never surfaced, which reduces operator visibility and makes pointer misconfiguration silent.

### Issues Found
1. **[extensions/task-runner.ts:152-153, 187-189, 454-457] [important]** — Pointer warnings are dropped instead of surfaced. `resolveTaskRunnerPointer()` documents that callers should log `result.warning`, but both `loadConfig()` and `loadAgentDef()` ignore it. In workspace mode, missing/malformed/unknown pointer now silently falls back, which conflicts with the “warn + fallback” behavior documented in task status/discovery notes. **Fix:** centralize pointer resolution + warning emission (e.g., helper that logs once per process/task when `warning` exists), and use it in both config and agent resolution paths.

### Pattern Violations
- `extensions/tests/project-config-loader.test.ts:819-1075` contains two overlapping 5.x suites that test nearly the same pointer precedence matrix. This is not functionally wrong, but it adds maintenance noise and makes intent harder to follow.

### Test Gaps
- No direct test coverage for the Step 2 `loadAgentDef()` pointer path threading (`extensions/task-runner.ts:449-467`), especially precedence and fallback cases:
  - cwd override vs pointer agent path
  - pointer missing/malformed fallback behavior
  - repo-mode parity

### Suggestions
- Add a small task-runner-focused test surface (or extract path resolution into a testable helper) for agent lookup precedence.
- De-duplicate the two 5.x pointer test blocks in `project-config-loader.test.ts` to keep one canonical matrix.
