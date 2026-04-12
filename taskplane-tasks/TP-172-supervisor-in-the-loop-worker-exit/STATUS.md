# TP-172: Supervisor-in-the-Loop Worker Exit Interception — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-12
**Review Level:** 2
**Review Counter:** 8
**Iteration:** 1
**Size:** L

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read agent-host.ts — `agent_end` → `closeStdin()` flow
- [x] Read lane-runner.ts — iteration loop and progress checking
- [x] Read supervisor.ts — existing alert/message IPC system
- [x] Read steering message delivery in agent-host.ts (mailbox polling)
- [x] Verify pi RPC supports new prompt after agent_end (stdin still open)
- [x] Document findings

---

### Step 1: Add Exit Interception to agent-host
**Status:** ✅ Complete

> RPC Protocol finding: `agent_end` keeps process alive. We intercept before `closeStdin()`,
> call async callback, then either send `{type:"prompt"}` or `closeStdin()`.
> Need to track last assistant message text from `message_end` events.

- [x] Add `onPrematureExit` callback and `maxExitInterceptions` to AgentHostOptions
- [x] Track last assistant message text in state accumulator (capture from message_end events)
- [x] Modify agent_end handler: if callback provided and under limit, call callback instead of closeStdin; send new prompt or close based on result
- [x] Emit `exit_intercepted` telemetry event with full payload: assistantMessage, interceptionCount, supervisorConsulted, action (reprompt|close)
- [x] Add async callback safety: bounded internal timeout + try/catch fallback to closeStdin with diagnostic telemetry
- [x] Run targeted tests (lane-runner-v2: 48/48, conversation-event-fidelity: 19/19, exit-classification: 46/46)

---

### Step 2: Add Supervisor Escalation to lane-runner
**Status:** ✅ Complete

> Step 1 provides `onPrematureExit: (assistantMessage: string) => Promise<string|null>` callback.
> Lane-runner implements this callback to: check progress, escalate to supervisor via alert,
> poll worker mailbox inbox for supervisor reply, and return the reply as new prompt.

- [x] Implement `onPrematureExit` callback in hostOpts: check checkbox progress, if no progress escalate to supervisor
- [x] Compose structured escalation alert with worker's last message, current step, unchecked checkboxes
- [x] Poll worker mailbox inbox for supervisor reply with 60s timeout, fallback to null (let corrective re-spawn handle it)
- [x] Interpret supervisor reply: instructional content → reprompt, close directives ("skip"/"let it fail") → return null
- [x] Run targeted tests (lane-runner-v2: 48/48 pass)

---

### Step 3: Add Escalation Handler to Supervisor
**Status:** ✅ Complete

> `worker-exit-intercept` category already added to types.ts in Step 2.
> Alert is fired by lane-runner; supervisor receives it via IPC.
> Supervisor replies via `send_agent_message` tool which writes to worker inbox.
> Lane-runner polls inbox for the reply. Wire is already complete.
> This step focuses on: supervisor-primer guidance + event tailer formatting.

- [x] Add `worker-exit-intercept` to supervisor event tailer significant events list (N/A — alerts go via IPC, not event tailer)
- [x] Add formatting for `worker-exit-intercept` alert in supervisor prompt/primer guidance (Section 13c added)
- [x] Run targeted tests (supervisor-alerts: 32/32, mailbox: 46/46)

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
| R001 | plan | 1 | REVISE | .reviews/R001-plan-step1.md |

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Pi RPC `agent_end` does NOT exit the process — it signals turn completion. Process stays alive waiting for new `{type:"prompt"}` or stdin close. `closeStdin()` uses a delayed setTimeout (100ms default) with `stdinClosed` flag. | Key design enabler — intercepting before `closeStdin()` lets us send new prompts | agent-host.ts:603-607, 320-329 |
| `onSupervisorAlert` callback is one-way (fire-and-forget). Supervisor→worker uses `writeMailboxMessage()` to worker inbox. | Need to poll worker mailbox inbox for supervisor reply during interception | engine-worker.ts:324-325, extension.ts:4128-4143 |
| Lane-runner already has `noProgressCount` tracking and corrective warning prompts. | Interception hooks into agent-host level, before iteration loop advances | lane-runner.ts:420-440 |
| `checkMailbox()` polls inbox during `message_end` events only. After `agent_end`, no more polling. Lane-runner polls independently. | Lane-runner polls inbox directly using `readInbox()` from mailbox.ts | agent-host.ts:407-410, mailbox.ts:193 |
| `extractAssistantText()` helper already exists for capturing assistant message content. | Reuse existing helper | agent-host.ts:70-82 |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-12 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-12 02:52 | Task started | Runtime V2 lane-runner execution |
| 2026-04-12 02:52 | Step 0 started | Preflight |

---

## Blockers

*None*

---

## Notes

This task addresses the root cause of TP-165's repeated failures: workers exit
with code 0 after reading code without making edits, losing their analysis
context on each re-spawn. The supervisor-in-the-loop design preserves the
worker's conversation context and provides targeted guidance from the supervisor.
| 2026-04-12 02:56 | Review R001 | plan Step 1: REVISE |
| 2026-04-12 02:57 | Review R002 | plan Step 1: APPROVE |
| 2026-04-12 03:02 | Review R003 | plan Step 2: REVISE |
| 2026-04-12 03:03 | Review R004 | plan Step 2: APPROVE |
| 2026-04-12 03:06 | Review R005 | plan Step 3: APPROVE |
| 2026-04-12 03:09 | Review R006 | code Step 1: REVISE |
| 2026-04-12 03:11 | Review R007 | code Step 1: APPROVE |
| 2026-04-12 03:15 | Review R008 | code Step 2: REVISE |
