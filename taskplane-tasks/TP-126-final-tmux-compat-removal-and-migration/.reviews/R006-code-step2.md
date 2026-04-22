## Code Review: Step 2: Update schema/types/docs/templates

### Verdict: REVISE

### Summary
Schema/type and settings-TUI updates are mostly aligned with the no-TMUX direction, and the updated tests pass. However, the Step 2 command docs now claim subprocess-only init behavior that is not true in the current CLI implementation. This creates a docs/runtime contract mismatch and leaves `taskplane init` capable of emitting legacy TMUX fields that are rejected by the current config loader.

### Issues Found
1. **[docs/reference/commands.md:667] [important]** — Docs state `taskplane init` now supports only `spawn_mode: "subprocess"`, but CLI init still auto-selects TMUX when available and writes legacy TMUX keys.
   - Evidence in runtime code:
     - `bin/taskplane.mjs:1005-1008` (`detectSpawnMode()` returns `"tmux"` when tmux is installed)
     - `bin/taskplane.mjs:237` writes YAML `tmux_prefix`
     - `bin/taskplane.mjs:318` writes JSON `tmuxPrefix`
     - `bin/taskplane.mjs:1675,1702` still source `tmux_prefix` values
   - This is especially problematic because legacy fields are now hard-failed by config loading (`extensions/taskplane/config-loader.ts:128-146`).
   - **Fix:** Update CLI init scaffolding to emit canonical fields only (`spawn_mode: "subprocess"`, `session_prefix`) and remove tmux-based default selection/legacy key emission.

### Pattern Violations
- Documentation now describes a finalized runtime/config contract that the scaffold generator (`taskplane init`) does not yet implement.

### Test Gaps
- Missing CLI regression coverage ensuring `taskplane init` output does not contain `tmux_prefix`/`tmuxPrefix` and does not set `spawn_mode`/`spawnMode` to `"tmux"` when tmux is installed.

### Suggestions
- Minor doc cleanup: `docs/reference/commands.md:610` still says the **Orchestrator** settings section includes spawn mode, but `settings-tui.ts` moved user-facing spawn mode to **Worker** and removed the orchestrator field.