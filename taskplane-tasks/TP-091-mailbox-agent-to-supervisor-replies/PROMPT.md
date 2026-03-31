# Task: TP-091 - Agent-to-Supervisor Mailbox Replies

**Created:** 2026-03-28
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds outbox write path for agents + engine outbox polling + supervisor read tool. Touches engine monitoring loop and supervisor tools.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 1, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-091-mailbox-agent-to-supervisor-replies/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Implement the agent→supervisor reply channel (Phase 3 of the agent-mailbox-steering spec). Agents write escalation/reply messages to their outbox directory. The engine's monitoring loop scans outbox directories and emits supervisor alerts (same IPC mechanism as TP-076). The supervisor receives alerts and can respond via `send_agent_message()`. Also register `read_agent_replies` supervisor tool.

## Dependencies

- **Task:** TP-089 (mailbox core — message format, directory structure, utilities)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/agent-mailbox-steering.md` — Agent→Supervisor section
- `extensions/taskplane/engine.ts` — monitoring loop, supervisor alert emission
- `extensions/taskplane/supervisor.ts` — alert handler, tool registration

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/engine.ts`
- `extensions/taskplane/supervisor.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/mailbox.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read engine monitoring loop (poll interval, lane state updates)
- [ ] Read TP-076 supervisor alert emission pattern (sendUserMessage)
- [ ] Read TP-089 mailbox utilities (message format, read/write)

### Step 1: Engine outbox polling

- [ ] Add outbox scan to engine monitoring loop (same poll interval as lane state)
- [ ] Scan `mailbox/{batchId}/{sessionName}/outbox/` for all active sessions
- [ ] When messages found, emit `supervisor-alert` IPC message with outbox content
- [ ] Move processed outbox messages to a `processed/` subdirectory (or delete)

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)

### Step 2: read_agent_replies supervisor tool

- [ ] Register `read_agent_replies(from?)` supervisor tool
- [ ] Reads outbox messages from specific agent or all agents
- [ ] Returns formatted message list with sender, type, content, timestamp
- [ ] Marks messages as read after retrieval

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (modified)

### Step 3: Testing & Verification

- [ ] Test: agent outbox write produces correct file in outbox/
- [ ] Test: engine monitoring loop detects outbox messages and emits alert
- [ ] Test: read_agent_replies returns correct messages
- [ ] Test: round-trip — supervisor sends, agent replies, supervisor reads
- [ ] Run full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Update spec status for Phase 3
- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/specifications/taskplane/agent-mailbox-steering.md` — mark Phase 3 as implemented

**Check If Affected:**
- `docs/reference/commands.md`

## Completion Criteria

- [ ] Agents can write outbox messages that reach the supervisor
- [ ] Engine emits alerts for outbox messages (same mechanism as TP-076)
- [ ] Supervisor can read agent replies via read_agent_replies tool
- [ ] All tests pass

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-091): complete Step N — description`
- **Bug fixes:** `fix(TP-091): description`
- **Tests:** `test(TP-091): description`
- **Hydration:** `hydrate: TP-091 expand Step N checkboxes`

## Do NOT

- Modify rpc-wrapper inbox check (done in TP-089)
- Implement broadcast (TP-092)
- Implement dashboard panel (TP-093)
- Skip full-suite tests

---

## Amendments (Added During Execution)

### 2026-03-31 — Runtime V2 re-scope amendment (supersedes legacy assumptions where conflicting)

Context update: substantial TP-091 scope was implemented under TP-106 (Runtime V2 mailbox rollout), but TP-091/092/093 status tracking remained not-started. Treat this task as a **delta-closure and traceability task**, not greenfield implementation.

#### Already delivered (do not re-implement)

- Outbox write/read/ack plumbing (`writeOutboxMessage`, `readOutbox`, `ackOutboxMessage`)
- Supervisor tool registration for `read_agent_replies`
- Runtime V2 lane-runner outbox polling + alert emission path
- Bridge tools for agent→supervisor messages

#### Remaining TP-091 mission (Runtime V2 delta)

1. **Reply lifecycle truth model:** `read_agent_replies` must support durable visibility over consumed replies (outbox + processed + mailbox audit/event stream) so messages do not disappear immediately after ack.
2. **Registry-first identity contract:** all targeting/discovery must use Runtime V2 registry-backed `agentId` identity; TMUX/session assumptions are legacy fallback only.
3. **Supervisor alert parity:** verify reply/escalation fanout is surfaced consistently to supervisor UX and dashboard inputs on Runtime V2 path.
4. **Tool semantics/docs parity:** ensure `read_agent_replies` behavior (read-only vs consume) is explicit and matches implementation.

#### Revised context to read first (in addition to original)

- `extensions/taskplane/extension.ts` (tool wiring and registry-backed discovery)
- `extensions/taskplane/lane-runner.ts` (outbox polling + alert fanout)
- `extensions/taskplane/mailbox.ts` (outbox/processed/audit semantics)
- `docs/specifications/framework/taskplane-runtime-v2/03-bridge-and-mailbox.md`

#### Revised file scope priority

- `extensions/taskplane/extension.ts`
- `extensions/taskplane/lane-runner.ts`
- `extensions/taskplane/mailbox.ts`
- `extensions/tests/mailbox-v2.test.ts`
- `extensions/tests/supervisor-alerts.test.ts`

#### Acceptance addendum

- `read_agent_replies` returns stable, non-lossy operator-visible history across normal ack flow.
- Reply/escalation alerts are visible in Runtime V2 supervisor surfaces without TMUX dependence.
- No regressions to TP-106 behavior/tests.
