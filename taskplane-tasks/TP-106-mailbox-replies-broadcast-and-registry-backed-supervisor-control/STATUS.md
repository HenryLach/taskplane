# TP-106: Mailbox Replies, Broadcast, and Registry-Backed Supervisor Control — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-30
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Review current mailbox implementation and identify which assumptions are session/TMUX-specific rather than agent-ID/registry-based
- [ ] Trace the current supervisor tools (`send_agent_message`, `list_active_agents`, `read_agent_status`) and outline the Runtime V2 source of truth for each

---

### Step 1: Registry-Backed Supervisor Tools
**Status:** ⬜ Not Started

- [ ] Rework supervisor-facing agent tools to validate and resolve against the runtime registry instead of TMUX
- [ ] Preserve familiar agent IDs while severing the assumption that they are terminal/session names
- [ ] Ensure delivery and liveness errors are surfaced from registry/runtime state, not terminal state

---

### Step 2: Agent Replies, Broadcast, and Rate Limiting
**Status:** ⬜ Not Started

- [ ] Implement agent→supervisor replies/escalations on the new runtime flow
- [ ] Implement broadcast and per-agent rate limiting on top of the mailbox model
- [ ] Keep auditability intact for sent, delivered, replied, and rate-limited messages

---

### Step 3: Bridge Contact Tools
**Status:** ⬜ Not Started

- [ ] Add minimal agent-side bridge/contact tools for reply/escalate flows where generic file writes would be brittle
- [ ] Document how these tools fit with future review and segment-expansion bridge work

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Add or update behavioral tests for registry-backed tool behavior, reply flow, broadcast, and rate limiting
- [ ] Run the full suite
- [ ] Fix all failures

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update mailbox and command docs for the new Runtime V2 control model
- [ ] Log discoveries in STATUS.md

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
| 2026-03-30 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
