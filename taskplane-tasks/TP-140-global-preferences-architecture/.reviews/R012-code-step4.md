## Code Review: Step 4: Settings TUI — source badges and save behavior

### Verdict: REVISE

### Summary
The latest patch correctly addresses the previously flagged cancellation and basic YAML-compatibility behavior (first JSON write now preserves some YAML overrides). However, the compatibility fix is incomplete: first project-write seeding still uses a source-detection YAML mapper that only covers a subset of YAML schema fields. Because the loader is JSON-first, this can still silently drop valid legacy YAML overrides after a single settings write.

### Issues Found
1. **[extensions/taskplane/settings-tui.ts:275-308, 429-433; extensions/taskplane/config-loader.ts:964-968] [important]** — First project JSON write preserves only a partial YAML subset, so other YAML overrides are still lost.
   - `writeProjectConfigField()` now seeds from `readRawYamlConfigs()` when JSON is missing, but `convertYamlKeys()` is intentionally limited for source badges and omits valid config sections/keys (e.g. orchestrator `supervisor`, `verification`; task-runner `quality_gate`, `model_fallback`; any `taskplane-workspace.yaml` content).
   - `loadProjectOverrides()` returns JSON immediately once created, so omitted YAML overrides stop applying.
   - Reproduced locally: `task-orchestrator.yaml` with `supervisor.model: custom-super` is effective before first write, then disappears after writing an unrelated project override.
   - **Suggested fix:** seed first JSON write from the full YAML override mapping used by config-loader (shared helper), including workspace YAML, rather than the TUI’s source-detection mapper.

### Pattern Violations
- Duplicated, partial YAML mapping logic in settings TUI diverges from canonical loader mapping, causing backward-compatibility drift.

### Test Gaps
- Missing regression coverage for YAML-only projects where non-covered keys exist (e.g. `orchestrator.supervisor.*`, `orchestrator.verification.*`, `taskRunner.qualityGate`, `taskRunner.modelFallback`).
- Missing regression coverage for `taskplane-workspace.yaml` preservation when first project JSON override is written.

### Suggestions
- Optional cleanup: some test names still reference legacy wording (`default/user/project config`) even where assertions now validate the new global/project model.