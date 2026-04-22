## Plan Review: Step 1: Verification Command Runner & Fingerprint Parser

### Verdict: REVISE

### Summary
The Step 1 checklist captures the high-level objective, but it is still too underspecified for a merge-gate feature that depends on deterministic fingerprinting. Key contracts around command source/cwd, non-vitest command handling, and normalization stability are missing from the plan. Tightening those outcomes now will reduce false positives and integration churn in Step 2.

### Issues Found
1. **[Severity: important]** — The plan does not define the command-runner contract needed for per-repo baselines and flaky re-runs.
   - Evidence: Step 1 only lists generic implementation bullets (`taskplane-tasks/TP-032-verification-baseline-fingerprinting/STATUS.md:27-30`), while requirements require running configured `testing.commands` per repo (`docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md:563,589-592`).
   - Also, current merge flow still feeds `config.merge.verify` into merge requests (`extensions/taskplane/merge.ts:709-714`), and STATUS already notes this mismatch (`taskplane-tasks/TP-032-verification-baseline-fingerprinting/STATUS.md:100`).
   - Suggested fix: Add an explicit Step 1 outcome for `runVerificationCommands()` input/output contract (stable `commandId`, repo-scoped cwd, exit status + captured output) so Step 2 can reliably baseline/diff and rerun failed commands.

2. **[Severity: important]** — Parser scope is too narrow for the stated baseline strategy.
   - Evidence: Step 1 calls out a vitest adapter (`STATUS.md:29`), but baseline strategy applies to all verification commands, not just test frameworks (`docs/specifications/taskplane/resilience-architecture.md:220-228`).
   - Suggested fix: Include a fallback parser outcome now (for non-JSON/non-test command failures) that still emits normalized fingerprints, with adapter hooks for vitest/jest/pytest expansion.

3. **[Severity: minor]** — Normalization and diff determinism rules are not defined.
   - Evidence: Step 1 requires `messageNorm` fingerprints (`PROMPT.md:66`) but does not state how volatile output (paths, line numbers, durations, ANSI noise) will be normalized before `post - baseline` comparison.
   - Suggested fix: Add explicit normalization outcomes (stable ordering + dedupe key + volatility stripping) and corresponding test intent.

### Missing Items
- Explicit failure-path behavior for command execution/parsing errors (spawn failure, malformed JSON, empty output).
- Explicit Step 1 test intent for parser fallback and normalization stability (not only happy-path vitest parsing).
- Explicit statement that command IDs are deterministic and consistent between baseline and post-merge runs.

### Suggestions
- Add a short “Step 1 deliverables” note in `STATUS.md` describing exported types from `verification.ts` so Step 2 integration points are clear.
- Include one small fixture-driven example in planning notes (vitest JSON + raw command failure) to lock parser expectations before coding.
