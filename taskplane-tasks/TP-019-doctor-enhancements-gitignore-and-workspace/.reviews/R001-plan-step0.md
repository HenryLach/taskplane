## Plan Review: Step 0: Preflight

### Verdict: REVISE

### Summary
The Step 0 plan is directionally correct but too thin for the stated requirements in TP-019. It currently captures only a generic read of `cmdDoctor()` and spec checks, without explicitly committing to identify baseline doctor output behavior and reusable validation patterns that later steps depend on. Adding those outcomes in preflight will reduce implementation risk and avoid accidental regressions to existing checks.

### Issues Found
1. **[Severity: important]** — Step 0 does not include an explicit baseline capture of current `taskplane doctor` behavior/output. Suggested fix: add a preflight outcome to run `node bin/taskplane.mjs doctor` and record current check headings/messages to preserve backward compatibility in later steps.
2. **[Severity: important]** — The plan does not call out discovery of existing helper/util patterns in `bin/taskplane.mjs` (e.g., git command execution, branch detection, workspace resolution), which is necessary to keep changes scoped and consistent. Suggested fix: add an outcome to inventory reusable utilities and constraints before adding new checks.
3. **[Severity: minor]** — Spec-reading intent is present but underspecified for the exact TP-019 decision points (default branch validation, full pointer chain validation, migration warning behavior). Suggested fix: explicitly list these as preflight acceptance notes in STATUS so implementation steps are anchored to concrete outcomes.

### Missing Items
- Preflight baseline of existing doctor diagnostics (for non-regression confidence)
- Explicit mapping of spec decisions to implementation acceptance criteria
- Preflight test intent for Step 5 scenarios (missing gitignore, tracked artifacts, missing pointer, etc.)

### Suggestions
- Keep Step 0 outcome-level by adding 2–3 concrete bullets in STATUS: baseline output captured, helper reuse map noted, and spec decision checklist extracted.
- In later steps, preserve existing doctor check order/message style unless a deliberate UX change is documented.