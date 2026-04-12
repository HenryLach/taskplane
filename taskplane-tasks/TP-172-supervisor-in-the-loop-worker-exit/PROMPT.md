# Task: TP-172 - Supervisor-in-the-Loop Worker Exit Interception

**Created:** 2026-04-12
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** High-risk change to worker lifecycle — modifies how agent sessions terminate, adds IPC between lane-runner and supervisor. Incorrect implementation could break all worker spawning or cause infinite loops.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 2, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-172-supervisor-in-the-loop-worker-exit/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Implement supervisor-in-the-loop interception of premature worker exits. When a worker agent produces a text-only response (triggering `agent_end`) without having made visible progress (no checkbox updates, no blocker logged), the lane-runner should escalate to the supervisor instead of closing the session. The supervisor reads the worker's exit message, diagnoses the situation, and sends targeted instructions back. The lane-runner injects these instructions as a new prompt to the still-alive worker process, preserving its full conversation context.

**Why this matters:** Workers on complex tasks repeatedly read code and exit with code 0 after 7-37 tool calls without making any edits. Each fresh iteration loses the analysis context and repeats the same pattern, triggering the stall detector after 3 iterations. This wastes ~$5+ per failure and blocks dependent tasks.

**Architecture:**

```
Worker produces text-only response (no tool calls)
    ↓
agent-host receives agent_end, captures last assistant message
    ↓ (does NOT close stdin yet)
agent-host calls onPrematureExit callback with assistant message text
    ↓
lane-runner checks: any checkbox progress since iteration started?
    ↓ (no progress)
lane-runner escalates to supervisor via IPC message:
  "Worker on lane N wants to exit with no progress.
   Worker said: '<last assistant message>'
   Current step: Step 2, checkbox: 'Fix engine .DONE removal path'"
    ↓
Supervisor reads worker's message, sends back targeted instructions
    ↓
lane-runner receives supervisor reply, sends as new prompt via stdin
    ↓
Worker continues with full conversation context + supervisor guidance
```

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `templates/agents/task-worker.md` — current worker prompt with exit contract
- `extensions/taskplane/supervisor-primer.md` — supervisor recovery playbooks (Section 13a-13b)

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/agent-host.ts`
- `extensions/taskplane/lane-runner.ts`
- `extensions/taskplane/supervisor.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/agent-host*.test.ts`
- `extensions/tests/lane-runner*.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read `agent-host.ts` — understand the `agent_end` → `closeStdin()` flow and how `spawnAgent` returns
- [ ] Read `lane-runner.ts` — understand the iteration loop, progress checking, and how the worker prompt is constructed
- [ ] Read `supervisor.ts` — understand the existing alert/message IPC system (how alerts are sent to and replies received from the supervisor)
- [ ] Read existing steering message delivery in `agent-host.ts` (line ~401) — the mailbox inbox polling that sends `{ type: "steer" }` messages to the worker's stdin
- [ ] Verify that pi's RPC mode supports sending a new `{ type: "prompt" }` message after `agent_end` to restart the agent's turn (check if the agent process stays alive and responsive after `agent_end` as long as stdin is not closed)
- [ ] Document findings in STATUS.md

### Step 1: Add Exit Interception to agent-host

- [ ] Add `onPrematureExit` callback option to `AgentHostOptions` — called when `agent_end` fires, receives the last assistant message text, returns a `Promise<string | null>` (string = new prompt to send, null = close session normally)
- [ ] In the `agent_end` handler: if `onPrematureExit` is provided, capture the last `assistant_message` text, call the callback, and either send a new `{ type: "prompt" }` message via stdin (if callback returns a string) or call `closeStdin()` (if null)
- [ ] Add a `maxExitInterceptions` option (default: 2) to prevent infinite loops — after N interceptions, close the session regardless
- [ ] Add an interception counter to track how many times the session has been intercepted
- [ ] Ensure telemetry events are emitted for interceptions: `exit_intercepted` event with the assistant message and whether supervisor was consulted
- [ ] Run targeted tests: `tests/agent-host*.test.ts`

**Artifacts:**
- `extensions/taskplane/agent-host.ts` (modified)
- `extensions/taskplane/types.ts` (modified if new types needed)

### Step 2: Add Supervisor Escalation to lane-runner

- [ ] After each worker exit with no checkbox progress: check if the worker session is still alive (stdin not closed) via the new interception mechanism
- [ ] If interception is available: compose an escalation message with the worker's last assistant text, current step info, and unchecked checkbox text
- [ ] Send the escalation to the supervisor via the existing IPC message system (write to supervisor inbox, read reply from outbox)
- [ ] Set a timeout for supervisor response (default: 60 seconds) — if supervisor doesn't respond in time, fall back to the corrective re-spawn prompt (already implemented)
- [ ] When supervisor reply arrives: pass it as the new prompt to the worker via the `onPrematureExit` callback return value
- [ ] If supervisor says to let the worker exit (e.g., replies with "skip" or "let it fail"): return null from the callback, session closes normally
- [ ] Run targeted tests: `tests/lane-runner*.test.ts`

**Artifacts:**
- `extensions/taskplane/lane-runner.ts` (modified)

### Step 3: Add Escalation Handler to Supervisor

- [ ] Add a new alert category `worker-exit-intercept` to the supervisor event system
- [ ] The alert should contain: lane number, task ID, current step, unchecked checkbox text, worker's last assistant message (truncated to ~500 chars), iteration count, and noProgressCount
- [ ] Add handling in `supervisor.ts` for this alert type — format it as a structured message the supervisor agent can act on
- [ ] The supervisor's response should be delivered back to the lane-runner via the reply mechanism
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (modified)

### Step 4: Testing & Verification

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures
- [ ] Add test: agent-host with `onPrematureExit` callback — verify stdin stays open, new prompt is sent
- [ ] Add test: agent-host with `maxExitInterceptions` — verify session closes after limit
- [ ] Add test: lane-runner escalation to supervisor — verify message format and timeout fallback
- [ ] Add test: end-to-end flow — worker exits, supervisor responds, worker continues

### Step 5: Documentation & Delivery

- [ ] Update `templates/agents/task-worker.md` if any prompt changes needed
- [ ] Update `extensions/taskplane/supervisor-primer.md` — add section on worker exit interception alerts
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `extensions/taskplane/supervisor-primer.md` — new alert category and response protocol

**Check If Affected:**
- `docs/explanation/execution-model.md` — worker lifecycle description
- `docs/explanation/architecture.md` — supervisor capabilities

## Completion Criteria

- [ ] All steps complete
- [ ] Worker exits without progress are intercepted and escalated to supervisor
- [ ] Supervisor can send targeted instructions that continue the worker's session
- [ ] Session closes normally after `maxExitInterceptions` to prevent infinite loops
- [ ] Fallback to corrective re-spawn prompt if supervisor doesn't respond within timeout
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `feat(TP-172): complete Step N — description`
- **Bug fixes:** `fix(TP-172): description`
- **Tests:** `test(TP-172): description`
- **Hydration:** `hydrate: TP-172 expand Step N checkboxes`

## Do NOT

- Change the normal worker exit flow (workers that check boxes and complete steps should be unaffected)
- Remove the existing stall detector — it remains as a safety net for workers that are truly stuck
- Send the full worker conversation to the supervisor (only the last assistant message, truncated)
- Allow infinite interceptions — `maxExitInterceptions` must be enforced
- Modify the pi RPC protocol — work within existing `prompt` and `steer` message types
- Skip tests
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

