## Code Review: Step 2: Baseline Capture & Comparison in Merge Flow

### Verdict: REVISE

### Summary
The baseline capture/diff flow is wired through `engine.ts`/`resume.ts` and the core TP-032 behavior is mostly in place. However, there are a few correctness gaps that can cause incorrect merge outcomes in edge cases, and one workspace-mode artifact issue that breaks the per-repo baseline contract. These should be fixed before approving Step 2.

### Issues Found
1. **[extensions/taskplane/merge.ts:846, extensions/taskplane/merge.ts:1439] [important]** — Baseline artifact naming is not repo-scoped in workspace mode, so per-repo baselines can overwrite each other.
   - `mergeWaveByRepo()` calls `mergeWave()` once per repo group, but `baselineFileName` is always `baseline-b${batchId}-w${waveIndex}.json`.
   - In a multi-repo wave, later repo groups overwrite earlier baseline snapshots in `.pi/verification/{opId}/`.
   - **Fix:** include a repo discriminator in artifact names (e.g., `...-repo-${repoIdOrDefault}...`) and thread repo identity into `mergeWave()` for deterministic naming.

2. **[extensions/taskplane/merge.ts:1032-1042, extensions/taskplane/merge.ts:1147-1151] [critical]** — New-failure rollback is fail-open: if `git reset --hard preLaneHead` fails (or `preLaneHead` is unavailable), the lane is marked failed but the bad merge commit can still be advanced to the target branch.
   - On `verification_new_failure`, reset failure is only logged; execution then falls through to `anySuccess` branch advancement logic.
   - Because lane `result.status` remains `SUCCESS`/`CONFLICT_RESOLVED`, `anySuccess` can be true even for a verification-blocked lane.
   - **Fix:** make rollback failure a hard stop that disables target-branch advancement; also exclude verification-blocked lanes from success accounting (or mark lane result as non-success for advancement logic).

3. **[extensions/taskplane/merge.ts:915] [important]** — `merge.verify` is silently disabled whenever baseline capture succeeds (`agentVerifyCommands = []`).
   - This changes merge semantics for projects that rely on `orchestrator.merge.verify` (e.g., build checks not represented in `testing.commands`).
   - It can allow regressions that were previously blocked.
   - **Fix:** keep `merge.verify` behavior explicit (config-gated), or preserve non-fingerprintable checks while using baseline diff only for fingerprinted test failures.

### Pattern Violations
- Behavior/documentation drift: code currently suppresses merge-agent verification under baseline mode, while Step notes describe two-layer verification with merge-agent verification still active.

### Test Gaps
- No tests cover workspace per-repo baseline artifact naming (collision/overwrite prevention).
- No tests assert fail-closed behavior when rollback fails after `verification_new_failure`.
- No tests cover `merge.verify` behavior when `testing_commands` is present (to prevent silent regression of merge checks).

### Suggestions
- Add focused unit/integration tests around `mergeWave()` advancement gating (`verification_new_failure`, rollback success/failure, and `anySuccess` computation).
- Add a small filename helper for verification artifacts to centralize repo-aware naming and avoid future drift.
