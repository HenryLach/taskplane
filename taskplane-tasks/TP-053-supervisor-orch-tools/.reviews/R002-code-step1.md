## Code Review: Step 1 — Register orchestrator tools

### Verdict: REVISE

### Summary
The refactor is directionally good: the command logic was extracted into shared helpers and all five requested tools were registered with schemas, snippets, and guarded error returns.

However, there are two important issues to address before approving Step 1: one behavior regression in `/orch-integrate` notification severity, and missing tests for the newly added tool surface.

### Issues Found

1. **[Severity: important] `/orch-integrate` now collapses warning-level outcomes to `info`, reducing operator visibility.**
   - **Evidence:**
     - `doOrchIntegrate()` computes cleanup results via `computeIntegrateCleanupResult(...)` (`extensions/taskplane/extension.ts:2274`) and appends the report text, but returns only `{ message }` (`extensions/taskplane/extension.ts:2294`).
     - Command handler maps severity using only `result.error ? "error" : "info"` (`extensions/taskplane/extension.ts:2596`).
     - `computeIntegrateCleanupResult` explicitly provides `notifyLevel: "warning"` when residual artifacts exist (`extensions/taskplane/messages.ts:955-957`).
     - Branch-protection precheck warning text is also now only appended into output lines (`extensions/taskplane/extension.ts:2135-2139`) rather than surfaced with warning-level notify.
   - **Risk:** warning conditions (cleanup incomplete / protected-branch caution) are no longer surfaced at warning severity, which weakens operator signal quality.
   - **Suggested fix:** return a severity field from `doOrchIntegrate` (e.g. `{ message, level, error? }`), and preserve command-level warning behavior (`ctx.ui.notify(..., "warning")`) when appropriate. Keep tool output textual as-is.

2. **[Severity: important] No direct tests were added for the new `orch_*` tool registrations and schemas.**
   - **Evidence:**
     - Changed tests only update existing source-slicing checks for helper extraction (`extensions/tests/non-blocking-engine.test.ts`) and a cwd-allowlist tweak (`extensions/tests/workspace-config.test.ts`).
     - No assertions currently verify registration of `orch_status`, `orch_pause`, `orch_resume`, `orch_abort`, `orch_integrate`, their parameter schemas, or prompt metadata.
   - **Risk:** tool wiring/contract drift can regress silently (especially promptSnippet/guidelines/schema shape), and this step’s primary deliverable lacks dedicated coverage.
   - **Suggested fix:** add source-based tests asserting:
     - all 5 tool names are registered,
     - expected parameter schema fields exist (`force`, `hard`, `mode`, `branch`),
     - each tool includes `description`, `promptSnippet`, and `promptGuidelines`.

### Validation Run
- `cd extensions && npx vitest run tests/non-blocking-engine.test.ts tests/workspace-config.test.ts` ✅ (169 tests passed)
