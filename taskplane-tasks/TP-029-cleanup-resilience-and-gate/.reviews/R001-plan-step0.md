## Plan Review: Step 0: Preflight

### Verdict: REVISE

### Summary
The Step 0 checklist is directionally correct, but it is not complete enough to safely drive TP-029 across engine/merge/integrate flows. A few required preflight reads and pattern references are missing, which creates risk of implementing cleanup logic in only one path or missing existing polyrepo conventions. Tightening Step 0 now will reduce churn in Steps 1–3.

### Issues Found
1. **[Severity: important]** — `STATUS.md:16-19` omits the mandatory Tier 2 context read from `PROMPT.md:35-37` (`taskplane-tasks/CONTEXT.md`). Add an explicit Step 0 checkbox to read it before code changes.
2. **[Severity: important]** — Step 0 does not explicitly include `/orch-integrate` cleanup internals, but Step 3 depends on them. Add explicit preflight reads for `extensions/taskplane/extension.ts:331-346`, `:377-390`, and `:466-493` (autostash + post-integration cleanup) so stale current-batch stash handling is implemented in the right layer.
3. **[Severity: minor]** — The plan does not call out existing repo-wide cleanup patterning in resume flow. Add a preflight check of `extensions/taskplane/resume.ts:1475-1507` and compare with `engine.ts:577` / `engine.ts:824` to anchor the issue #93 fix on proven per-repo iteration semantics.

### Missing Items
- A preflight outcome note identifying the concrete root-cause callsites for #93 (`engine.ts:577`, `engine.ts:824` currently scoped to primary repo root).
- A preflight note on where cleanup-failure diagnostics/classification will be surfaced for the Step 2 gate (before implementation starts).

### Suggestions
- Add a short "Preflight findings" block under `STATUS.md` Notes capturing: root cause, target insertion points, and any parity constraints with `resume.ts`.
- During preflight, also record how acceptance criteria from `resilience-and-diagnostics-roadmap.md:441-452` will be validated in tests (`extensions/tests/cleanup-resilience.test.ts`).
