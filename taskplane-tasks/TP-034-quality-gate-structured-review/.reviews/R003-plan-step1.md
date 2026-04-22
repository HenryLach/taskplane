## Plan Review: Step 1: Define Quality Gate Configuration & Verdict Schema

### Verdict: REVISE

### Summary
The Step 1 plan captures the right direction, but it is still too high-level to guarantee the configuration/schema work will be safely consumable by the existing runtime path. In its current form, it does not clearly define the end-to-end config outcome across schema, adapter, and task-runner shapes, and it lacks explicit verification intent for this step. Tightening those outcomes now will prevent integration churn in Steps 2–3.

### Issues Found
1. **[Severity: important]** — The plan does not explicitly require an end-to-end config contract outcome; it only lists broad tasks in `STATUS.md:26-30`. For this codebase, new fields must flow through `TaskRunnerSection` (`extensions/taskplane/config-schema.ts:171-198`, defaults `:399-420`), adapter mapping in `toTaskConfig()` (`extensions/taskplane/config-loader.ts:803-860`), and runtime `TaskConfig` (`extensions/task-runner.ts:39-62`, defaults `:137-150`). **Suggested fix:** add a Step 1 outcome that confirms `taskRunner.qualityGate` (camelCase) maps to `quality_gate` (snake_case) with defaults preserved.
2. **[Severity: important]** — Required field semantics are not captured as acceptance criteria in the step plan. `PROMPT.md:62-65` specifies exact fields/defaults and constrained values (`pass_threshold` domain), but `STATUS.md:28-30` does not spell these out. **Suggested fix:** add checklist items for required defaults (`enabled=false`, review/fix cycle defaults), allowed threshold values, and mandatory verdict/finding field shapes.
3. **[Severity: minor]** — No Step 1 validation intent is defined for config/schema drift. Current Step 4 checks in `STATUS.md:54-63` focus runtime gate behavior, not schema/adapter correctness. **Suggested fix:** include Step 1 test intent to extend `extensions/tests/project-config-loader.test.ts` (adapter coverage exists at `:528+`) and add initial unit coverage for `quality-gate.ts` verdict schema parsing/normalization.

### Missing Items
- A concrete Step 1 completion outcome for schema → adapter → runtime config propagation.
- Explicit acceptance criteria for all required quality-gate fields and value domains from `PROMPT.md:62-65`.
- Step-level verification target for config defaults and mapping compatibility.

### Suggestions
- Add a short “Step 1 Outcomes” subsection in `STATUS.md` similar to the strong preflight notes style.
- Record a compatibility guardrail in Step 1 text: quality gate remains opt-in by default and does not alter disabled-path behavior.
