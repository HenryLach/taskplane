# Task: TP-089 - Agent Mailbox Core and RPC Steering Injection

**Created:** 2026-03-28
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Introduces cross-process messaging infrastructure touching rpc-wrapper (shipped binary), task-runner spawn paths, merge.ts spawn paths, and supervisor tools. High blast radius across coordination layer.
**Score:** 6/8 — Blast radius: 3, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-089-mailbox-core-and-rpc-injection/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Implement the core agent mailbox system (Phase 1 of the agent-mailbox-steering spec). The supervisor writes message files to a batch-scoped inbox; rpc-wrapper checks the inbox on every `message_end` event and injects messages into the agent's LLM context via pi's `steer` RPC command. This enables the supervisor to course-correct any running agent (worker, reviewer, merger) without blocking or interrupting it.

## Dependencies

- **None** (builds on existing rpc-wrapper and spawn infrastructure)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/agent-mailbox-steering.md` — full spec (read the Architecture, Delivery, and Safety sections)
- `bin/rpc-wrapper.mjs` — current rpc-wrapper implementation (handleEvent, message_end handler)
- `extensions/task-runner.ts` — `spawnAgentTmux()` function (passes args to rpc-wrapper)
- `extensions/taskplane/merge.ts` — `spawnMergeAgent()` function (constructs rpc-wrapper command)
- `extensions/taskplane/supervisor.ts` — existing supervisor tool registration pattern (orch_retry_task, orch_skip_task)

## Environment

- **Workspace:** `bin/`, `extensions/taskplane/`, `extensions/task-runner.ts`
- **Services required:** None

## File Scope

- `bin/rpc-wrapper.mjs`
- `extensions/task-runner.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/supervisor.ts`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/cleanup.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/rpc-wrapper.test.ts`
- `extensions/tests/mailbox.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read the agent-mailbox-steering spec (Architecture + Delivery sections)
- [ ] Read current rpc-wrapper handleEvent/message_end flow
- [ ] Read spawnAgentTmux() in task-runner.ts and spawnMergeAgent() in merge.ts
- [ ] Read existing supervisor tool registration pattern (orch_retry_task)

### Step 1: Mailbox message format and write utilities

- [ ] Define message types and format in types.ts (MailboxMessage interface, message types enum)
- [ ] Implement `writeMailboxMessage(stateRoot, batchId, to, message)` utility
- [ ] Atomic write: temp file + rename into inbox directory
- [ ] 4KB content size limit enforced at write time
- [ ] Implement `readInbox(mailboxDir)` — reads, sorts by timestamp, validates batchId
- [ ] Implement `ackMessage(mailboxDir, filename)` — atomic rename inbox→ack

**Artifacts:**
- `extensions/taskplane/types.ts` (modified — message types)
- `extensions/taskplane/supervisor.ts` or new `extensions/taskplane/mailbox.ts` (utilities)

### Step 2: rpc-wrapper mailbox check and steer injection

- [ ] Add `--mailbox-dir` CLI arg to rpc-wrapper argument parser
- [ ] On session startup: send `{"type": "set_steering_mode", "mode": "all"}` to pi
- [ ] In `handleEvent` on `message_end`: check `{mailboxDir}/inbox/` via readdirSync
- [ ] Also check `{mailboxDir}/../../_broadcast/inbox/` for broadcast messages
- [ ] Read, validate (batchId match), inject via `{"type": "steer", "message": content}`
- [ ] Move delivered messages from inbox/ to ack/ via rename
- [ ] Log to stderr: `[STEERING] Delivered message {id}`
- [ ] Skip silently when `--mailbox-dir` is not provided (backward compatible)

**Artifacts:**
- `bin/rpc-wrapper.mjs` (modified)

### Step 3: Thread mailbox-dir through spawn paths

- [ ] task-runner `spawnAgentTmux()`: construct mailbox dir from stateRoot + batchId + sessionName, pass `--mailbox-dir` to rpc-wrapper
- [ ] merge.ts `spawnMergeAgent()`: construct mailbox dir, pass `--mailbox-dir` to rpc-wrapper
- [ ] execution.ts `buildLaneEnvVars()`: pass `ORCH_BATCH_ID` env var (fix existing gap where batchId is never set on config.orchestrator)
- [ ] Ensure mailbox dir is created (mkdirSync recursive) before spawn

**Artifacts:**
- `extensions/task-runner.ts` (modified)
- `extensions/taskplane/merge.ts` (modified)
- `extensions/taskplane/execution.ts` (modified)

### Step 4: Supervisor send_agent_message tool

- [ ] Register `send_agent_message(to, content, type?)` supervisor tool
- [ ] Resolve session names from batch state (lane allocations)
- [ ] Validate target session exists in current batch
- [ ] Write message file to target agent's inbox using mailbox utilities
- [ ] Return confirmation with message ID and target session

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (modified)

### Step 5: Batch cleanup for mailbox directory

- [ ] Add `mailbox/{batchId}/` to post-batch artifact cleanup
- [ ] Add `mailbox/` to age-based sweep (same 7-day policy as telemetry)

**Artifacts:**
- `extensions/taskplane/cleanup.ts` (modified)

### Step 6: Testing & Verification

- [ ] Create `extensions/tests/mailbox.test.ts` with behavioral tests

> ZERO test failures allowed.

- [ ] Test: writeMailboxMessage creates correct file structure and format
- [ ] Test: readInbox returns sorted messages, skips non-.msg.json files
- [ ] Test: ackMessage moves file from inbox/ to ack/
- [ ] Test: 4KB size limit rejection
- [ ] Test: batchId validation rejects mismatched messages
- [ ] Test: rpc-wrapper integration — mailbox check on message_end injects steer command
- [ ] Test: rpc-wrapper skips silently when --mailbox-dir not provided
- [ ] Test: set_steering_mode "all" sent at startup when --mailbox-dir provided
- [ ] Test: send_agent_message supervisor tool writes to correct inbox
- [ ] Run full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 7: Documentation & Delivery

- [ ] Update agent-mailbox-steering.md spec status from Draft to Implemented (Phase 1)
- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/specifications/taskplane/agent-mailbox-steering.md` — mark Phase 1 as implemented

**Check If Affected:**
- `docs/reference/commands.md`
- `CHANGELOG.md`

## Completion Criteria

- [ ] Supervisor can send steering messages to any running agent (worker, reviewer, merger)
- [ ] rpc-wrapper checks inbox on every message_end and injects via steer RPC
- [ ] Messages are batch-scoped and session-scoped (no cross-contamination)
- [ ] Atomic write/read/ack lifecycle works correctly
- [ ] Backward compatible when --mailbox-dir is not provided
- [ ] Batch cleanup includes mailbox directory
- [ ] All tests pass

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-089): complete Step N — description`
- **Bug fixes:** `fix(TP-089): description`
- **Tests:** `test(TP-089): description`
- **Hydration:** `hydrate: TP-089 expand Step N checkboxes`

## Do NOT

- Implement STATUS.md annotation (Phase 2, TP-090)
- Implement agent→supervisor replies/outbox (Phase 3, TP-091)
- Implement broadcast support (Phase 4, TP-092)
- Implement dashboard mailbox panel (Phase 5, TP-093)
- Skip full-suite tests

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
