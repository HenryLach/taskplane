## Plan Review: Step 4: Recovery Action Execution + Audit Trail

### Verdict: REVISE

### Summary
The Step 4 plan captures the three broad goals (recovery actions, audit logging, autonomy-driven confirmations), but it is missing two outcome-level commitments needed to make those goals reliably implementable. In particular, the plan does not yet define how actions are classified as destructive vs non-destructive, nor the structured audit contract needed for reliable takeover/replay behavior. Without those, the step can easily ship with inconsistent confirmation behavior and weak auditability.

### Issues Found
1. **Severity: important** — The plan does not define the destructive-action boundary and autonomy decision model. Step 4 requires different behavior in `interactive`, `supervised`, and `autonomous` modes, but without an explicit classification outcome (what is destructive, what is Tier-0-known vs novel), the implementation cannot consistently satisfy "ask before everything" vs "auto known / ask novel" behavior.
2. **Severity: important** — The plan does not specify a structured `actions.jsonl` entry contract for pre-action logging + outcome reporting. This is necessary for operator auditability and for takeover context (current takeover summary already reads action records in `extensions/taskplane/supervisor.ts`, around the `buildTakeoverSummary()` actions section). A vague "audit trail logging" item risks inconsistent/partial records.

### Missing Items
- Explicit outcome: a recovery-action classification model that drives confirmation behavior per autonomy level.
- Explicit outcome: a stable `actions.jsonl` schema (at minimum action identity, reason/context, timestamp, and result) with pre-action logging guaranteed before destructive execution.

### Suggestions
- Keep audit logging best-effort/non-fatal so logging failures do not crash or deadlock recovery.
- Call out that non-destructive diagnostics (read/log/test/status) remain always-allowed across autonomy levels.
