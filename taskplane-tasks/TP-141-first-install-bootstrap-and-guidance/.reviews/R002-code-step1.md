## Code Review: Step 1: First-install detection and global prefs bootstrap

### Verdict: APPROVE

### Summary
Step 1 implementation meets the stated outcomes: missing/invalid global preferences now bootstrap from schema seed defaults, thinking defaults are set to `"high"`, metadata (`wasBootstrapped`) is exposed via a backward-compatible companion loader, and writes use temp-file + rename semantics. The changes are scoped to the intended artifacts (`config-loader.ts`, `config-schema.ts`) and targeted tests were updated/added accordingly. I also ran the relevant test files and they pass.

### Issues Found
1. **[extensions/taskplane/config-schema.ts:510-515] [minor]** Inline interface comments for `workerThinking`/`reviewerThinking`/`mergeThinking` still document only `""/"on"/"off"`, but loader logic now accepts full levels (`off|minimal|low|medium|high|xhigh`) and maps `on -> high`. Suggested fix: update these comments to reflect current accepted values.

### Pattern Violations
- None blocking.

### Test Gaps
- No direct assertion for whitespace-only file content (e.g. `"   \n"`) being treated as empty and re-bootstrapped.
- No explicit assertion for the non-bootstrap metadata path (`wasBootstrapped === false`) on valid pre-existing preferences.

### Suggestions
- Consider adding cleanup for stale temp files if `renameSync` fails after temp write (best-effort), to avoid orphaned `*.tmp-*` files in rare I/O failure cases.
- Update top-level loader comments to match current behavior (malformed/empty now re-bootstrap rather than always returning empty defaults).
