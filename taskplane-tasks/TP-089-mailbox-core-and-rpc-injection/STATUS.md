# TP-089: Agent Mailbox Core and RPC Steering Injection — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-28
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read the agent-mailbox-steering spec (Architecture + Delivery sections)
- [ ] Read current rpc-wrapper handleEvent/message_end flow
- [ ] Read spawnAgentTmux() in task-runner.ts and spawnMergeAgent() in merge.ts
- [ ] Read existing supervisor tool registration pattern (orch_retry_task)

---

### Step 1: Mailbox message format and write utilities
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on spec message format and safety invariants

- [ ] Define message types and format in types.ts
- [ ] Implement write/read/ack utilities with atomic operations
- [ ] 4KB content limit enforced at write time

---

### Step 2: rpc-wrapper mailbox check and steer injection
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on rpc-wrapper handleEvent structure

- [ ] Add --mailbox-dir arg and inbox check on message_end
- [ ] Inject via steer RPC command
- [ ] Move delivered messages to ack/

---

### Step 3: Thread mailbox-dir through spawn paths
**Status:** ⬜ Not Started

- [ ] spawnAgentTmux() passes --mailbox-dir for worker + reviewer
- [ ] spawnMergeAgent() passes --mailbox-dir for merger
- [ ] Fix ORCH_BATCH_ID env var gap

---

### Step 4: Supervisor send_agent_message tool
**Status:** ⬜ Not Started

- [ ] Register tool with session name resolution from batch state
- [ ] Write message to target inbox

---

### Step 5: Batch cleanup for mailbox directory
**Status:** ⬜ Not Started

- [ ] Add mailbox/ to post-batch and age-based cleanup

---

### Step 6: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Create mailbox.test.ts with behavioral tests
- [ ] Full test suite passing
- [ ] All failures fixed

---

### Step 7: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update spec status
- [ ] Log discoveries

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-28 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
