## Code Review: Step 2: Implement Segment Parsing

### Verdict: REVISE

### Summary
The latest revision addresses the prior R007 blocker (invalid segment repo tokens now preserve checkbox extraction) and wires step-segment parsing through discovery/routing end-to-end. However, one correctness gap remains: duplicate segment repo detection is still bypassed in repo mode after fallback placeholder normalization. That violates the Step 2/spec rule that duplicate repo IDs within a step must be discovery errors.

### Issues Found
1. **[extensions/taskplane/discovery.ts:477-479, 1711-1723] [important]** — Duplicate repo IDs can slip through in repo mode when pre-segment checkboxes use the placeholder fallback and a later explicit segment resolves to `default`. Because placeholder fallback is excluded from `seenRepoIds` during parse and repo mode only rewrites `__primary__ -> default` without a post-normalization duplicate check, discovery returns no `SEGMENT_STEP_DUPLICATE_REPO` error for a malformed step that ends up with two `default` groups.  
   **Repro:** PROMPT step with `- [ ] pre`, then `#### Segment: default`, then `- [ ] explicit` in repo mode (`workspaceConfig` absent).  
   **Fix:** After repo-mode placeholder replacement, run the same per-step duplicate validation already done in workspace routing (or extract shared normalization/validation helper used by both branches) and emit `SEGMENT_STEP_DUPLICATE_REPO`.

### Pattern Violations
- None noted.

### Test Gaps
- No tests currently cover repo-mode duplicate detection after placeholder normalization (`__primary__` + explicit `default` collision).

### Suggestions
- Add targeted discovery test(s) for the repro above to lock in duplicate detection behavior in both workspace and repo modes.
