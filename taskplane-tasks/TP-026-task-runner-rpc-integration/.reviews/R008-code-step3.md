## Code Review: Step 3: Produce Structured Exit Diagnostic

### Verdict: REVISE

### Summary
The Step 3 implementation is close: exit-summary ingestion is non-fatal, diagnostics are surfaced in task-runner state, and persistence/resume schemas were extended additively. However, there is a classification gap where explicit context-limit kills can be mislabeled as `unknown`, which undermines deterministic diagnostics. There is also a schema-validation looseness for `exitDiagnostic` shape.

### Issues Found
1. **[extensions/task-runner.ts:1316, 1351-1358, 2278-2280] [important]** — `contextKilled` is collected and passed into `buildExitDiagnostic()`, but it is never used when determining classification. In practice, a session killed by the task-runner context guard can end up classified as `unknown` (e.g., no compaction event or context below the 90% classifier threshold) even though the kill reason is explicitly known.  
   **Fix:** incorporate `contextKilled` into classification logic (either as an override/fallback in `buildExitDiagnostic()` or by extending `ExitClassificationInput`/`classifyExit()` to include `contextKilled` with documented precedence and tests).

2. **[extensions/taskplane/persistence.ts:575] [minor]** — `exitDiagnostic` validation only checks `typeof === "object"`, so arrays are accepted even though this field is intended to be a structured diagnostic object.  
   **Fix:** reject arrays (`Array.isArray(...)`) and, ideally, add a minimal shape check (e.g., `classification` is a string) to prevent malformed state from silently passing validation.

### Pattern Violations
- None blocking, but the project’s deterministic-diagnostics goal is weakened by having an explicit runtime signal (`contextKilled`) that is currently ignored.

### Test Gaps
- No tests were added for `_readExitSummary` / `_buildExitDiagnostic` behavior in task-runner (missing summary, malformed JSON, timer/context/user kill signal mapping).
- No persistence tests cover the new `exitDiagnostic` field for both compatibility modes: absent (`undefined`) and present (valid object), plus invalid shapes.

### Suggestions
- Add a focused `extensions/tests/task-runner-rpc.test.ts` suite for Step 3 helpers and kill-reason classification mapping.
- Add persistence round-trip tests that verify `exitReason` remains intact while `exitDiagnostic` is serialized/deserialized additively.
