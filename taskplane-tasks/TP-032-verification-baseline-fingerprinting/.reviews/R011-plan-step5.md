## Plan Review: Step 5: Documentation & Delivery

### Verdict: REVISE

### Summary
The Step 5 plan is directionally correct but too thin to guarantee the docs will fully match the TP-032 behavior now implemented. Right now it can be marked complete after a minimal edit while still leaving key config surface areas undocumented or inconsistent. Add a few explicit documentation outcomes and one required impact check to make this step reliably complete.

### Issues Found
1. **[Severity: important]** — The plan is under-specified for the actual documentation delta and can miss required sections.
   - Evidence: Step 5 in `taskplane-tasks/TP-032-verification-baseline-fingerprinting/STATUS.md:72-75` only says “Config reference docs updated,” while the target doc currently has no `verification` section in schema overview (`docs/reference/configuration/task-orchestrator.yaml.md:15-23`) or field reference tables (`docs/reference/configuration/task-orchestrator.yaml.md:68-92`).
   - Suggested fix: Expand Step 5 outcomes to explicitly cover: (a) schema overview includes `verification`, (b) field reference documents `enabled`, `mode`, `flaky_reruns` with defaults/semantics, and (c) clarification that this is orchestrator-side baseline fingerprinting distinct from `merge.verify`.

2. **[Severity: important]** — The plan omits the required “check-if-affected” commands doc review.
   - Evidence: PROMPT requires checking `docs/reference/commands.md` if merge output is affected (`PROMPT.md:121-123`), but Step 5 checklist has no corresponding item (`STATUS.md:72-75`).
   - Suggested fix: Add an explicit Step 5 checklist item to review `docs/reference/commands.md` and either update it or record “no change required” with rationale.

### Missing Items
- A docs consistency pass against source-of-truth defaults and keys in code (e.g., `mode: "permissive"`, `flakyReruns: 1` in `extensions/taskplane/config-schema.ts:547-551`, legacy YAML key `flaky_reruns` in `extensions/taskplane/types.ts:197-200`).
- Unified JSON mapping updates in the same doc (`task-orchestrator.yaml.md`) so YAML and JSON references stay aligned (key naming table + section mapping + example JSON).

### Suggestions
- When marking Step 5 complete, add one short STATUS note listing exactly which doc sections were updated and whether `docs/reference/commands.md` required changes.
