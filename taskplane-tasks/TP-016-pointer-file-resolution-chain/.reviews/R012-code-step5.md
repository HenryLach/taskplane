## Code Review: Step 5: Testing & Verification

### Verdict: REVISE

### Summary
The Step 5 changes do run cleanly (`cd extensions && npx vitest run` → 609/609 passing), but the newly added tests do not actually validate the core resume/state-root behavioral invariant they claim to cover. The current assertions are mostly shape/signature checks and path-construction checks, so a real regression in orch vs orch-resume state rooting could still pass.

### Issues Found
1. **[extensions/tests/workspace-config.test.ts:1570] [important]** — Test `7.11` is labeled as a behavioral state-root consistency check, but it only exercises `batchStatePath()` with string inputs. This does not verify that `/orch` and `/orch-resume` both *use* `workspaceRoot` at runtime for load/persist/delete/merge state operations. **Fix:** add a runtime-oriented test that invokes orch and resume flows (or mocks persistence/merge boundaries) with distinct `repoRoot` vs `workspaceRoot` and asserts state files are read/written under `<workspaceRoot>/.pi` in both paths.
2. **[extensions/tests/workspace-config.test.ts:1596] [important]** — Test `7.12` checks `resumeOrchBatch` existence and `length >= 5`, which is too weak to protect the threaded `workspaceRoot` contract. Function length/signature checks can pass even if `workspaceRoot` is ignored internally. **Fix:** assert observable behavior (e.g., `loadBatchState`, `persistRuntimeState`, `deleteBatchState`, and `mergeWaveByRepo` are called with the workspace-root-derived state root when `workspaceRoot` is provided).

### Pattern Violations
- “Behavioral” test labels currently do not match test implementation style in 7.11/7.12 (helper/signature inspection instead of behavior verification).

### Test Gaps
- Missing explicit orch vs orch-resume parity test with `repoRoot !== workspaceRoot` to prove consistent batch-state rooting.
- No regression test proving resume reads existing batch state from `<workspaceRoot>/.pi/batch-state.json` when repo-root `.pi` differs.

### Suggestions
- Keep 7.11 as a small helper contract test if desired, but add one focused integration-style assertion for actual runtime state-root usage.
- Prefer assertions on effects/IO paths over source/signature structure for this invariant.
