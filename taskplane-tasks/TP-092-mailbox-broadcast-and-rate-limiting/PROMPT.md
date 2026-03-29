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

<!-- Workers add amendments here if issues discovered during execution. -->
