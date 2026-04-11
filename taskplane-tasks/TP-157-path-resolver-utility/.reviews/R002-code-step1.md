## Code Review: Step 1 — Create extensions/taskplane/path-resolver.ts

### Verdict: APPROVE

### Summary
The new `extensions/taskplane/path-resolver.ts` implements all four required exports exactly as specified, with faithful reproduction of the existing resolution logic from the three source files. The module is ESM-safe, TypeScript-clean (passes `--check` and loads without error at runtime), and the `npm root -g` cache is verified working on Windows. No blocking issues found.

### Issues Found
_None._

### Pattern Violations
_None._

### Test Gaps
- No unit tests for `path-resolver.ts` itself in this step — but the PROMPT defers testing to Step 3 ("Run full test suite"), so this is expected. When Step 3 runs, the existing tests that validate path resolution logic (currently pointing at `execution.ts` and `agent-host.ts`) should be redirected to cover `path-resolver.ts` directly, as flagged in R001-plan-step1.

### Suggestions
- **Minor:** The `resolvePiCliPath()` error message (`"Ensure the pi coding agent is installed globally via 'npm install -g @mariozechner/pi-coding-agent'"`) is more accurate and informative than the old `agent-host.ts` version (`"'pi install'"`). The npm root diagnostic line is also cleaner (`"npm root -g returned: ..."` vs `"npm root -g: ..."`). This is a net improvement — worth keeping as-is.

- **Minor:** `resolveTaskplaneAgentTemplate` uses `process.cwd()` as the `repoRoot` argument, consistent with how `loadBaseAgentPrompt` in `execution.ts` currently calls `resolveTaskplanePackageFile(process.cwd(), relPath)`. The JSDoc already documents this clearly (`"Absolute path to ... within the resolved taskplane package root"` example shows a runtime path). Good as-is.

- **Observation:** The "peer of pi" fallback (step 8 in `resolveTaskplanePackageFile`) was never present in `agent-bridge-extension.ts`'s `loadReviewerPrompt`. Consolidating under the shared module gives `agent-bridge-extension.ts` this extra resolution path — a net improvement. No action needed, just confirming it's intentional and expected per PROMPT goals.

- **Observation:** `_npmGlobalRoot` is truly module-level (not inside any function or class), confirmed at runtime — caching is functioning correctly on Windows, returning `C:\Users\HenryLach\AppData\Roaming\npm\node_modules` consistently on repeated calls.
