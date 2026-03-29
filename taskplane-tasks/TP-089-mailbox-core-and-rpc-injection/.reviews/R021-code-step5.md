## Code Review — Step 5: Batch cleanup for mailbox directory

### Verdict: **REVISE**

### Summary
Step 5 implementation is close and the mailbox cleanup logic in `cleanup.ts` is generally correct (post-integrate delete + stale preflight sweep, non-fatal handling, counter propagation).

However, there is one functional gap that blocks approval: **post-integrate cleanup is still invoked with `repoRoot` instead of `workspaceRoot`**, so mailbox cleanup can miss the actual mailbox location in workspace mode.

---

### Blocking findings

1. **Post-integrate mailbox cleanup uses the wrong root in workspace mode**
   - **Where:**
     - `extensions/taskplane/extension.ts:2996` (`cleanupPostIntegrate(repoRoot, batchId)`) in manual `/orch-integrate`
     - `extensions/taskplane/extension.ts:1207` (`cleanupPostIntegrate(repoRoot, context.batchId)`) in supervisor auto-integration path
   - **Why this is a problem:**
     - Mailbox/sidecar artifacts are written under the orchestrator sidecar root, which is workspace-aware:
       - `extensions/taskplane/execution.ts:480` sets `ORCH_SIDECAR_DIR` to `join(workspaceRoot || repoRoot, ".pi")`
       - `extensions/task-runner.ts:1843` writes mailbox under `join(getSidecarDir(), "mailbox", orchBatchId, sessionName)`
       - `extensions/taskplane/merge.ts:664` writes mailbox under `join(sidecarRoot, "mailbox", batchId, sessionName)`
     - In workspace mode, `workspaceRoot` and `repoRoot` can differ; using `repoRoot` for cleanup can leave `.pi/mailbox/{batchId}` undeleted.
   - **Impact:** Step 5 acceptance criterion (batch mailbox cleanup) is not reliably met in workspace mode.
   - **Fix:** Use workspace/state root for post-integrate cleanup calls (same root used for sidecar/mailbox writes and batch state), not repo root.

---

### Non-blocking notes

- Nice improvements in `cleanup.ts`:
  - Counter propagation added (`mailboxDirsDeleted`, `staleDirsDeleted`)
  - Directory-safe stale sweep (`isDirectory`, recursive `rmSync`, non-fatal warnings)
  - User-facing formatting updated for mailbox cleanup visibility

- Validation run:
  - `cd extensions && npx vitest run` was attempted, but the repo’s current mixed harness setup reports many pre-existing `No test suite found`/`mock.module is not a function` failures unrelated to this step.
