## Plan Review: Step 4: Documentation & Delivery

### Verdict: REVISE

### Summary
The Step 4 plan is close, but it is currently too narrow to satisfy the full prompt contract for documentation closeout. In `STATUS.md:72-73`, it only tracks comment updates and `.DONE`, while `PROMPT.md:109-110` also requires checking whether `/orch-status` documentation is affected. Add an explicit doc-impact decision step before final completion.

### Issues Found
1. **[Severity: important]** — The plan omits the prompt-required **"Check If Affected"** documentation review. `PROMPT.md:109-110` calls out `docs/reference/commands.md` if saved branches appear in `/orch-status`, but `STATUS.md:72-73` has no checkbox for this decision. Add a Step 4 item to verify command output vs docs and either (a) update `docs/reference/commands.md` or (b) record "no doc change needed" with rationale.
2. **[Severity: minor]** — The plan does not define a delivery evidence gate before `.DONE` (what was reviewed/updated and why). Given this task’s operator-visibility goal, add a short status/log note requirement so completion is auditable.

### Missing Items
- Explicit Step 4 outcome: review `/orch-status` behavior (`extensions/taskplane/extension.ts:778-802`) against `docs/reference/commands.md:197-214` and record the decision.
- Explicit closeout note in `STATUS.md` (or Execution Log) describing which inline comments were updated and whether docs were changed.

### Suggestions
- Keep Step 4 lightweight: one checkbox for inline comment pass, one for docs-impact decision, one for `.DONE` after recording evidence.
- When marking complete, include a one-line rationale if docs are unchanged (e.g., `/orch-status` output remains summary-only and does not expose saved branch names).
