## Plan Review: Step 2: Audit and fix runtime fallbacks

### Verdict: APPROVE

### Summary
The Step 2 plan is aligned with the PROMPT requirements: it targets the right runtime files (`lane-runner.ts`, `agent-host.ts`, `task-runner.ts`, and `merge.ts`) and explicitly includes the core acceptance outcome that empty thinking should inherit session defaults. The scope is appropriately focused for this step, with detailed testing deferred to Step 4. I don’t see a blocking gap that would prevent successful implementation.

### Issues Found
1. **[Severity: minor]** — The `task-runner.ts` item is slightly broad/ambiguous as written (“/task path”). In practice, there are multiple spawn paths in that file (worker, reviewer, quality-gate reviewer, fix agent) plus the local `spawnAgent` arg builder that currently always appends `--thinking`. Make sure the audit explicitly covers all of those flows, not just the primary worker path.

### Missing Items
- None.

### Suggestions
- After changes, run a final grep sweep for both fallback patterns (`thinking || ...`) and unconditional `--thinking` argument construction to confirm no override path remains.
- In Step 4, include at least one verification for a non-worker path (e.g., reviewer or quality-gate flow) to ensure inherit semantics are consistent across all runtime spawns.