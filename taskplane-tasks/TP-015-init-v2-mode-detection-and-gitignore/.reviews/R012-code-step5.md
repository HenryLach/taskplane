## Code Review: Step 5: Workspace Join (Scenario D)

### Verdict: REVISE

### Summary
The new Scenario D branch is a good direction: it now detects existing workspace config and creates a pointer with clear user messaging. However, there is a control-flow bug that makes `--force` bypass Scenario D entirely and run Scenario C scaffolding logic, which breaks the “pointer-only” requirement for joiners. There is also an unhandled JSON parse path that can crash `taskplane init` when an existing pointer file is malformed.

### Issues Found
1. **[bin/taskplane.mjs:1009] [important]** — Scenario D is gated by `if (effectiveAlreadyInitialized && !force)`, so `--force` skips the pointer-only path and falls through into full workspace init (Scenario C prompts/scaffolding/auto-commit). This contradicts Step 5’s required behavior (“create pointer only” for existing workspace config) and also makes the inner `pointerExists && !force` logic effectively dead for force semantics.  
   **Fix:** Handle `resolvedMode === "workspace" && effectiveConfigPath` as a dedicated early-return branch independent of the outer `!force` gate; apply `force` only to pointer overwrite behavior (skip confirmation), not to Scenario D detection.

2. **[bin/taskplane.mjs:1040] [important]** — `JSON.parse(fs.readFileSync(pointerPath, "utf-8"))` is unguarded. If `.pi/taskplane-pointer.json` is malformed, `taskplane init` throws and exits with a stack trace instead of a controlled CLI message.
   **Fix:** Wrap pointer parse in `try/catch`; on parse failure, treat as invalid existing pointer and prompt to overwrite (or overwrite silently with `--force`/preset mode).

### Pattern Violations
- No major project-style violations found beyond missing defensive error handling on file parsing.

### Test Gaps
- Missing coverage for Scenario D with existing config + `--force` (should remain pointer-only, no Scenario C prompts/scaffolding).
- Missing coverage for malformed existing `.pi/taskplane-pointer.json` (should not crash; should recover via overwrite flow).

### Suggestions
- Consider extracting pointer read/validate logic into a small helper to keep Scenario D flow readable and to centralize parse/shape validation.
