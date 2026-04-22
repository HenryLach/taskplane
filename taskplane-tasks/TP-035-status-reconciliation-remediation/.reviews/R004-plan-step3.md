## Plan Review: Step 3: Clean Up System-Owned Template Items

### Verdict: REVISE

### Summary
The Step 3 direction is correct, but the plan is still too thin to guarantee the cleanup outcome in `PROMPT.md`. It currently has only two broad items (`STATUS.md:40-41`) and does not clearly define audit boundaries or an auditable completion check. A small hydration update will make this step deterministic and easier to verify.

### Issues Found
1. **[Severity: important]** — Audit scope is ambiguous. `STATUS.md:40` says “Audit templates,” but does not specify which template sources are in/out of scope. This is risky because system-owned checkbox wording exists in template references (for example `skills/create-taskplane-task/references/prompt-template.md:211` has `- [ ] Archive and push`). Suggested fix: add one outcome-level checkbox that names the audit surface (or explicitly records intentional exclusions).
2. **[Severity: important]** — The plan does not explicitly encode the third required Step 3 outcome from `PROMPT.md:90` (“template checkboxes represent worker-actionable outcomes only”). Suggested fix: add a distinct acceptance checkbox that confirms all retained checkbox wording is worker-owned action, not system/orchestrator action.
3. **[Severity: minor]** — No verification intent is captured for this cleanup. Current Step 4 checks are limited to reconciliation/staging (`STATUS.md:47-49`). Suggested fix: add one lightweight verification item (manual diff review or grep check for known banned phrases) so Step 3 completion is auditable.

### Missing Items
- Explicit audit scope (what template files are covered, and what is intentionally deferred).
- Explicit “done” condition for worker-actionable-only checkbox wording.
- A minimal verification step tied to the template cleanup.

### Suggestions
- Keep this lightweight: one scope checkbox, one acceptance checkbox, one verification checkbox is enough.
- If any template source is deferred, log it in `STATUS.md` Discoveries with rationale so follow-up work is trackable.
