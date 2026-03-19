## Plan Review: Step 3: Integrate Cleanup into /orch-integrate

### Verdict: REVISE

### Summary
The Step 3 checklist captures the right high-level goals, but it is still too underspecified to guarantee the TP-029 outcomes in polyrepo mode. In particular, repo coverage, autostash targeting, and failure-path behavior are ambiguous relative to the current `/orch-integrate` flow in `extensions/taskplane/extension.ts`. Tightening those outcome-level requirements will reduce implementation drift and avoid silent cleanup regressions.

### Issues Found
1. **[Severity: important]** — `taskplane-tasks/TP-029-cleanup-resilience-and-gate/STATUS.md:65` says “Verify polyrepo acceptance criteria” but does not define repo scope. Current integrate logic only iterates repos where the orch branch exists (`extensions/taskplane/extension.ts:1200-1206`), which is narrower than roadmap 2d’s “any workspace repo” cleanup criteria. **Fix:** explicitly require verification across all registered workspace repos (or `repoRoot` in repo mode), not just `reposToIntegrate`.
2. **[Severity: important]** — `taskplane-tasks/TP-029-cleanup-resilience-and-gate/STATUS.md:64` does not define safe matching for “current batch” autostash cleanup. There are at least two batch-related stash patterns in code (`extensions/taskplane/extension.ts:337,382` and `extensions/taskplane/merge.ts:901`). **Fix:** add an explicit plan outcome for batch-scoped stash matching (drop only known taskplane stash messages for the resolved batch ID) and a fallback behavior when batch ID is unavailable.
3. **[Severity: important]** — `taskplane-tasks/TP-029-cleanup-resilience-and-gate/STATUS.md:66` (“Report cleanup status”) does not specify failure semantics/ordering with state deletion. Current code deletes batch state immediately after integration (`extensions/taskplane/extension.ts:1256-1257`), which can erase recovery context before acceptance checks run. **Fix:** require that acceptance verification runs before final state cleanup, and define how cleanup failures are surfaced (including `cleanup_post_merge_failed` attribution and repo-specific remediation output).

### Missing Items
- Step 3 test intent for `/orch-integrate` failure paths (e.g., stale lane branch/worktree/autostash remains in one repo while others pass).
- Explicit acceptance-check list mapped to code-level signals: worktree registry, `task/{opId}-lane-*` refs, `orch/{opId}-{batchId}` refs, autostash messages, and non-empty `.worktrees` containers.

### Suggestions
- Add a short “Step 3 done when” block (like Step 2) to lock outcomes before implementation.
- Prefer a small pure helper for cleanup diagnostics aggregation (per-repo findings) so reporting logic is deterministic and easy to unit test.
