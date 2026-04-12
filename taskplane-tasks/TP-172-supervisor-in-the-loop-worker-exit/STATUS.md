# TP-172: Supervisor-in-the-Loop Worker Exit Interception — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-12
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read agent-host.ts — `agent_end` → `closeStdin()` flow
- [ ] Read lane-runner.ts — iteration loop and progress checking
- [ ] Read supervisor.ts — existing alert/message IPC system
- [ ] Read steering message delivery in agent-host.ts (mailbox polling)
- [ ] Verify pi RPC supports new prompt after agent_end (stdin still open)
- [ ] Document findings

---

### Step 1: Add Exit Interception to agent-host
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on RPC protocol findings in Step 0

- [ ] Add `onPrematureExit` callback to AgentHostOptions
- [ ] Intercept agent_end: capture assistant message, call callback
- [ ] Add `maxExitInterceptions` safety limit (default: 2)
- [ ] Emit `exit_intercepted` telemetry event
- [ ] Run targeted tests

---

### Step 2: Add Supervisor Escalation to lane-runner
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on Step 1 implementation

- [ ] Compose escalation message with worker context
- [ ] Send to supervisor via IPC, await reply with timeout
- [ ] Pass supervisor instructions as new worker prompt
- [ ] Fallback to corrective re-spawn if supervisor doesn't respond
- [ ] Run targeted tests

---

### Step 3: Add Escalation Handler to Supervisor
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on Steps 1-2 implementation

- [ ] Add `worker-exit-intercept` alert category
- [ ] Format structured escalation message
- [ ] Wire reply delivery back to lane-runner
- [ ] Run targeted tests

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite passing
- [ ] Test: agent-host interception callback
- [ ] Test: maxExitInterceptions enforcement
- [ ] Test: lane-runner supervisor escalation + timeout fallback
- [ ] Test: end-to-end interception flow
- [ ] All failures fixed

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update supervisor-primer.md with new alert category
- [ ] Check execution-model.md and architecture.md
- [ ] Discoveries logged

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
| 2026-04-12 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

This task addresses the root cause of TP-165's repeated failures: workers exit
with code 0 after reading code without making edits, losing their analysis
context on each re-spawn. The supervisor-in-the-loop design preserves the
worker's conversation context and provides targeted guidance from the supervisor.
