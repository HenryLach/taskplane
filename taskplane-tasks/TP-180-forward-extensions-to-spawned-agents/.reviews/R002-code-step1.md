## Code Review: Step 1: Create settings-loader utility

### Verdict: APPROVE

### Summary
The new `settings-loader.ts` implementation satisfies Step 1’s required behavior: it reads project and global settings, respects `PI_CODING_AGENT_DIR`, merges with project-first deduplication, filters Taskplane packages, and safely falls back on malformed/missing inputs. The implementation is scoped and deterministic, with clear helper boundaries (`readJsonSafe`, package extraction, global path resolution). I don’t see any blocking correctness issues for this step.

### Issues Found
1. **[N/A] [minor]** — No blocking issues found.

### Pattern Violations
- None observed.

### Test Gaps
- No dedicated tests were added in this step for `loadPiSettingsPackages()` / `filterExcludedExtensions()` behavior. This is acceptable if completed in Step 5 as planned, but Step 5 should explicitly cover env override path resolution, malformed JSON fallback, dedupe ordering, Taskplane filtering, and exact-match exclusion behavior.

### Suggestions
- Consider trimming package entries during extraction (e.g., treating `" npm:foo "` as `"npm:foo"`) to avoid whitespace-driven duplicates or invalid `-e` values later.
