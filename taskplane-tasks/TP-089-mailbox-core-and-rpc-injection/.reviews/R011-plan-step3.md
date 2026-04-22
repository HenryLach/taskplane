## Plan Review: Step 3 — Thread mailbox-dir through spawn paths

### Verdict: REVISE

### Summary
The Step 3 plan is close, but it still has two correctness gaps that can cause mailbox misrouting or non-functional mailbox checks. These should be fixed in the plan before implementation.

### Blocking findings

1. **[High] `ORCH_SIDECAR_DIR` is `.pi/`, not `stateRoot` — current wording risks building `.../.pi/.pi/mailbox/...` paths.**
   - In current code, lane env sets `ORCH_SIDECAR_DIR = join(workspaceRoot || repoRoot, ".pi")` (`extensions/taskplane/execution.ts`).
   - `sessionInboxDir(stateRoot, ...)` expects a root that **contains** `.pi`, not `.pi` itself (`extensions/taskplane/mailbox.ts`).
   - Plan item “use `ORCH_SIDECAR_DIR` as stateRoot” is therefore unsafe as written.
   - **Required plan correction:** either:
     - build mailbox path directly from sidecar dir: `join(getSidecarDir(), "mailbox", batchId, sessionName)`, or
     - if using mailbox helpers, pass `dirname(getSidecarDir())` as `stateRoot`.

2. **[High] Merge path must receive `batchId` explicitly; it cannot be derived from merge session name.**
   - Merge session names are like `orch-{opId}-merge-{N}` and do **not** encode batchId (`extensions/taskplane/merge.ts`).
   - The current plan says “extract batchId from session name or function parameter”; session-name extraction is not viable.
   - **Required plan correction:** add `batchId` as an explicit `spawnMergeAgent(...)` parameter and thread it from existing caller context (where `batchId` is already available in `mergeWaveByRepo`).

### Required completeness update

3. **Execution-side `ORCH_BATCH_ID` threading is still underspecified in the plan.**
   - PROMPT Step 3 requires `execution.ts` updates because `config.orchestrator?.batchId` is not a reliable source.
   - **Required plan correction:** explicitly define how batchId is propagated for lane/task-runner spawn paths (and how telemetry/mailbox path builders consume it), instead of relying on `config.orchestrator?.batchId`.

### Non-blocking recommendation

- Prefer deriving/passing mailbox dir once inside `spawnAgentTmux` (based on `sessionName`, `ORCH_BATCH_ID`, and sidecar root) rather than per-caller assembly, to avoid missing some tmux-spawned reviewer/worker variants.
