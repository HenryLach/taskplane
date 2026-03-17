## Code Review: Step 3: Thread Through Orchestrator

### Verdict: REVISE

### Summary
Pointer threading is mostly in place for startup config loading and merge-agent prompt resolution, and the new tests cover much of that path. However, resume-mode merge/state rooting is still inconsistent with workspace-mode execution rooting, so Step 3’s state-path invariants are not reliably maintained across `/orch` vs `/orch-resume`. This can split runtime artifacts between different `.pi` roots.

### Issues Found
1. **[extensions/taskplane/resume.ts:510,893-904,1172-1183] [important]** — `resumeOrchBatch()` still roots resume state at `repoRoot` (`loadBatchState(repoRoot)`), and both resume merge calls explicitly pass `undefined` for `stateRoot`, forcing `mergeWaveByRepo()`/`mergeWave()` to write merge request/result artifacts under `<repoRoot>/.pi`. In contrast, fresh `/orch` execution uses `workspaceRoot` as `stateRoot` (`extensions/taskplane/engine.ts:54`, call site `extensions/taskplane/extension.ts:209-211`). This creates inconsistent state locations between initial run and resume in workspace mode. **Fix:** thread an explicit `stateRoot` (workspace root in workspace mode) into `resumeOrchBatch()` from `extension.ts`, and use it consistently for `loadBatchState`, `persistRuntimeState`, `mergeWaveByRepo`, and terminal `deleteBatchState`.
2. **[extensions/tests/workspace-config.test.ts:1592-1598] [important]** — Test 7.11 hard-codes `batchStatePath(repoRoot)` as the expected invariant, which bakes in the same inconsistent rooting instead of validating workspace-mode state-root behavior end-to-end. **Fix:** replace this source-level assertion with a behavior test that exercises workspace-mode `/orch` + `/orch-resume` state file continuity under `<workspaceRoot>/.pi`.

### Pattern Violations
- Several new checks in 7.x are source-text assertions (`readFileSync(...).includes(...)`) rather than behavioral assertions, which are brittle to harmless refactors and can miss runtime rooting regressions.

### Test Gaps
- No runtime test verifies that resume reads/writes the same state root used by initial workspace-mode execution.
- No merge test covers resume path with pointer + workspace mode to ensure merge request/result files stay in the intended state root while prompt path follows `agentRoot`.

### Suggestions
- Add a shared helper for orchestrator state root resolution (repo vs workspace) and use it in both engine and resume paths to avoid drift.
