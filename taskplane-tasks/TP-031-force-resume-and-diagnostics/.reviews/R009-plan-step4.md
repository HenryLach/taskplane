## Plan Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The current Step 4 plan is too high-level to reliably validate the TP-031 behavior changes. It names broad test buckets, but it does not spell out the specific risk paths introduced in Steps 1–3 (force diagnostics gating, paused-on-failure cleanup timing, and diagnostic report fallback/non-fatal semantics). Tightening the plan with explicit outcome-focused scenarios will reduce regression risk and make verification auditable.

### Issues Found
1. **[Severity: important]** — Force-resume coverage is underspecified for the new eligibility + diagnostics contract.
   - Evidence: Step 4 currently lists only broad buckets (`STATUS.md:63-66`), while the implemented behavior has distinct branches for phase matrix + force + diagnostics gating (`extensions/taskplane/resume.ts:212-303`, `extensions/taskplane/resume.ts:719-739`).
   - Suggested fix: add explicit scenarios for `failed/stopped` with and without `--force`, `completed` rejection even with `--force`, and a diagnostics-fail path (e.g., missing orch branch or corrupted worktree) that blocks force-resume.

2. **[Severity: important]** — Plan does not explicitly cover the Step 2 regression-prone timing/parity behavior.
   - Evidence: recent logic depends on pre-cleanup preservation before final phase assignment in both engine and resume (`extensions/taskplane/engine.ts:822-831`, `extensions/taskplane/engine.ts:1005-1014`, `extensions/taskplane/resume.ts:1665-1674`, `extensions/taskplane/resume.ts:1756-1764`).
   - Suggested fix: include concrete verification that `failedTasks > 0` yields `paused` **and** preserves worktrees in both engine and resume paths, while `on_merge_failure: abort` still ends in `stopped`.

3. **[Severity: important]** — Diagnostic report tests are missing key contract cases (fallback + workspace grouping + non-fatal write failures).
   - Evidence: implementation has explicit fallback precedence and workspace grouping (`extensions/taskplane/diagnostic-reports.ts:117-150`, `extensions/taskplane/diagnostic-reports.ts:257-299`) and guarantees non-fatal emission failures (`extensions/taskplane/diagnostic-reports.ts:324-350`), but Step 4 only says “Diagnostic report tests” (`STATUS.md:66`).
   - Suggested fix: add explicit test intent for sparse `taskExits` fallback behavior, workspace per-repo breakdown correctness, deterministic event ordering, and write-failure non-crash behavior.

### Missing Items
- Explicit scenario matrix tied to TP-031 acceptance outcomes (phase × force × diagnostics result).
- Engine/resume parity checks for paused-on-failure behavior and resumability preservation.
- Diagnostic emission robustness checks (fallback data, workspace repo attribution, non-fatal I/O failure).
- A clear test execution plan (targeted new tests first, then full `cd extensions && npx vitest run`).

### Suggestions
- Record intended test locations up front (e.g., new focused files for force-resume and diagnostic reports plus any updates to existing persistence tests) to keep scope reviewable.
- Prefer deterministic assertions (sorted task IDs / stable markdown sections) to avoid flaky test outcomes.
