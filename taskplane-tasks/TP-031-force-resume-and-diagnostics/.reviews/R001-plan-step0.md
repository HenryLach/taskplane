## Plan Review: Step 0: Preflight

### Verdict: REVISE

### Summary
The Step 0 checklist is a reasonable start, but it is missing a few preflight reads that are important for this task’s risk profile (resume semantics + persisted diagnostics artifacts). Right now it mostly lists high-level files, but does not yet cover required dependency/context validation or the helper modules that actually drive phase transitions. Tightening Step 0 now will reduce the chance of implementing the right behavior in the wrong layer.

### Issues Found
1. **[Severity: important]** — Mandatory Tier 2 context read is missing from the Step 0 plan.
   - Evidence: `PROMPT.md:31-33` requires reading `taskplane-tasks/CONTEXT.md`, but `STATUS.md:15-18` does not include it.
   - Suggested fix: add an explicit Step 0 checkbox for `taskplane-tasks/CONTEXT.md` before implementation.

2. **[Severity: important]** — TP-030 dependency contract is not explicitly included in preflight, despite being required for this task.
   - Evidence: `PROMPT.md:27` declares TP-030 dependency; Step 1/3 require writing `resilience.resumeForced` and diagnostics outputs (`PROMPT.md:67-69`, `PROMPT.md:86-90`), but `STATUS.md:15-18` does not include schema/serialization touchpoints.
   - Relevant code anchors: `extensions/taskplane/types.ts:1227-1310` (canonical resilience/diagnostics types/defaults), `extensions/taskplane/persistence.ts:850-905` (diagnostics validation), `extensions/taskplane/persistence.ts:1091-1119` (state serialization contract).
   - Suggested fix: add preflight checks to confirm these contracts before changing resume/report behavior.

3. **[Severity: important]** — Merge-failure phase behavior cannot be assessed from `engine.ts` alone; the plan omits the policy helper/default source.
   - Evidence: `engine.ts:520` delegates to `computeMergeFailurePolicy`, implemented in `extensions/taskplane/messages.ts:285-354`, with default policy set in `extensions/taskplane/types.ts:179-182`.
   - Suggested fix: add `messages.ts` (and default config source) to Step 0 reads so Step 2 changes target the correct decision point.

### Missing Items
- A Step 0 outcome in `STATUS.md` Discoveries capturing concrete insertion points for:
  - force-resume gating + eligibility override path
  - diagnostic artifact emission on terminal batch completion/failure
- A brief test-intent note mapping current behavior to Step 4 acceptance scenarios (failed/stopped force-resume, completed rejection, report file generation).

### Suggestions
- Add a compact preflight matrix in `STATUS.md` Notes: current resume eligibility by phase vs required TP-031 matrix.
- Record whether `/orch-resume` should pass a `force` flag into `resumeOrchBatch(...)` or use another explicit contract before coding starts.
