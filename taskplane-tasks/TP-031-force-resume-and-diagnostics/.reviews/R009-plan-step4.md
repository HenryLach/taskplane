## Plan Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The Step 4 plan is still too coarse to verify TP-031 safely. It lists broad buckets, but it does not preserve the concrete outcome matrix required by the prompt or the regression-prone contracts introduced in Steps 1–3. Tightening the plan around explicit behavior/risk scenarios is needed before implementation.

### Issues Found
1. **[Severity: important]** — The plan dropped required scenario-level outcomes into generic buckets, which makes acceptance ambiguous.
   - Evidence: `STATUS.md:63-67` only says “Force resume tests / Resume rejection tests / Merge failure phase tests / Diagnostic report tests,” while the task requires explicit cases in `PROMPT.md:99-106` (failed-with-force success, failed-without-force rejection, paused/executing/merging normal resume, completed rejection, JSONL schema, markdown content).
   - Suggested fix: expand Step 4 into a clear scenario matrix aligned to `PROMPT.md:99-106` so each acceptance outcome is testable and auditable.

2. **[Severity: important]** — No explicit test intent for force-resume diagnostics gating and force-intent recording.
   - Evidence: force resume now depends on diagnostics pass/fail and only then sets `resumeForced` (`resume.ts:727-739`), with completed always rejected even with force (`resume.ts:275`).
   - Suggested fix: include explicit scenarios for diagnostics-fail blocking, diagnostics-pass success, and persistence assertion for `resilience.resumeForced=true` only on successful forced resume.

3. **[Severity: important]** — Merge-failure/resumability parity checks are missing for both engine and resume finalization paths.
   - Evidence: resumability depends on pre-cleanup preservation and phase assignment in both paths (`engine.ts:824-830`, `engine.ts:1007-1013`, `resume.ts:1667-1673`, `resume.ts:1757-1763`).
   - Suggested fix: add tests that verify failed-task end state is `paused` (not `failed`) and that worktrees are preserved for resume in both engine and resume paths; also keep `on_merge_failure: abort` behavior covered.

4. **[Severity: important]** — Diagnostic-report test coverage intent is missing key robustness contracts.
   - Evidence: implementation includes fallback/ordering/workspace/non-fatal semantics (`diagnostic-reports.ts:119`, `diagnostic-reports.ts:122`, `diagnostic-reports.ts:258`, `diagnostic-reports.ts:271`, `diagnostic-reports.ts:346`) plus inclusion of pending/blocked tasks via wave/outcome synthesis (`diagnostic-reports.ts:395-405`, `diagnostic-reports.ts:415`).
   - Suggested fix: explicitly plan tests for sparse `taskExits` fallback, deterministic ordering, workspace repo grouping, pending/blocked inclusion, and write-failure non-crash behavior.

### Missing Items
- Explicit acceptance mapping from Step 4 plan to `PROMPT.md:99-106`.
- Force-resume diagnostics fail/pass path coverage and `resumeForced` persistence assertion.
- Engine/resume parity verification for paused-on-failure + worktree preservation.
- Diagnostic robustness coverage (fallbacks, deterministic sort, workspace grouping, non-fatal write failure).

### Suggestions
- Call out intended test files up front (new focused tests + any updates to existing orchestrator regression suites) to keep scope reviewable.
- Keep deterministic assertions (sorted events/sections) to minimize flaky CI behavior.
