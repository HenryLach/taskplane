## Plan Review: Step 1 — Create extensions/taskplane/path-resolver.ts

### Verdict: APPROVE

### Summary
The plan correctly specifies all four exports required by the PROMPT, with accurate resolution order, module-level caching, ESM safety, and Windows compatibility requirements. The preflight discoveries in STATUS.md show the worker has read all three source files and identified the important behavioral nuance (the `agent-bridge-extension.ts` implementation being nested inside `export default function(pi)` rather than at module scope). No blocking gaps were found.

### Issues Found
_None._

### Pattern Violations
_None._

### Test Gaps
One pre-existing test concern worth knowing before Step 2: `orch-rpc-telemetry.test.ts` uses source-extraction to assert that `getNpmGlobalRoot` and `resolveTaskplanePackageFile` exist **in `execution.ts`** (lines ~71–82). When Step 2 removes those functions from `execution.ts`, those two test cases will fail. Step 3 ("Fix all failures") covers this, but the worker should redirect those assertions to target `path-resolver.ts` rather than deleting them — they encode an important cross-platform contract worth keeping.

Similarly, `process-registry.test.ts` test 8.2/8.3 imports `resolvePiCliPath` from `agent-host.ts`. After refactoring, `agent-host.ts` must re-export `resolvePiCliPath` from `path-resolver.ts` (not just consume it internally) to preserve this public API. The PROMPT calls this out, so it's already planned — noting it here for awareness.

### Suggestions
- The `resolveTaskplaneAgentTemplate(agentName)` convenience wrapper uses `process.cwd()` as the `repoRoot` argument to `resolveTaskplanePackageFile`. This is consistent with how `loadBaseAgentPrompt` in `execution.ts` calls it today (`resolveTaskplanePackageFile(process.cwd(), relPath)`), so it's correct. Just make sure the JSDoc on this function documents that it uses `cwd` at call time, since callers running inside worktrees (lane workers) may have a different cwd than the main process.

- When writing the error message for `resolvePiCliPath`, prefer the more diagnostic form already present in `agent-host.ts` — `"npm root -g: ${npmRoot || "(not found)"}"` — rather than the terser form in `agent-bridge-extension.ts`. Both are in-scope but the former gives operators immediate actionable info.

- The `resolveTaskplanePackageFile` "peer of pi" fallback (step 4 in execution.ts) is not currently present in `agent-bridge-extension.ts`'s `loadReviewerPrompt`. Consolidating under the shared module means `agent-bridge-extension.ts` will gain this extra resolution path — a net improvement, not a regression, consistent with the PROMPT's goal of covering all setups.
