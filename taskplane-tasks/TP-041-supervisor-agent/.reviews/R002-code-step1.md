## Code Review: Step 1: Supervisor System Prompt + Activation

### Verdict: REVISE

### Summary
The step introduces the supervisor module, prompt hook wiring, and settings/config plumbing, but there are two blocking behavioral gaps in activation lifecycle and model override handling. The core structure is sound, and existing tests still pass, but the current implementation does not fully meet Step 1 outcomes as written. I ran targeted tests (`settings-tui`, `user-preferences`, `project-config-loader`) and they passed.

### Issues Found
1. **[extensions/taskplane/extension.ts:955-967, extensions/taskplane/extension.ts:1215-1224, extensions/taskplane/extension.ts:1341, extensions/taskplane/supervisor.ts:338-348] [important]** — Supervisor prompt injection is only deactivated on `/orch-abort`, not on normal terminal outcomes (`completed`/`failed`/`stopped`). This leaves `state.active=true` after normal batch completion and causes supervisor persona bleed into unrelated future turns. **Fix:** deactivate supervisor on all terminal transitions (at minimum in the async engine `.then/.catch` path and any other terminal state paths), not just abort.

2. **[extensions/taskplane/supervisor.ts:248-300, extensions/taskplane/extension.ts:1726-1734] [important]** — `supervisor.model` is loaded/configurable but never applied to runtime model selection. The code claims model override support, but activation uses whatever current session model is active with no override path. **Fix:** wire `supervisorConfig.model` into activation behavior (or explicitly defer and keep Step 1 checkbox incomplete). If implemented, also handle fallback/inheritance and restoration semantics safely.

3. **[extensions/taskplane/extension.ts:923-967, extensions/taskplane/types.ts:976-990, extensions/taskplane/engine.ts:534-540] [important]** — Supervisor is activated before the detached engine initializes batch metadata (`batchId`, wave/task counts). Prompt/context and activation message therefore start with empty/zero values. **Fix:** activate after the engine sets initial batch state (or rebuild/update supervisor prompt immediately once planning metadata is available).

### Pattern Violations
- None beyond the lifecycle/config gaps above.

### Test Gaps
- No tests covering supervisor deactivation on normal terminal completion/failure.
- No tests proving `supervisor.model` changes runtime model behavior.
- No tests ensuring activation prompt includes initialized batch metadata (non-empty batch ID, non-zero planned counts when available).

### Suggestions
- Add a small supervisor-focused unit test file (`extensions/tests/supervisor.test.ts`) now, even if broader Step 5 coverage comes later, to lock in lifecycle invariants early.
