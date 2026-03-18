## Plan Review: Step 4: Testing & Verification

### Verdict: REVISE

### Summary
The Step 4 checklist is directionally correct, but it is too high-level to guarantee the core TP-021 outcomes are actually validated. Right now it can produce a green test run without proving batch isolation, transition compatibility, or container-cleanup edge behavior. Add explicit scenario-level test intent for the new/legacy path coexistence and batch-scoped caller behavior.

### Issues Found
1. **[Severity: critical]** — The plan does not explicitly test the required transition compatibility for `listWorktrees()` old + new layouts. This is a hard requirement in `PROMPT.md:152`, and the implementation now has dual-path behavior (`extensions/taskplane/worktree.ts:1201-1254`). The Step 4 checklist in `STATUS.md:67-71` only says “Listing and cleanup verified,” which is too vague. **Suggested fix:** add a concrete test outcome for mixed discovery: legacy flat paths (`{prefix}-{opId}-{N}` / `{prefix}-{N}`) and new nested paths (`{opId}-{batchId}/lane-{N}`) both discovered correctly when `batchId` is omitted.
2. **[Severity: important]** — The plan does not require an explicit same-operator, different-batch isolation test for list/remove behavior, which is the mission’s central risk (“No collisions between concurrent batches,” `PROMPT.md:132-135`). New batch-scoped code paths exist in `listWorktrees(..., batchId)` and `removeAllWorktrees(..., batchId, config)` (`extensions/taskplane/worktree.ts:1201`, `1500`) plus caller wiring in engine/resume/waves (`engine.ts:484,679`, `resume.ts:1295,1323`, `waves.ts:1077`). **Suggested fix:** add a regression scenario proving batch A cleanup/reset does not touch batch B for the same `opId`.
3. **[Severity: important]** — Container cleanup behavior is not broken down into edge cases, despite new empty-only cleanup logic (`extensions/taskplane/worktree.ts:1551-1573`) and explicit “no worktrees found but batch container exists” handling (`worktree.ts:1565-1570`). **Suggested fix:** add tests for (a) remove empty container, (b) preserve non-empty container on partial failure/residual files, and (c) cleanup attempt when `batchId+config` provided but no lanes are discovered.
4. **[Severity: minor]** — Path-generation verification is underspecified against current tests that still emphasize legacy fallback signatures/expectations (`extensions/tests/worktree-lifecycle.test.ts:244-257`, `extensions/tests/naming-collision.test.ts:108-124`). **Suggested fix:** explicitly require assertions for batch-scoped `generateWorktreePath(..., batchId)` and `generateMergeWorktreePath()` (both sibling + subdirectory modes), not only fallback behavior.

### Missing Items
- Explicit compatibility test intent for legacy + new worktree layouts during transition.
- Explicit isolation test intent for same `opId` with different `batchId` across list/remove/reset/cleanup flows.
- Explicit container cleanup edge-case matrix (empty vs non-empty vs no-found-lanes with expected container).
- Explicit test file update targets (at minimum `extensions/tests/worktree-lifecycle.test.ts` and `extensions/tests/naming-collision.test.ts`) to avoid false confidence from legacy-only assertions.

### Suggestions
- Keep full-suite verification (`npx vitest run`) but prepend targeted runs for changed behavior (e.g., worktree lifecycle + naming collision) so failures are easier to triage.
- Add a short Step 4 “pass criteria” block in STATUS mapping each TP-021 completion criterion to at least one concrete test scenario.
