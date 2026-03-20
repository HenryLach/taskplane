## Plan Review: Step 1: STATUS.md Reconciliation

### Verdict: REVISE

### Summary
The Step 1 objectives are correct, but the implementation plan is currently too thin on execution details for a stateful change. In particular, it does not yet show where reconciliation will be invoked in the quality-gate flow, nor how ambiguous checkbox matches will be handled safely. Tightening those points will make this step deterministic and reviewable.

### Issues Found
1. **[Severity: important]** — The plan does not identify the concrete runtime hook where reconciliation is applied. Today `readAndEvaluateVerdict()` only parses/evaluates (`extensions/taskplane/quality-gate.ts:618-637`), and `doQualityGateReview()` only logs/returns verdict state (`extensions/task-runner.ts:2712-2736`). Suggested fix: explicitly plan reconciliation invocation immediately after verdict read/evaluation in the quality-gate-enabled path.
2. **[Severity: important]** — No deterministic checkbox matching strategy is defined. `statusReconciliation` entries are text-based (`extensions/taskplane/quality-gate.ts:52-59`), while STATUS parsing stores checkbox text without unique IDs (`extensions/task-runner.ts:694-734`). Suggested fix: define duplicate-text handling and “checkbox not found” behavior (log + skip vs fail).
3. **[Severity: important]** — `actualState: "partial"` is valid input (`extensions/taskplane/quality-gate.ts:56`, `275`) but the plan only specifies check/uncheck transitions. Suggested fix: add explicit policy for `partial` (typically no toggle, audit only) to avoid incorrect checkbox flips.
4. **[Severity: minor]** — “Record reconciliation actions in diagnostic report” is ambiguous at task-runner level. The current task artifact with structured chronology is STATUS execution logging (`extensions/task-runner.ts:824-827`). Suggested fix: specify the target artifact/format for reconciliation audit entries.

### Missing Items
- Explicit test coverage intent for: done→check, not_done→uncheck, partial→no change, duplicate checkbox text, and “quality gate disabled / no reconciliation findings” no-op behavior.
- Idempotency expectation across multiple review cycles (same findings should not repeatedly rewrite STATUS.md without net change).

### Suggestions
- Keep reconciliation logic in one helper (likely in `quality-gate.ts`) that returns applied actions; have the caller log those actions to STATUS execution log for operator visibility.
- Add a small guard to preserve exact file formatting/line endings when no checkbox changes are required.
