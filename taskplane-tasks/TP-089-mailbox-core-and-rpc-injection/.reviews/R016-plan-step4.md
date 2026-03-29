## Plan Review: Step 4 — Supervisor `send_agent_message` tool

### Verdict: APPROVE

### Summary
This Step 4 plan is now implementation-ready and resolves the blocking issues from R015.

What is now solid:
- Tool registration shape is explicit (`send_agent_message(to, content, type?)`) and follows existing supervisor tool patterns.
- State-root resolution is aligned with established extension logic (`execCtx?.workspaceRoot ?? execCtx?.repoRoot ?? ctx.cwd`).
- Target validation is batch-scoped and explicit, with correct session derivation rules:
  - worker: `${lane.tmuxSessionName}-worker`
  - reviewer: `${lane.tmuxSessionName}-reviewer`
  - merger: `${tmuxPrefix}-${opId}-merge-${lane.laneNumber}`
- Outbound type validation is constrained to supervisor-appropriate values (`steer | query | abort | info`), avoiding invalid `reply`/`escalate` writes.
- Message write path correctly reuses `writeMailboxMessage(...)` and returns operator-auditable confirmation fields (message id, target, type, batchId).

No blocking plan gaps remain for Step 4.

### Non-blocking implementation note
When implementing merger target derivation, prefer a deterministic opId source from persisted batch context (rather than transient runtime env) to keep targeting stable across resume/takeover flows.
