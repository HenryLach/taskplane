## Plan Review: Step 1: `completion-authority.ts` — one predicate

### Verdict: APPROVE

### Summary
The plan covers the required centralized predicate, preserves aggregate blocker reporting and non-final-segment semantics, and gives the lane-runner enough raw gate information to retain its existing diagnostics and alerts. The optional working-tree drift callback is a reasonable compatibility extension to the prompt's baseline context because the current authoritative finalize path already fails closed on dirty source state, and the targeted tests include the relevant existing regression suites.

### Issues Found
None.

### Missing Items
- None.

### Suggestions
- When replacing the early post-loop hold check, preserve its current hold-specific precedence: inspect only `hold` blockers there (or otherwise avoid treating a review/ratification blocker as “Held — budget exhausted”). Leave review/ratification blockers for the later finalize-refusal path so the stated no-behaviour-change guarantee, alert kind, and `review_gate_refusal` diagnostic remain intact.
- Keep the default-clean `workingTreeDrift` behavior limited to callers that genuinely cannot supply a worktree probe; the live lane-runner finalize call should continue supplying the existing fail-closed probe exactly as planned.
