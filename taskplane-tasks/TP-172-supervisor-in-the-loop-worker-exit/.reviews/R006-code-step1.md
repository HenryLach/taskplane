## Code Review: Step 1: Add Exit Interception to agent-host

### Verdict: REVISE

### Summary
The Step 1 implementation is close to the intended design: `onPrematureExit`, interception counting, reprompt-vs-close branching, and `exit_intercepted` telemetry are all present in `agent-host.ts`. However, the callback safety path is incomplete in one blocking way: synchronous callback failures are not guarded, which can bypass the intended fallback and destabilize the host process. This should be fixed before approving Step 1.

### Issues Found
1. **[extensions/taskplane/agent-host.ts:635] [important]** — `opts.onPrematureExit(lastAssistantMessage)` is invoked outside any `try/catch` or `Promise.resolve` guard. If the callback throws synchronously before returning a promise, the throw escapes the `agent_end` handler and bypasses the intended fallback close path. This conflicts with the step’s required callback safety behavior. **Fix:** wrap invocation defensively, e.g. `const interceptPromise = Promise.resolve().then(() => opts.onPrematureExit!(lastAssistantMessage));` (or a local `try/catch` that emits diagnostic telemetry and calls `closeStdin()`).

### Pattern Violations
- None beyond the callback safety gap above.

### Test Gaps
- No targeted regression test was added for callback failure safety on `agent_end` (especially synchronous throw vs rejected promise vs timeout).
- No test currently asserts that an interception failure still results in deterministic session close and diagnostic `exit_intercepted` emission.

### Suggestions
- Consider distinguishing timeout/rejection in telemetry (`reason: "timeout" | "callback_error"`) instead of inferring from `newPrompt === null`; this will improve operator diagnosis.
