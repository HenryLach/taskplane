## Plan Review: Step 1: Fix Excessive Wave Generation

### Verdict: APPROVE

### Summary
This revision addresses the blocking gaps raised in R001/R002: it now includes a shared display-wave mapping strategy, runtime mapping maintenance during continuation insertion, and explicit resume-path updates. The plan is outcome-focused and should fix phantom wave reporting while preserving existing execution-round semantics and resumability.

### Issues Found
1. **[Severity: minor]** — Targeted test scope does not explicitly include a resume-specific assertion despite planned `resume.ts` changes. Suggested improvement: include `resume-segment-frontier.test.ts` (or equivalent scenario) in Step 1 targeted validation.

### Missing Items
- None blocking for Step 1 outcomes.

### Suggestions
- Consider explicitly checking `/orch-status` wave display formatting in verification notes, since it renders `currentWaveIndex/totalWaves` from batch state and is operator-visible.
