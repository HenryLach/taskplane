## Plan Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The Step 4 checklist is aligned with the PROMPT at a headline level, but it is still too broad to guarantee coverage of the highest-risk TP-032 regressions already fixed in Steps 1–3. In particular, the plan does not explicitly protect rollback/advancement safety and parser edge paths that previously required review-driven fixes. Tightening those outcomes now will reduce the chance of silently reintroducing critical behavior bugs.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly include regression coverage for rollback/advancement safety on `verification_new_failure`.
   - Evidence: Step 4 is currently generic (`taskplane-tasks/TP-032-verification-baseline-fingerprinting/STATUS.md:60-68`) and does not call out the R006-critical paths in merge and merge accounting.
   - High-risk behavior exists at:
     - rollback + advancement blocking: `extensions/taskplane/merge.ts:1118-1151`
     - success-count exclusion for errored lanes: `extensions/taskplane/engine.ts:469-472`, `extensions/taskplane/resume.ts:1452-1455`
     - branch-cleanup exclusion for errored lanes: `extensions/taskplane/engine.ts:974-977`, `extensions/taskplane/resume.ts:1515-1519`
   - Suggested fix: Add explicit Step 4 outcomes for (a) successful rollback on new failures, (b) rollback failure/no-preLaneHead blocking branch advancement, and (c) engine/resume counting + cleanup parity when `lr.error` is set.

2. **[Severity: important]** — “Fingerprint parser tests” is underspecified for the exact edge cases that were previously broken.
   - Evidence: parser has non-trivial failure handling that needs explicit regression tests:
     - suite-level vitest failures with no failed assertions: `extensions/taskplane/verification.ts:365-381`
     - non-zero exit with empty/unusable parsed output falling back to `command_error`: `extensions/taskplane/verification.ts:425-437`
   - Suggested fix: Expand Step 4 plan text to explicitly include these two scenarios (in addition to normal assertion failure parsing).

### Missing Items
- Explicit test intent for per-repo baseline artifact collision prevention in workspace mode (repo-suffixed filenames), tied to `merge.ts` naming behavior (`extensions/taskplane/merge.ts:913-917`, `594-595`).
- Explicit statement that Step 4 should prefer behavior-level tests (or clearly scoped functional seams) over source-string pattern assertions for merge outcomes.

### Suggestions
- Update top-level task status metadata for operator clarity: `STATUS.md` currently says `**Status:** ✅ Complete` while Step 4 is still in progress (`taskplane-tasks/TP-032-verification-baseline-fingerprinting/STATUS.md:3-4`, `60-61`).
