## Plan Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The Step 4 checklist covers the headline scenarios from the PROMPT, but it is still too coarse to protect the highest-risk TP-032 regressions already fixed in Steps 1–3. In its current form (`STATUS.md:60-68`), it can pass while missing rollback/advancement safety and parser edge-path coverage that directly affect merge correctness. Tightening those test outcomes will make Step 4 meaningfully verify the new verification subsystem instead of only smoke-checking it.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly include regression tests for `verification_new_failure` rollback/advancement safety.
   - Evidence: Step 4 only lists broad buckets (`taskplane-tasks/TP-032-verification-baseline-fingerprinting/STATUS.md:60-68`), but critical behavior now exists in rollback and lane accounting paths (`extensions/taskplane/merge.ts:1118-1151`, `extensions/taskplane/engine.ts:469-472`, `extensions/taskplane/engine.ts:974-977`, `extensions/taskplane/resume.ts:1452-1455`, `extensions/taskplane/resume.ts:1515-1519`).
   - Suggested fix: Add explicit Step 4 outcomes to test that (a) new-failure lanes are rolled back and marked errored, (b) rollback-failure/no-preLaneHead blocks branch advancement, and (c) engine/resume exclude errored lanes from success counts and branch cleanup.

2. **[Severity: important]** — “Fingerprint parser tests” is underspecified for known edge failures already fixed in this task.
   - Evidence: parser has non-trivial failure paths that are easy to regress: suite-level vitest failures without failed assertions (`extensions/taskplane/verification.ts:365-381`) and non-zero exit with empty/unusable parsed output falling back to `command_error` (`extensions/taskplane/verification.ts:425-437`).
   - Suggested fix: Expand Step 4 plan to call out these two explicit parser outcomes, not just the happy-path field extraction.

### Missing Items
- Explicit test intent for workspace per-repo artifact naming/collision prevention (repo-suffixed baseline/post filenames in `merge.ts:593-595` and `merge.ts:913-915`).
- Clear statement of test style for merge behavior (behavior-level assertions around outcomes, not only source-string presence checks).

### Suggestions
- Fix operator-facing metadata drift while updating Step 4: top-level status says complete (`STATUS.md:4`) but Step 4 itself is still in progress (`STATUS.md:61`).
