## Plan Review: Step 1: Create Orch Branch at Batch Start

### Verdict: REVISE

### Summary
The Step 1 checklist captures the core intent (create/store/log/fail on branch creation), but it is still underspecified in two places that matter for correctness and recoverability. In particular, it does not lock in the naming contract/source for `opId`, and it does not define concrete failure-state behavior for branch-creation errors. Add those outcomes plus explicit Step 1 test intent before implementation.

### Issues Found
1. **[Severity: important]** — `taskplane-tasks/TP-022-orch-branch-lifecycle-merge-redirect/STATUS.md:33-36` does not explicitly encode the required branch naming contract `orch/{opId}-{batchId}` from the prompt (`PROMPT.md:72-74`) or how `opId` is derived. Without this, implementation can drift from the established sanitized operator-id path used elsewhere (`extensions/taskplane/engine.ts` imports `resolveOperatorId`; `extensions/taskplane/naming.ts:57-88`). **Fix:** add a Step 1 checklist item that explicitly says to derive `opId` via `resolveOperatorId(orchConfig)` and create `orch/${opId}-${batchId}` via `runGit()` in `repoRoot`.
2. **[Severity: important]** — `taskplane-tasks/TP-022-orch-branch-lifecycle-merge-redirect/STATUS.md:35` says “Handle creation failure” but does not define expected batch-state outcome. Existing planning failures in `extensions/taskplane/engine.ts:66-71` and `96-100` set `phase`, `endedAt`, append `errors`, notify, and return; Step 1 should commit to the same behavior for `git branch` failure (e.g., already exists). **Fix:** add explicit failure semantics to the plan so behavior is deterministic and resumability-safe.
3. **[Severity: important]** — Step 1 has no explicit test-coverage intent tied to its new behavior (success path + branch-exists failure), even though prompt Step 5 requires edge-case verification (`PROMPT.md:131`). **Fix:** add Step 1 test intent (or Step 5 mapping) for: successful branch creation, clear failure when branch already exists, and `batchState.orchBranch` populated before the first persisted runtime state.

### Missing Items
- Explicit `orch/{opId}-{batchId}` naming outcome with `resolveOperatorId()` source.
- Explicit failure-state contract for branch-creation errors (phase/error/notify/return).
- Concrete Step 1 test scenarios for success + collision/failure path.

### Suggestions
- Minor housekeeping: `STATUS.md` execution log still has duplicate Step 0/Step 1 rows (`STATUS.md:144-146`); cleaning this keeps review history easier to audit.
