## Plan Review: Step 1: Plan the gate flip

### Verdict: REVISE

### Summary
The Step 1 plan is strong on sequencing (preflight guardrail, gate ordering, reviewer-note removal, and docs touchpoints) and tracks the intended TP-194 outcomes. However, it currently assumes GitHub branch protection can require **step names** from a single `ci` job. That assumption is likely incorrect and risks producing an operator handoff that cannot be applied in repo settings.

### Issues Found
1. **[Severity: important]** — The plan treats `Typecheck`, `Lint (Biome)`, `Format check (Biome)`, `Run tests`, `CLI smoke checks`, and `Verify docs relative links` as required-status-check names while also keeping all gates as steps inside one `ci` job (`STATUS.md` Discoveries D1/D5 and draft text at lines 130-134, 138-139, 158-166). Branch protection typically consumes check-run contexts (usually job names), not individual step names. **Fix:** update the plan to either (a) model these as separate jobs with those exact names, or (b) keep one job but explicitly verify the real check contexts from an actual CI run and hand off those exact names to the operator.

### Missing Items
- Add a concrete verification action in the plan to capture the exact status-check context names emitted by GitHub Actions post-change (before finalizing Step 5/operator handoff).

### Suggestions
- In Discoveries D5, include a fallback note: “If required-check names differ from expected labels in branch protection UI, use the observed check context strings verbatim.”
