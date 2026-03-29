## Plan Review: Step 4 — Supervisor `send_agent_message` tool

### Verdict: REVISE

### Summary
The plan is close and the core flow is correct (register tool → resolve target session from batch state → write via mailbox utility → return message ID).

However, there are still a few **blocking specification gaps** that should be made explicit before implementation.

### Blocking findings

1. **Merge session-name derivation must be explicit (workspace-safe), not implied.**
   You currently say “build valid session names from lanes (worker/reviewer/merge),” but the merge naming rule differs from lane naming:
   - Lane session names may include repo in workspace mode (`waves.ts`: `"{prefix}-{opId}-{repoId}-lane-{N}"`, lines 508–512).
   - Merge session names do **not** include repo (`merge.ts`: `"{tmuxPrefix}-{opId}-merge-{laneNumber}"`, line 1428).

   So a naive transform from `lane.tmuxSessionName` can produce wrong merge targets in workspace mode.

   **Required plan correction:** define exact derivation rules:
   - worker: `${lane.tmuxSessionName}-worker`
   - reviewer: `${lane.tmuxSessionName}-reviewer`
   - merger: `${tmuxPrefix}-${opId}-merge-${lane.laneNumber}` (with deterministic `opId` extraction from current batch context)
   - lane-level session itself is not a valid steering target.

2. **`type` parameter needs runtime validation (not raw string passthrough).**
   The plan currently uses `type?: string` with default `"steer"`.

   But `writeMailboxMessage()` validates size, not message-type runtime correctness (`mailbox.ts` lines 108–140), and `MailboxMessageType` includes values not appropriate for supervisor outbound traffic (`types.ts` lines 3391–3399).

   **Required plan correction:** constrain/validate `type` in the tool handler (or parameter schema) before write. Recommended outbound allowlist: `steer | query | abort | info` (default `steer`). Invalid type should return a clear error, not write a silently undeliverable message.

3. **State root resolution should follow established extension pattern.**
   “Derive stateRoot from batch state” is underspecified and likely wrong. Batch state gives `batchId`, but not the filesystem root to load/save from.

   **Required plan correction:** explicitly use the same root-resolution pattern as existing supervisor tools:
   `execCtx?.workspaceRoot ?? execCtx?.repoRoot ?? ctx.cwd` (see `doOrchRetryTask`, extension.ts line 2359), then `loadBatchState(stateRoot)`.

### Non-blocking notes

- Include `type` and `batchId` in the success confirmation string (in addition to message ID + target) for easier operator audit.
- Consider adding `send_agent_message(...)` to the supervisor prompt’s “Available Orchestrator Tools” section for discoverability (currently that section lists only orch_* tools).
