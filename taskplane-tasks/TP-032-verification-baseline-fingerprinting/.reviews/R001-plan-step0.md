## Plan Review: Step 0: Preflight

### Verdict: REVISE

### Summary
The current Step 0 plan is a reasonable skeleton, but it is too thin for a high-impact merge-gate change. It lists broad reading goals, but does not yet cover required context/dependency checks or define what concrete preflight findings must be captured before implementation starts. Tightening Step 0 now will reduce risk of implementing baseline verification in the wrong layer.

### Issues Found
1. **[Severity: important]** — Required Tier 2 context read is missing from the Step 0 checklist.
   - Evidence: `PROMPT.md:31-33` requires `taskplane-tasks/CONTEXT.md`, but `STATUS.md:15-17` does not include it.
   - Suggested fix: Add an explicit Step 0 checkbox for `taskplane-tasks/CONTEXT.md` and record key constraints discovered there.

2. **[Severity: important]** — Preflight does not define any required output/evidence, so completion is not auditable.
   - Evidence: Step 0 is currently “read-only” (`STATUS.md:15-17`), while `STATUS.md:74-75` (Discoveries) and `STATUS.md:91-93` (Notes) remain empty placeholders.
   - Suggested fix: Add a Step 0 completion outcome requiring 3–5 concrete findings (with file/line anchors) for baseline capture point, post-merge comparison point, and failure/pause handling point.

3. **[Severity: important]** — Critical integration touchpoints are not called out in preflight scope, increasing risk of partial implementation.
   - Evidence:
     - Current verification execution path is split between merge orchestration and merge-agent instructions (`extensions/taskplane/merge.ts:709-725`, `templates/agents/task-merger.md:71-88`).
     - Workspace/per-repo merge flow is a separate path (`extensions/taskplane/merge.ts:1123-1167`) and is required for per-repo baselines (`PROMPT.md:74-76`, `PROMPT.md:107`).
     - Config changes require adapter plumbing beyond schema (`extensions/taskplane/config-loader.ts:721-766`, `extensions/taskplane/types.ts:11-55`).
   - Suggested fix: Expand Step 0 checklist to explicitly include these touchpoints and note intended insertion points before Step 1.

### Missing Items
- A defined Step 0 deliverable in `STATUS.md` (not just “files read”) that captures:
  - baseline capture insertion point(s)
  - post-merge diff/decision insertion point(s)
  - strict/permissive behavior path when baseline is unavailable
- A preflight note for TP-030 dependency validation (`PROMPT.md:27`) against current persisted/runtime state contracts before adding verification result tracking.
- Test-intent mapping to existing suites (`extensions/tests/merge-repo-scoped.test.ts`, `extensions/tests/project-config-loader.test.ts`) plus the new `verification-baseline.test.ts`.

### Suggestions
- Remove duplicate execution log entries in `STATUS.md:82-85` to keep task history unambiguous.
