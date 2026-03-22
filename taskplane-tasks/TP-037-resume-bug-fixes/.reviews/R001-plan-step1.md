## Plan Review: Step 1: Fix Resume Merge Skip (Bug #102)

### Verdict: REVISE

### Summary
The step plan is close to the right fix path (gate wave-skipping on merge success and add a merge-retry path), but one planned coherence check is likely to be incorrect for valid persisted states. Specifically, using `mergeResults.length` as the consistency signal can misclassify healthy states that legitimately contain extra/duplicate merge records. The plan needs one adjustment so the validation is wave-index aware rather than count-based.

### Issues Found
1. **[Severity: important]** — The planned coherence rule (`mergeResults.length` vs completed waves) is not reliable in this codebase. Persisted merge results can legitimately include re-exec sentinel merges clamped to wave `0` (`extensions/taskplane/persistence.ts:1068`, `extensions/taskplane/persistence.ts:1073`), and tests explicitly validate multiple entries for the same normalized wave (`extensions/tests/orch-state-persistence.test.ts:5764-5766`). A strict length-based check can falsely flag coherent state or incorrectly block resume. **Suggested fix:** validate coherence per wave index (e.g., “any wave being skipped must have a merge result with status `succeeded` for that wave”), not by raw array length.

### Missing Items
- Define deterministic behavior when coherence fails: which wave index to resume from and how to trigger merge retry (instead of only “validate”).

### Suggestions
- If `ResumePoint` gains `mergeRetryWaveIndexes` (as noted in `STATUS.md:89`), explicitly include the type contract update in `extensions/taskplane/types.ts` to avoid drift.
- Use a small helper to normalize merge state by wave (dedupe by wave index, keep latest status) so both skip logic and coherence checks share the same rule.
