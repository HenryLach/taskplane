## Plan Review: Step 2: Implement Structured Review

### Verdict: REVISE

### Summary
The Step 2 plan captures the core gate flow (spawn review, parse verdict, branch PASS vs NEEDS_FIXES), but it is still missing a few key outcomes that protect compatibility and make the implementation verifiable. In particular, the artifact contract and failure-path handling are under-specified for a step that changes `.DONE` authority. Tightening these items now will reduce churn in Step 3/4.

### Issues Found
1. **[Severity: important]** — The plan in `STATUS.md:39-43` does not explicitly require writing/consuming `REVIEW_VERDICT.json` in the task folder, even though this is a Step 2 requirement (`PROMPT.md:75`) and part of artifact scope (`docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md:749-753`). **Suggested fix:** add a Step 2 outcome that the review prompt must write `<taskFolder>/REVIEW_VERDICT.json`, and parsing must read that file as the quality-gate source of truth.
2. **[Severity: important]** — Verdict evaluation is listed generically (`STATUS.md:42`) but does not state that rules must be applied using configured threshold/model values already added in Step 1 (`extensions/task-runner.ts:62-68`, `extensions/taskplane/quality-gate.ts:108-111`). **Suggested fix:** add explicit outcome text: use `quality_gate.pass_threshold` for `applyVerdictRules(...)` and `quality_gate.review_model` (with fallback chain) for the review agent.
3. **[Severity: important]** — Failure-path mitigation is incomplete in the plan: it covers malformed JSON (`STATUS.md:41`) but not reviewer crash/no output file/non-zero exit, which should still fail-open to PASS per roadmap intent (`resilience-and-diagnostics-roadmap.md:653-661`, `STATUS.md:155`). **Suggested fix:** add explicit Step 2 failure-path outcome for missing verdict file / agent error -> synthetic PASS, plus a test intent entry.
4. **[Severity: minor]** — Header status currently says complete while Step 2 is in progress (`STATUS.md:4` vs `STATUS.md:38`). **Suggested fix:** set top-level Status to in-progress until remaining steps are done.

### Missing Items
- Explicit Step 2 compatibility outcome: when `quality_gate.enabled` is false, keep existing completion/archive path unchanged around `.DONE` creation (`extensions/task-runner.ts:1908-1932`).
- Step-level test coverage intent for “review agent produced no verdict file” and “review agent exits non-zero but task still proceeds (fail-open)”.

### Suggestions
- Add a short “Step 2 Outcomes” subsection (like Step 0 notes) with 3-5 concrete acceptance bullets.
- Record where quality-gate review events/verdicts are logged in `STATUS.md` so operator visibility remains clear.
