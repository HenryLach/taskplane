## Code Review: Step 5: Workspace Join (Scenario D)

### Verdict: REVISE

### Summary
Scenario D has the right high-level intent (existing workspace config detection + pointer-only flow), but two important control-flow/robustness issues remain. In the current implementation, `--force` bypasses Scenario D and falls through into full Scenario C scaffolding, and malformed existing pointer JSON can crash the command with an uncaught exception.

### Issues Found
1. **[bin/taskplane.mjs:1009] [important]** — Scenario D is nested under `if (effectiveAlreadyInitialized && !force)`, so `taskplane init --force` skips the join flow entirely and executes Scenario C workspace scaffolding/prompts/auto-commit. That violates the Step 5 requirement that existing `.taskplane/` should use pointer-only behavior.  
   **Fix:** Split handling so repo Scenario B remains `!force`-gated, but workspace Scenario D (`resolvedMode === "workspace" && effectiveConfigPath`) is an unconditional early-return branch. Apply `force` only to pointer overwrite confirmation behavior.

2. **[bin/taskplane.mjs:1040] [important]** — `JSON.parse(fs.readFileSync(pointerPath, "utf-8"))` is unguarded. If `.pi/taskplane-pointer.json` is malformed, init crashes with a stack trace instead of controlled CLI behavior.  
   **Fix:** Wrap parse in `try/catch` and treat invalid JSON as a non-matching pointer: warn and prompt to overwrite (or overwrite directly in non-interactive/`--force` mode).

### Pattern Violations
- Defensive JSON parsing is inconsistent with existing file patterns (e.g., `cmdVersion` wraps JSON parsing in `try/catch` at `bin/taskplane.mjs:2268-2273`).

### Test Gaps
- Missing coverage for Scenario D + `--force` when `.taskplane/` already exists (must remain pointer-only, no Scenario C scaffolding).
- Missing coverage for malformed `.pi/taskplane-pointer.json` (must not crash).

### Suggestions
- Consider a small helper for pointer read/validation to keep Scenario D logic linear and reduce repeated edge-case handling.
