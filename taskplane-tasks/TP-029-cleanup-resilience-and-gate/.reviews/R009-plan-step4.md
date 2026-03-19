## Plan Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The Step 4 checklist covers the broad TP-029 test themes, but it is missing two outcome-level items that are now critical given current task state. In particular, known Step 3 regressions (R008) are still open, and the Step 4 plan does not explicitly include validating the full `/orch-integrate` polyrepo acceptance contract. Tightening those outcomes will make verification complete and release-safe.

### Issues Found
1. **[Severity: important]** — `STATUS.md:72-75` still has unresolved R008 items (`--pr` orch-branch handling and warning-level notification), but `STATUS.md:82-86` Step 4 plan does not explicitly include closing/verifying those behaviors. **Fix:** add explicit Step 4 test outcomes for PR mode semantics (preserved orch branch is not reported stale) and for notification severity when cleanup is not clean.
2. **[Severity: important]** — The Step 4 checklist dropped a required prompt outcome: `PROMPT.md:107` (“polyrepo acceptance criteria validated after integrate”). Current plan items (`STATUS.md:82-86`) mention autostash but not an explicit cross-repo assertion of all acceptance dimensions (worktrees, lane branches, orch branches, autostash, `.worktrees` containers). **Fix:** add a dedicated acceptance test intent that validates all five criteria across all workspace repos after `/orch-integrate`.

### Missing Items
- Explicit verification that `/orch-integrate --pr` does **not** flag intentionally preserved orch branches as stale.
- Explicit verification of notify level policy (`warning` when cleanup is incomplete).
- A single pass/fail acceptance scenario that checks all five cleanup criteria repo-wide, not just helper-level slices.

### Suggestions
- Keep Step 4 organized as: (1) close known regressions (R008), (2) run targeted suites (`cleanup-resilience`, `orch-integrate`), then (3) run full `vitest` and fix residual failures.
- After test completion, sync the Reviews table to avoid duplicate/stale entries before Step 5 handoff.
