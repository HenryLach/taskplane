## Code Review: Step 2: Implement Segment Parsing

### Verdict: REVISE

### Summary
The Step 2 revision fixes the two blockers from R005 (fallback placeholder introduction + workspace unknown-repo validation), and the parser wiring into discovery is in place. However, there are still correctness gaps that violate the step requirements: duplicate segment detection can be bypassed in mixed pre-segment/explicit cases, and placeholder fallback repo IDs are left unresolved in repo mode. Unknown-repo diagnostics also still omit the required suggested matches.

### Issues Found
1. **[extensions/taskplane/discovery.ts:448-453, 471-483, 1535-1537] [important]** — Duplicate repo detection within a step is incomplete. Pre-segment checkboxes are added as a fallback segment, but that fallback repo ID is never included in duplicate checks. This allows duplicate repo groups in one step (e.g., pre-segment checkboxes + `#### Segment: api`, or placeholder fallback later rewritten to `api` in routing) with no `SEGMENT_STEP_DUPLICATE_REPO` error.
   **Fix:** Include the fallback segment repo in duplicate validation, and after placeholder replacement in `resolveTaskRouting` re-check each step for duplicate repoIds (including fallback-converted entries) and emit `SEGMENT_STEP_DUPLICATE_REPO` as fatal.

2. **[extensions/taskplane/discovery.ts:743-744, 1653-1658] [important]** — `SEGMENT_FALLBACK_REPO_PLACEHOLDER` is only resolved in workspace routing. In repo mode, `resolveTaskRouting` is never called, so `stepSegmentMap` can retain `"__primary__"` instead of a concrete primary repo ID. That breaks the requirement that unsegmented/pre-segment checkboxes map to the task’s primary repo in backward-compatible fashion.
   **Fix:** Resolve placeholders in repo mode as well (e.g., normalize to the repo-singleton fallback such as `default`, or run a shared post-parse normalization pass for both modes).

3. **[extensions/taskplane/discovery.ts:1541-1545] [important]** — Unknown segment repo warnings do not include suggested matches, only the known repo list. Step 2 explicitly requires “unknown repoId (non-fatal warning with suggested matches from workspace repos).”
   **Fix:** Add best-effort suggestions (e.g., closest IDs by prefix/edit distance) to the warning message for unknown segment repo IDs.

### Pattern Violations
- None noted.

### Test Gaps
- No tests were added for `parseStepSegmentMapping` or step-segment routing validation paths (mixed pre-segment + explicit segment duplicate case, repo-mode placeholder normalization, unknown-repo suggestion diagnostics).

### Suggestions
- Add targeted tests in `extensions/tests/discovery-routing.test.ts` for:
  - pre-segment + explicit same-repo collision,
  - repo-mode parsing (no workspace config) ensuring concrete fallback repo IDs,
  - unknown step-segment repo warning content including suggestions.
