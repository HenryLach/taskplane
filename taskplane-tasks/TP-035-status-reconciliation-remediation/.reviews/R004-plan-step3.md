## Plan Review: Step 3: Clean Up System-Owned Template Items

### Verdict: REVISE

### Summary
The Step 3 intent is correct, but the current plan is too underspecified to reliably achieve the outcome in `PROMPT.md` (remove system-owned checklist items and keep worker checkboxes actionable). Right now it only has two broad checklist items (`STATUS.md:40-41`) and does not clearly define audit scope, completion criteria, or verification for this cleanup. Tightening those outcomes will reduce the chance of a superficial pass.

### Issues Found
1. **[Severity: important]** — Audit scope is ambiguous. Step 3 currently says only “Audit templates for system-owned checkboxes” (`STATUS.md:40`), but does not name the concrete template surfaces to scan. This is risky because system-owned wording exists in task-template references such as `skills/create-taskplane-task/references/prompt-template.md:211` (`- [ ] Archive and push`). **Suggested fix:** add an explicit scope item covering all task-template sources that can introduce worker checkboxes, or explicitly document what is intentionally out of scope.
2. **[Severity: important]** — The plan does not explicitly encode the third required outcome from the task prompt: “Ensure template checkboxes represent worker-actionable outcomes only” (`PROMPT.md:90`). **Suggested fix:** add a distinct Step 3 checkbox that defines acceptance criteria (e.g., no system-owned actions in worker checklist items, and wording reflects only worker-owned actions).
3. **[Severity: minor]** — No verification intent is captured for template cleanup. Step 4 currently tests reconciliation/staging only (`STATUS.md:47-49`). **Suggested fix:** add a lightweight verification item (e.g., grep-based check for known banned phrases like “Archive and push” in task templates) so the cleanup is auditable.

### Missing Items
- Explicit list of template files/areas to audit (or an explicit out-of-scope note for non-target template systems).
- A concrete “done” condition for Step 3 beyond “remove or reword” (worker-actionable-only rule).
- A simple verification step proving the cleanup result.

### Suggestions
- Keep this step outcome-focused: define scope, enforce worker-actionable checkbox language, and record one objective verification check.
- If any template source is intentionally deferred, log it in Discoveries with rationale so future tasks can close the gap.
