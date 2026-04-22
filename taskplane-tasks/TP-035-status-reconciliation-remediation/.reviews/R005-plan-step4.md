## Plan Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The Step 4 direction is correct, but the current plan in `STATUS.md` is too coarse to prove the new behaviors from Steps 1–2. It currently collapses verification into three generic items (`STATUS.md:48-50`), which does not fully track the explicit prompt outcomes (`PROMPT.md:100-105`). A small hydration pass is needed so test intent is outcome-based and auditable.

### Issues Found
1. **[Severity: important]** — Missing explicit enabled/disabled gate verification for reconciliation. The prompt requires “reconciliation only runs when quality gate enabled” (`PROMPT.md:101`), but Step 4 currently only says “Reconciliation tests” (`STATUS.md:48`). This needs an explicit no-op scenario for disabled gate, especially since reconciliation is invoked in the quality-gate path (`extensions/task-runner.ts:2719-2726`) and bypassed when gate is disabled (`extensions/task-runner.ts:2034-2040`).
2. **[Severity: important]** — Reconciliation edge-case coverage intent is not stated. New logic includes partial annotation behavior, duplicate match consumption, unmatched handling, and no-rewrite idempotency (`extensions/taskplane/quality-gate.ts:686-694`, `738-767`, `813-817`). Without named scenarios, Step 4 may pass with only happy-path tests.
3. **[Severity: important]** — Artifact staging verification is too generic for the new containment/allowlist policy. Step 4 says “Staging scope tests” (`STATUS.md:49`), but does not name key negative paths now implemented: repo-escape folder rejection and no-op commit when no allowlisted artifacts are present/changed (`extensions/taskplane/merge.ts:1229-1235`, `1265-1272`).

### Missing Items
- Explicit test outcome for: gate enabled applies reconciliation, gate disabled does not.
- Explicit reconciliation edge scenarios: `partial`, duplicate/unmatched entries, idempotent no-change rewrite behavior.
- Explicit staging negatives: outside-task/outside-repo candidate rejection and no artifact commit when zero allowlisted files are stageable.

### Suggestions
- Keep this lightweight: add 4–6 named scenario checkboxes under Step 4 (no function-level checklist needed).
- Point each scenario to intended test homes (e.g., `extensions/tests/status-reconciliation.test.ts` plus existing merge test suite) to speed implementation and review.
