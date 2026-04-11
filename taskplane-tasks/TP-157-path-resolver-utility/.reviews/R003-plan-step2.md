## Plan Review: Step 2 — Refactor callers to use path-resolver.ts

### Verdict: APPROVE

### Summary

The Step 2 plan is correct and well-targeted. All three caller files are identified with specific function names to remove, and the delegation strategy to `path-resolver.ts` is sound. Path equivalence between the old inline logic and the new `resolveTaskplaneAgentTemplate` wrapper was verified — the constructed paths match. The only predictable issue (two source-extraction tests in `orch-rpc-telemetry.test.ts`) is covered by Step 3's "Fix all failures" checkpoint.

### Issues Found

None that block this step.

### Observations

1. **`orch-rpc-telemetry.test.ts` lines 71–82 will error (not just fail) after the refactor.**
   The `extractFunctionRegion` helper throws `Error("Function signature not found: ...")` when a signature isn't in the source. After `getNpmGlobalRoot` and `resolveTaskplanePackageFile` are removed from `execution.ts`, the two tests that extract those functions from that file will throw rather than produce graceful failures. They need to be updated to point to `path-resolver.ts` instead. Step 3 covers this, but calling it out here avoids a surprise during "Fix all failures."

2. **`resolveTaskRunnerExtensionPath` in `execution.ts` is dead code.**
   It is defined at line 110 but never called anywhere in the codebase (confirmed with grep). The PROMPT.md plan says "Update `resolveTaskRunnerExtensionPath()` to call `resolveTaskplanePackageFile()`" — both "update it to delegate" and "remove it entirely" are valid; either works since it has no callers. The worker should pick one consciously rather than leaving a stub that delegates to nowhere useful.

### Pattern Violations

None observed. The plan stays within the stated scope of a pure refactor — no logic changes, no new exports beyond what `path-resolver.ts` already provides.

### Test Gaps

The `process-registry.test.ts` tests (lines 345–360) verify `resolvePiCliPath` is exported from `agent-host.ts`. The plan correctly preserves this by importing the symbol from `path-resolver.ts` and re-exporting it (`export { resolvePiCliPath } from "./path-resolver.ts"`). No gap here — just worth confirming the re-export form is used so `agent-host.ts` keeps its public surface intact.

### Suggestions

- When updating `orch-rpc-telemetry.test.ts`, consider replacing the two execution.ts source-extraction assertions with equivalent ones against `path-resolver.ts` (same `extractFunctionRegion` pattern, same assertions). This keeps the coverage intent intact rather than simply deleting the tests.
- The `resolveTaskRunnerExtensionPath` dead-code question is a good opportunity for a minor cleanup comment in the commit message (`// dead code — no callers; removed in TP-157 Step 2`).
