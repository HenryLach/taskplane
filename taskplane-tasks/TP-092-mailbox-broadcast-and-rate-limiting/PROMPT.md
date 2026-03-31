# Task: TP-092 - Mailbox Broadcast and Rate Limiting

**Created:** 2026-03-28
**Size:** S

## Review Level: 2 (Plan and Code)

**Assessment:** Extends existing mailbox with broadcast directory support and rate limiter. Low risk, additive.
**Score:** 3/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-092-mailbox-broadcast-and-rate-limiting/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Implement broadcast messaging and rate limiting (Phase 4 of the agent-mailbox-steering spec). The supervisor can send a single message to all active agents via the `_broadcast` directory. Rate limiting prevents message flooding (max 1 message per agent per 30 seconds).

## Dependencies

- **Task:** TP-089 (mailbox core — rpc-wrapper already checks _broadcast/inbox/)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/agent-mailbox-steering.md` — Broadcast section
- `extensions/taskplane/supervisor.ts` — send_agent_message tool (from TP-089)

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/supervisor.ts`
- `extensions/tests/mailbox.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read TP-089 broadcast directory handling in rpc-wrapper
- [ ] Read send_agent_message tool implementation

### Step 1: Broadcast tool and rate limiting

- [ ] Register `broadcast_message(content, type?)` supervisor tool
- [ ] Writes to `_broadcast/inbox/` (all agents check this directory per TP-089)
- [ ] Rate limiter: track last send timestamp per target session
- [ ] Reject sends within 30-second window with clear error message
- [ ] Rate limiter applies to both send_agent_message and broadcast_message

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (modified)

### Step 2: Testing & Verification

- [ ] Test: broadcast_message writes to _broadcast/inbox/
- [ ] Test: rate limiter rejects sends within 30s window
- [ ] Test: rate limiter allows sends after 30s window
- [ ] Test: rate limiter tracks per-session (different sessions have independent limits)
- [ ] Run full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 3: Documentation & Delivery

- [ ] Update spec status for Phase 4
- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/specifications/taskplane/agent-mailbox-steering.md` — mark Phase 4 as implemented

**Check If Affected:**
- `docs/reference/commands.md`

## Completion Criteria

- [ ] Supervisor can broadcast to all agents with one tool call
- [ ] Rate limiting prevents message flooding
- [ ] All tests pass

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-092): complete Step N — description`
- **Bug fixes:** `fix(TP-092): description`
- **Tests:** `test(TP-092): description`
- **Hydration:** `hydrate: TP-092 expand Step N checkboxes`

## Do NOT

- Modify rpc-wrapper inbox/broadcast check (done in TP-089)
- Implement dashboard panel (TP-093)
- Skip full-suite tests

---

## Amendments (Added During Execution)

### 2026-03-31 — Runtime V2 re-scope amendment (supersedes legacy assumptions where conflicting)

Context update: core TP-092 capabilities were implemented during TP-106 Runtime V2 mailbox work. Treat TP-092 as a **policy/semantics hardening delta** and traceability closure.

#### Already delivered (do not re-implement)

- `broadcast_message(content, type?)` tool
- `_broadcast` mailbox writes and agent-host delivery checks
- Per-agent 30s rate limiting for direct and broadcast sends
- Registry-backed known-agent discovery

#### Remaining TP-092 mission (Runtime V2 delta)

1. **Broadcast delivery semantics:** represent delivery status per recipient deterministically (broadcast source + per-agent ack markers) to avoid ambiguous pending/delivered states.
2. **Rate-limit policy clarity:** codify and test all-or-none behavior for broadcasts when any recipient is rate-limited.
3. **Audit completeness:** ensure broadcast send + per-agent limit rejections are consistently written to mailbox audit events for dashboard/supervisor consumption.
4. **Docs parity:** align command docs/spec language to current runtime semantics (agent IDs, registry-first validation, legacy fallback behavior).

#### Revised context to read first (in addition to original)

- `extensions/taskplane/extension.ts` (`doBroadcastMessage`, `doSendAgentMessage`)
- `extensions/taskplane/agent-host.ts` (broadcast fan-out + per-agent ack marker behavior)
- `extensions/taskplane/mailbox.ts` (audit events)
- `docs/specifications/framework/taskplane-runtime-v2/03-bridge-and-mailbox.md`

#### Revised file scope priority

- `extensions/taskplane/extension.ts`
- `extensions/taskplane/agent-host.ts`
- `extensions/taskplane/mailbox.ts`
- `extensions/tests/mailbox-v2.test.ts`
- `docs/reference/commands.md`

#### Acceptance addendum

- Broadcast rate-limit and delivery semantics are deterministic and operator-understandable.
- Audit trail is sufficient for downstream dashboard message-state derivation.
- No regressions to TP-106 mailbox/rate-limit behavior.
