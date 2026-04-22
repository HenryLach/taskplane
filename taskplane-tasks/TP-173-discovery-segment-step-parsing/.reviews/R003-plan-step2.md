## Plan Review: Step 2: Implement Segment Parsing

### Verdict: REVISE

### Summary
The Step 2 plan is close, and it builds appropriately on the Step 1 type work that was approved earlier. However, as written it does not fully cover two required outcomes from the task/spec: explicit fallback mapping behavior for unsegmented checkboxes, and non-fatal unknown-repo warnings (with suggestions) at discovery time. Without those clarifications, this step can miss required behavior or classify diagnostics incorrectly.

### Issues Found
1. **[Severity: important]** — `STATUS.md` Step 2 currently says "unknown repoId deferred to routing" (STATUS.md:38), but the task/spec require unknown segment repo IDs to produce a **discovery warning (non-fatal)** with suggested matches (PROMPT.md:76,91; segment-aware-steps.md:192-193,200). Routing unknown-repo paths in current discovery are fatal-oriented (`TASK_REPO_UNKNOWN`/`SEGMENT_REPO_UNKNOWN` patterns), so deferring without a clear non-fatal warning path risks violating required behavior.
2. **[Severity: important]** — The plan does not explicitly commit to the fallback rule that checkboxes before any `#### Segment:` marker (or in steps with no markers) map to the task’s primary repo/packet repo fallback (PROMPT.md:74; segment-aware-steps.md:189-196). This is a core compatibility requirement and should be called out as a concrete Step 2 outcome.

### Missing Items
- Explicit Step 2 outcome for fallback grouping of pre-segment and unsegmented step checkboxes to primary repo.
- Explicit diagnostic strategy for unknown segment repo IDs as **warnings** (non-fatal), including suggested repo matches.

### Suggestions
- Add a small note in the plan for how warnings/errors are surfaced without dropping otherwise valid tasks (e.g., parser returns mapping + diagnostics, or a post-parse validation pass in discovery).
- Include at least one targeted Step 2 test run focused on the new parser path (not only routing tests), even if the full test matrix is completed in Step 3.
