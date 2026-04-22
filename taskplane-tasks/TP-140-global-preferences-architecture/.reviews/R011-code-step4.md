## Code Review: Step 4: Settings TUI — source badges and save behavior

### Verdict: REVISE

### Summary
The R010 cancellation bug is fixed: escaping/canceling the destination picker now correctly skips writes, and the new `remove-project` route is wired and tested. The `(global)`/`(project)` badge behavior and global-default save flow are also aligned with Step 4 goals. However, there is still one important compatibility regression in project-write behavior for YAML-only projects.

### Issues Found
1. **[extensions/taskplane/settings-tui.ts:428-430, extensions/taskplane/config-loader.ts:964-968] [important]** — First project override write in YAML-only repos can silently drop all existing YAML overrides.
   - `writeProjectConfigField()` now initializes a missing JSON config as `{ configVersion }` and writes only the edited path.
   - `loadProjectOverrides()` returns JSON immediately when present, and no longer reads YAML fallback once JSON exists.
   - Result: in a legacy YAML-only project, choosing **Project override** for one field can effectively disable all other YAML-configured project overrides (they remain on disk but are ignored at runtime).
   - **Suggested fix:** preserve backward compatibility by either:
     - seeding first JSON write from raw YAML overrides (not merged defaults/global), then applying the edited field; or
     - changing loader behavior to merge JSON overrides on top of YAML overrides when both exist.

### Pattern Violations
- Backward-compatibility expectation is violated for legacy YAML config users during settings write flows.

### Test Gaps
- Missing regression test: YAML-only project with multiple YAML overrides, then project-write one field via `writeProjectConfigField()`, should retain other YAML overrides in effective runtime config.
- Missing regression test: `remove-project` action in YAML-only scenario should not unintentionally clear unrelated YAML-based overrides.

### Suggestions
- Minor: a few test names/comments still mention legacy wording (`default/user`, `Project config (shared)`), even though assertions now reflect new behavior.
