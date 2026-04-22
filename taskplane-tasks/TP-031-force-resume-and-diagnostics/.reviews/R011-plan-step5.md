## Plan Review: Step 5: Documentation & Delivery

### Verdict: REVISE

### Summary
The Step 5 plan is close, but it is currently too minimal to guarantee all required documentation outcomes. It captures the two highest-level tasks, yet it misses an explicit check for the README impact and does not state what `/orch-resume --force` behavior must be documented. Tightening those outcomes will reduce the risk of shipping incomplete user-facing docs.

### Issues Found
1. **[Severity: important]** — The plan omits the explicit “check if affected” requirement for README updates.
   - Evidence: `PROMPT.md:119-120` requires checking `README.md` command table impact, but Step 5 in `STATUS.md:76-79` only lists “Commands reference updated” and “.DONE created.”
   - Suggested fix: add a Step 5 checklist item to evaluate `README.md` and either update `/orch-resume` usage there or record why no change is needed.

2. **[Severity: important]** — “Commands reference updated” is too vague for the changed resume contract.
   - Evidence: `STATUS.md:78` is generic, while current docs still show only `/orch-resume` with no flag details (`docs/reference/commands.md:239-261`).
   - Suggested fix: make the planned doc outcome explicit: syntax `/orch-resume [--force]`, force-only phases (`stopped`/`failed`), normal phases (`paused`/`executing`/`merging`), and `completed` rejection.

3. **[Severity: minor]** — Delivery closure criteria are not reflected in the Step 5 plan.
   - Evidence: completion criteria in `PROMPT.md:122-129` require full task closure, but Step 5 checklist doesn’t mention recording final completion state beyond `.DONE`.
   - Suggested fix: include a final bookkeeping item to mark Step 5 complete in `STATUS.md` (and log completion) after docs are updated.

### Missing Items
- Explicit README command-table impact check (`PROMPT.md:119-120`).
- Concrete `/orch-resume --force` documentation acceptance points (not just a generic “updated”).
- Final delivery bookkeeping intent (Step status/log completion after docs + `.DONE`).

### Suggestions
- Keep the Step 5 checklist concise but outcome-based: “update commands doc,” “evaluate/update README,” “close task artifacts.”
- If possible, include one example invocation (`/orch-resume --force`) in docs to reduce operator ambiguity.
