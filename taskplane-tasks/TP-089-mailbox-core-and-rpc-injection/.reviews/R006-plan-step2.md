## Plan Review: Step 2 — rpc-wrapper mailbox check and steer injection

### Verdict: REVISE

### Summary
The Step 2 plan is close, but it still has a few correctness gaps that are important for Taskplane’s safety invariants (determinism + no misdelivery). Before implementation, tighten the plan around message validation, delivery ordering, and broadcast scope semantics.

### Blocking findings

1. **[High] Misdelivery validation is underspecified (`to` check missing).**
   Current Step 2c only calls out `batchId` validation. The plan must also require:
   - deriving `expectedSessionName` from `mailboxDir` (basename), and
   - validating `msg.to === expectedSessionName` for session inbox messages,
   - validating `msg.to === "_broadcast"` for broadcast inbox messages.

   Without this, a wrongly placed message file can still be injected.

2. **[High] Batch validation source is ambiguous (`from mailboxDir path or message`).**
   `expectedBatchId` must be derived from path structure (parent of session dir), not from message content. If message content is treated as source-of-truth, batch validation becomes circular and weak.

3. **[Medium] Delivery ordering is not deterministic yet.**
   Plan says `readdirSync` + iterate, but filesystem order is not deterministic. Add explicit sort requirements (timestamp asc, filename lexical tie-break) before injecting `steer` commands. Steering order can change agent behavior, so deterministic ordering is required.

4. **[Medium] Broadcast scope conflict must be resolved in-plan.**
   Step 2 asks rpc-wrapper to consume `_broadcast/inbox`, but task Do-NOT says broadcast support is Phase 4 (TP-092). If Step 2 consumes and acks broadcast files now, first reader can “steal” a broadcast message from other agents.

   The plan needs an explicit disposition before coding:
   - either defer broadcast consumption entirely to TP-092, or
   - explicitly document temporary semantics and avoid claiming full broadcast delivery guarantees in this task.

### Non-blocking suggestions

- Export small pure helpers for testability (e.g., message file filtering/parsing + delivery decision), not only one monolithic `checkMailboxAndSteer()`.
- Add explicit Step 2 test intent in plan text (even if full test implementation is in Step 6):
  - parseArgs includes `--mailbox-dir`
  - malformed/invalid messages are skipped without crash
  - ENOENT on ack rename is non-fatal
  - no mailbox dir => no-op behavior
