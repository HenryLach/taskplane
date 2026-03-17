## Plan Review: Step 2: Thread Through Task-Runner

### Verdict: REVISE

### Summary
The Step 2 direction is correct, but the current plan is too thin to safely thread pointer behavior through both config and agent loading without precedence regressions. Right now it states the destination (“uses pointer”) but not the key outcomes that preserve existing overrides and Step 1 fallback semantics. Add explicit precedence and test intent so implementation can be validated deterministically.

### Issues Found
1. **[Severity: important]** — Step outcomes are underspecified at `taskplane-tasks/TP-016-pointer-file-resolution-chain/STATUS.md:41-42`; they do not lock the config/agent precedence chain already documented in `STATUS.md:181-190`. This creates risk of regressions in current behavior (`extensions/taskplane/config-loader.ts:557-567`, `extensions/task-runner.ts:406-443`). **Suggested fix:** add explicit Step 2 outcomes that preserve order: cwd local overrides first, then pointer-resolved roots, then existing workspace/env fallback/defaults.
2. **[Severity: important]** — The plan does not explicitly carry forward Step 1’s non-fatal pointer contract (`STATUS.md:30-31`, `STATUS.md:175`) into task-runner integration. Without this, `loadConfig()` / `loadAgentDef()` could diverge on missing/malformed/unknown pointer handling. **Suggested fix:** add an outcome that task-runner consumes `resolvePointer()` and applies warn+fallback consistently (no throws, repo mode untouched).
3. **[Severity: important]** — No Step 2 test coverage intent is specified, even though this step changes two critical loaders (`extensions/taskplane/config-loader.ts:557-615`, `extensions/task-runner.ts:406-443`). **Suggested fix:** add plan intent for targeted tests: workspace valid pointer path, missing/malformed pointer fallback, and repo-mode parity for both config and agent resolution.

### Missing Items
- Explicit Step 2 outcome for how pointer warnings are surfaced (and that behavior is non-fatal).
- Explicit Step 2 outcome preserving local agent override behavior before pointer agent lookup.
- Step-scoped testing intent tied to task-runner/config-loader behavior, not only Step 1 resolver unit tests.

### Suggestions
- Keep pointer parsing centralized in `extensions/taskplane/workspace.ts` and avoid duplicating pointer-file reads in task-runner/config-loader.
- Consider one small shared helper for task-runner “resolved roots” to avoid config/agent drift.
