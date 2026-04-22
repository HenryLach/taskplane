## Plan Review: Step 2: Gitignore Enforcement

### Verdict: REVISE

### Summary
The Step 2 plan is on the right track, but it is currently too compressed and does not explicitly cover all required outcomes from the task prompt/spec. In particular, the gitignore requirements are broader than what is currently tracked, and the cleanup flow needs explicit safety behavior for dry-run/non-interactive execution to avoid regressions in `cmdInit()`.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly include all required gitignore outcomes. `PROMPT.md` requires: create `.gitignore` if missing, skip already-present entries, include `.pi/npm/`, and enforce selective entries (`PROMPT.md:65-68`). Step 2 in status currently has only two broad bullets (`STATUS.md:47-48`), which risks missing required lines from the canonical list (`settings-and-onboarding-spec.md:143-160`). Add explicit outcome coverage for those requirements.
2. **[Severity: important]** — The plan does not call out risk mitigation for side-effecting git cleanup in dry-run/non-interactive flows. The spec requires offering `git rm --cached` for tracked artifacts (`settings-and-onboarding-spec.md:631-648`), but `cmdInit()` currently has non-interactive branches (`bin/taskplane.mjs:782-787`) and a dry-run early return (`bin/taskplane.mjs:873-876`). The plan should explicitly state that dry-run must not mutate git index and that preset/non-interactive behavior remains safe/deterministic.

### Missing Items
- Validation intent for Step 2 outcomes: at minimum cover (a) no `.gitignore` file, (b) partially pre-populated `.gitignore`, (c) tracked artifacts found with accept/decline paths, and (d) no tracked artifacts.
- A note on compatibility with upcoming workspace-mode Step 4 so the same required entry set can be applied to the config repo path consistently.

### Suggestions
- Define a single required-entry list constant and reuse it for both insertion and tracked-artifact checks to prevent drift.
- Log explicit “already present”/“added” statuses to make init behavior auditable for operators.
