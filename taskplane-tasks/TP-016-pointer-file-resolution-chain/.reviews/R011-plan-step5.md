## Plan Review: Step 5: Testing & Verification

### Verdict: REVISE

### Summary
The Step 5 plan is too thin to safely close TP-016. It names a generic pointer test bucket and a full-suite run, but it does not explicitly cover the still-open orchestrator resume invariant or the full failure/parity matrix defined earlier in this task. Tightening the test outcomes will reduce the risk of shipping workspace-mode regressions with passing-but-incomplete coverage.

### Issues Found
1. **[Severity: important]** — The plan does not include closure of the still-open Step 3 test debt: `STATUS.md:60` explicitly requires replacing source-text assertions with a behavioral orch vs orch-resume state-root consistency test, but Step 5 does not mention this outcome. **Fix:** add a required Step 5 item for an end-to-end behavioral test proving `/orch` and `/orch-resume` both read/write batch/merge state under `<workspaceRoot>/.pi` in workspace mode.
2. **[Severity: important]** — `STATUS.md:76` only calls out “pointer resolution tests” with one example (`unknown config_repo`), but the task contract requires consistent warn+fallback for missing, malformed, and unknown pointer scenarios plus repo-mode pointer ignore behavior (`PROMPT.md` Step 5 + `STATUS.md` mode matrix). **Fix:** make the failure/parity matrix explicit in Step 5 outcomes.
3. **[Severity: important]** — The plan lacks a concrete integration verification outcome for the core split invariant: config/agent paths follow pointer, runtime state paths do not. A bare `npx vitest run` (`STATUS.md:77`) is execution, not verification intent. **Fix:** add one integration scenario that asserts pointer-based config/agent resolution while ORCH sidecar/batch/merge state remains workspace-rooted.

### Missing Items
- Explicit repo-mode parity verification for task-runner + orchestrator after pointer threading.
- Explicit verification that dashboard runtime files remain rooted at `<workspaceRoot>/.pi` in workspace mode (no pointer-follow for dashboard state).
- A targeted test run list (pointer/config tests + orchestrator/resume tests) before the full-suite run, so failures map clearly to Step 5 outcomes.

### Suggestions
- Keep Step 5 at outcome level, but define a compact matrix (valid pointer, missing, malformed, unknown repo, repo mode) and map each to expected `used/warning/fallback` behavior.
- Record test evidence in STATUS (which suites/cases passed) to make final Step 6 review straightforward.
