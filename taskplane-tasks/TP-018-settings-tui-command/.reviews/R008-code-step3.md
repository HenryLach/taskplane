## Code Review: Step 3: Implement Write-Back

### Verdict: REVISE

### Summary
The Step 3 implementation covers the core write-back workflow well: destination routing is implemented, project writes are confirmed, YAML-only bootstrap now preserves Layer 1 values, and the full suite still passes (598 tests). However, there is one important correctness issue in the malformed-JSON fallback path for project writes. Also, the new write-back behavior currently has no direct automated coverage.

### Issues Found
1. **[extensions/taskplane/settings-tui.ts:378-381] [important]** — The malformed JSON recovery branch calls `loadLayer1Config(configRoot)`, but `loadLayer1Config` is JSON-first and throws when JSON exists but is malformed (`extensions/taskplane/config-loader.ts:269-287`, `extensions/taskplane/config-loader.ts:633-635`). This means the intended “bootstrap from full L1 config” fallback is not actually reachable in that scenario. **Fix:** either (a) add a fallback that bypasses JSON and loads YAML/defaults directly, or (b) remove the misleading recovery branch and fail explicitly with a clear user-facing error.

### Pattern Violations
- `extensions/taskplane/settings-tui.ts:13-14` module header is stale (“display and validation only”), but this file now performs write-back.

### Test Gaps
- No direct tests for `writeProjectConfigField` YAML-only bootstrap preserving existing YAML values.
- No tests for L1+L2 destination choice (`ctx.ui.select`) and confirm/cancel no-op behavior.
- No tests for clear/unset write semantics (`(inherit)` / `(not set)`) across project vs preferences writes.

### Suggestions
- Add focused tests for write-back helpers (temp dir fixtures for JSON-only, YAML-only, and prefs writes).
- Add one high-level flow test for destination selection + confirmation gating to prevent regressions in the new section loop.
