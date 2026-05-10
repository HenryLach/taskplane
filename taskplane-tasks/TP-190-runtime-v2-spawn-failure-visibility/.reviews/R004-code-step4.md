## Code Review: Step 4: Implement Part 3 — phase transition when all lanes spawn-fail

### Verdict: APPROVE

### Summary
The Step 4 change in `extensions/taskplane/engine.ts` correctly adds a post-wave guard that transitions the batch to `failed` when a wave has only `spawn_failure` task outcomes and no successes, then persists/alerts/breaks immediately. This directly addresses the operator-visibility gap described in TP-190 by preventing the batch from remaining in `executing` after all lanes in a wave are dead on spawn. I also re-ran the worker’s targeted suite for this step (`engine-runtime-v2-routing`, `tier0-watchdog`, `supervisor-recovery-flows`): 196/196 passed.

### Issues Found
1. None.

### Pattern Violations
- None observed.
- Quality-check pipeline note: no project-configured static-check commands were discoverable for this worktree (`.pi/taskplane-config.json` absent; root `package.json` has no `typecheck`/`lint`/`format:check` scripts), so no additional lint/typecheck/format-check commands were runnable under the declared-discovery rules.

### Test Gaps
- No blocking gaps for this step. A dedicated behavioral regression for all-lane spawn-failure phase behavior is still expected in Step 5 per task plan.

### Suggestions
- Optional hardening: consider asserting there are no non-failed lane outcomes (e.g., skipped-only lanes due pause races) before applying the all-lane spawn-failure phase transition, to keep the condition maximally aligned with “every lane failed to spawn.”
