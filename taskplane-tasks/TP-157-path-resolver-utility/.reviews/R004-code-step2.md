## Code Review: Step 2 — Refactor callers to use path-resolver.ts

### Verdict: APPROVE

### Summary

The Step 2 refactor is complete, correct, and clean. All three caller files (`execution.ts`, `agent-host.ts`, `agent-bridge-extension.ts`) have had their local path-resolution implementations replaced with imports from `path-resolver.ts`. No `require()` calls remain. No `spawnSync` calls remain in the three refactored files. The public API surface of `agent-host.ts` is preserved via `export { resolvePiCliPath }`. The two failing tests in the full suite (`5.11` and `14.1`) are pre-existing failures unconfected by this step — they also fail on the pre-Step-2 commit (`a95567fa`).

### Issues Found

None.

### Detailed Verification

**`execution.ts`**
- `getNpmGlobalRoot()` removed ✅
- `resolveTaskplanePackageFile()` removed ✅
- `spawnSync` import removed ✅
- `loadBaseAgentPrompt()` updated to call `resolveTaskplaneAgentTemplate(agentName)` ✅
- `resolveTaskRunnerExtensionPath()` updated to delegate to `resolveTaskplanePackageFile()` per PROMPT.md ✅
- Import `{ resolveTaskplanePackageFile, resolveTaskplaneAgentTemplate }` from `./path-resolver.ts` ✅

**`agent-host.ts`**
- `getNpmGlobalRoot()` + `_npmGlobalRootCache` removed ✅
- `resolvePiCliPath()` implementation removed ✅
- `spawnSync` import removed ✅
- `resolvePiCliPath` imported from `./path-resolver.ts` and re-exported as `export { resolvePiCliPath }` ✅ — public API preserved; confirmed by `process-registry.test.ts` 8.2 still passing

**`agent-bridge-extension.ts`**
- `_npmRootCache` removed ✅
- Local `getNpmGlobalRoot()` removed ✅
- `resolvePiCli()` removed ✅
- `spawnSync` import removed ✅
- `loadReviewerPrompt()` refactored: path-resolution logic replaced with `resolveTaskplaneAgentTemplate("task-reviewer")` ✅  
  (Keeping `loadReviewerPrompt` itself is correct — it owns more than just path resolution: fallback default text, local override logic, and front-matter parsing. Only the path-resolution inner logic moves to `path-resolver.ts`.)
- `resolvePiCli()` call replaced with `resolvePiCliPath()` ✅

**No external callers of removed functions**
- Confirmed: no files import `getNpmGlobalRoot`, `resolveTaskplanePackageFile`, or the old `resolvePiCli` from the three files.

**`orch-rpc-telemetry.test.ts`**
- The two source-extraction tests that would have thrown (as called out in R003) were proactively updated to point to `path-resolver.ts`.
- Both now pass: `resolveTaskplanePackageFile consolidated in path-resolver.ts (TP-157)` and `getNpmGlobalRoot consolidated in path-resolver.ts (TP-157)`.

**ESM safety**
- No `require()` anywhere in the refactored files (only a comment in `path-resolver.ts` references it historically). ✅

**Pre-existing test failures (not caused by this step)**
- `14.1: supervised mode presents plan with triggerTurn: true` — source-extraction assertion in `auto-integration.integration.test.ts` that fails before and after this commit.
- `5.11: extension.ts resets execCtx to null before re-initialization` — size/index comparison test in `workspace-config.integration.test.ts` that fails before and after this commit. Confirmed by running the test against `a95567fa` (pre-Step-2 state).

### Pattern Violations

None. The re-export pattern (`export { resolvePiCliPath }` rather than a wrapper function) is idiomatic and correct for preserving a stable public API.

### Test Gaps

None for this step. The source-extraction tests in `orch-rpc-telemetry.test.ts` were correctly redirected to `path-resolver.ts`. The export contract test in `process-registry.test.ts` (8.2) validates the `agent-host.ts` public API continues to work.

### Suggestions

- `resolveTaskRunnerExtensionPath` in `execution.ts` now correctly delegates to `resolveTaskplanePackageFile` per the PROMPT.md requirement, but it still has no callers. Leaving a dead-code comment (e.g., `// retained per TP-157; no current callers`) in a follow-up or CONTEXT.md note would make the situation visible for the next developer.
