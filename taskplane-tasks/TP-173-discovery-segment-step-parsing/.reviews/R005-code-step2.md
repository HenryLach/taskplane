## Code Review: Step 2: Implement Segment Parsing

### Verdict: REVISE

### Summary
The parser scaffolding is in place and duplicate/empty-segment handling was integrated into discovery diagnostics, but two required behaviors from the task/spec are still missing. Most importantly, fallback segment assignment is currently incorrect when `promptRepoId` is absent, and unknown step segment repo IDs are never validated against workspace repos. As implemented, `stepSegmentMap` can carry unusable repo IDs and miss required warnings.

### Issues Found
1. **[extensions/taskplane/discovery.ts:736-739, 435-443] [important]** — Fallback segment repo is hardcoded to `"default"` when `promptRepoId` is missing, but spec requires fallback to the task's **primary repo** (packet/resolved repo). This will produce incorrect `stepSegmentMap` entries for tasks that rely on area/default/file-scope routing and breaks the backward-compatibility rule for unsegmented steps.  
   **Fix:** Defer fallback repo binding until routing resolution is known (e.g., patch fallback segment groups after `resolvedRepoId` is computed in `resolveTaskRouting`), or introduce an explicit placeholder token that is deterministically replaced with the resolved primary repo before any consumer reads `stepSegmentMap`.

2. **[extensions/taskplane/discovery.ts:453-463, 1388-1545] [important]** — Unknown step segment repo validation is missing. Current code only checks repo ID format (`SEGMENT_STEP_REPO_INVALID`) and never checks whether segment repo IDs exist in workspace config, so required “unknown repoId → non-fatal warning (with known/suggested repos)” behavior is not implemented.  
   **Fix:** In workspace mode (where `validRepoIds` is available), validate every `task.stepSegmentMap[].segments[].repoId` against workspace repos and emit a non-fatal discovery warning code for unknown IDs (include known repos and best-effort suggestions).

### Pattern Violations
- None noted.

### Test Gaps
- No new tests were added for `parseStepSegmentMapping` behavior (fallback grouping, mixed pre-segment + explicit segments, duplicate-in-step error, empty segment warning, unknown repo warning path).

### Suggestions
- Add focused tests in `extensions/tests/discovery-routing.test.ts` (or a dedicated discovery parsing test file) that assert `ParsedTask.stepSegmentMap` contents directly, including the workspace-mode unknown-repo warning path.
