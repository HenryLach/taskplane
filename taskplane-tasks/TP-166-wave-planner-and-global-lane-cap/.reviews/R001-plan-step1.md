## Plan Review: Step 1: Fix Excessive Wave Generation

### Verdict: REVISE

### Summary
The plan identifies the likely root cause (`buildSegmentFrontierWaves` pre-expansion) and is directionally correct for reducing phantom planned waves. However, as written it does not cover critical runtime-state and resume implications of switching to task-level waves while execution still operates on dynamically inserted segment rounds. Without explicitly addressing those contracts, this step risks breaking progress reporting and resumability.

### Issues Found
1. **[Severity: important]** — The plan changes wave generation to task-level (`STATUS.md:28`) but does not include how persisted `wavePlan/currentWaveIndex/totalWaves` semantics will remain consistent with dynamic continuation rounds. In current code, `wavePlan` is persisted and consumed by resume/state logic (`engine.ts:2173-2177`, `engine.ts:2267-2270`, `resume.ts:819-823`, `resume.ts:1770-1784`). If continuation rounds exceed persisted wave plan depth, resume and reconciliation can miscompute remaining work.
2. **[Severity: important]** — “Use task-level wave count for ‘of N’ display” (`STATUS.md:30`) is too narrow. Multiple surfaces currently render `currentWaveIndex/totalWaves` directly (e.g., `engine.ts:2949`, `extension.ts:1554`, `extension.ts:2285`, `extension.ts:2338`). Without a defined mapping strategy (task-wave index vs segment-round index), operators can still see contradictory progress (e.g., wave index exceeding total).

### Missing Items
- Explicit state-model decision for Step 1: either
  - keep persisted `wavePlan` as execution rounds and introduce separate task-wave display metadata, or
  - persist/update a runtime-round plan whenever continuation rounds are inserted so pause/resume stays correct.
- Explicit handling of wave numbering semantics for continuation rounds (what increments, what remains fixed).
- Targeted verification for resume/progress correctness when a task requires >1 segment round (not just wave planner tests).

### Suggestions
- Add/adjust `engine-segment-frontier.test.ts` expectations alongside this change, since it currently asserts pre-expanded rounds (`extensions/tests/engine-segment-frontier.test.ts:76-102`).
- Include one pause/resume regression scenario in this step (or clearly defer it to Step 3 with a committed checkbox), because this change touches persisted wave semantics.
