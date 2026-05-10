## Plan Review: Step 1: Plan the cleanup strategy per error category

### Verdict: REVISE

### Summary
The Step 1 plan is comprehensive on categorization, sequencing, and anti-shortcut guardrails, and it clearly identifies high-volume error classes and a sensible helper-factory strategy for test fixture drift. However, it currently plans to apply several acknowledged real-bug fixes that alter runtime behavior (for example, config key handling and resume-path logic) without an explicit operator-escalation checkpoint required by the task prompt. Because the prompt explicitly says to stop and escalate when a fix would change behavior, that gap should be closed before implementation proceeds.

### Issues Found
1. **[Severity: important]** — The plan conflicts with the task's "Don't change behavior" rule by scheduling behavior-affecting fixes (e.g., `maxWorkerMinutes` typo correction, resume lookup crash path) as normal Step 3 work without a mandatory escalation gate. **Suggested fix:** add an explicit Step 1/Step 3 decision point: for each real-bug fix that changes runtime behavior, document impact and get operator sign-off before applying; otherwise use a non-behavior-changing type alignment approach.

### Missing Items
- Explicit escalation workflow for behavior-changing fixes, tied to concrete files already identified in Discoveries.
- Clear fallback strategy when a typecheck error can be resolved either by behavior change or by type-surface alignment (which option is allowed by default under TP-195 constraints).

### Suggestions
- Keep the excellent per-category table, but tag each planned source fix with one of: `type-drift-only`, `behavior-neutral`, or `behavior-affecting (escalate)` to reduce ambiguity during Step 3 code review.
- In the shared mock helper plan, note how defaults will be sourced (schema defaults vs explicit test-local overrides) to avoid accidental semantic drift in tests.
