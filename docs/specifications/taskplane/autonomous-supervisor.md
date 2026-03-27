# Autonomous Supervisor Specification

**Status:** Draft — triggering mechanism confirmed, ready for implementation
**Priority:** #1
**Created:** 2026-03-27
**Updated:** 2026-03-27

## Problem Statement

Taskplane's supervisor agent is reactive — it only acts when the user sends a message. Between messages, it's dormant. This means:

1. **Failures go undetected** until the user checks in and nudges the supervisor
2. **Recovery is manual** — the user must prompt the supervisor to investigate and fix issues
3. **Long-running batches cannot be unattended** — someone must watch and intervene

In every observed failure, the supervisor *was capable* of diagnosing and recovering the batch when prompted. The issue isn't intelligence — it's that the supervisor sleeps between user messages.

## Design Principles

1. **The supervisor must be a true autonomous agent** — it monitors, detects, and acts without human intervention
2. **Deterministic code handles known failure patterns** — the engine should programmatically recover from documented edge cases (`.DONE` race, stale sessions, transient errors)
3. **The supervisor handles novel/ambiguous situations** — when deterministic recovery can't resolve an issue, the supervisor LLM investigates and decides
4. **Feedback loop reduces incident frequency over time** — the supervisor creates GitHub issues for recurring failure patterns, driving deterministic fixes into the engine
5. **The user is informed, not required** — the supervisor notifies the user of incidents and actions taken, but doesn't block on user input

## Architecture

### Layer 1: Engine Deterministic Recovery

The engine (running in the forked child process) handles known failure patterns programmatically:

- **`.DONE` race condition** — ✅ Shipped in v0.21.3 (git branch check after grace period)
- **Worktree reset between tasks** — ✅ Shipped in v0.21.4 (git checkout/clean between sequential tasks on shared lanes)
- **Stale tmux sessions** — detect and kill orphaned sessions from prior runs
- **Transient spawn failures** — retry with backoff (already exists)
- **Merge conflicts** — automatic retry with fresh worktree (partially exists)
- **Context pressure** — wrap-up signal and kill (already exists)

These are deterministic, fast, and don't require LLM reasoning. New patterns are added as they're discovered via the feedback loop (Layer 3).

### Layer 2: Supervisor Autonomous Monitoring

The supervisor must act on events without waiting for user input.

#### Triggering Mechanism: `sendUserMessage` (CONFIRMED)

**Pi's extension API provides the solution.** Investigation of the pi-mono codebase (`packages/coding-agent/src/core/extensions/types.ts`) confirmed two methods available on `ExtensionContext`:

```typescript
// Inject a user message that triggers an LLM turn
sendUserMessage(
  content: string | (TextContent | ImageContent)[],
  options?: { deliverAs?: "steer" | "followUp" }
): void;

// Send a custom typed message, optionally triggering a turn
sendMessage(
  message: { customType, content, display, details },
  options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }
): void;
```

Key behaviors:
- `deliverAs: "followUp"` — waits for current LLM turn to finish before delivering
- `deliverAs: "steer"` — interrupts the current turn (for urgent situations)
- `triggerTurn: true` — forces an LLM turn even for custom messages
- Both methods are available on the `ExtensionContext` our extension already has

**No pi changes required. This is an existing, stable API.**

#### Event Flow

```
Engine (child process) detects unrecoverable situation
  → IPC message to main thread: { type: "supervisor-alert", ... }
    → Extension's IPC handler receives message
      → Calls ctx.sendUserMessage(alertText, { deliverAs: "followUp" })
        → Pi queues the message, delivers after current turn
          → Supervisor LLM receives the alert as a "user" message
            → Supervisor investigates using orch_status, reads logs, decides action
              → Supervisor acts: orch_resume, retry task, skip task, etc.
```

The supervisor sees the alert as a conversation message and responds naturally — using its tools (`orch_status`, `orch_resume`, `orch_pause`, `orch_abort`, `orch_integrate`, `orch_start`) to investigate and act.

#### Why Not Timer-Based Polling?

Considered and rejected. Timer-based polling (supervisor periodically calling `orch_status`) would:
- Burn LLM tokens on every poll cycle even when nothing is wrong
- Require pi to support self-scheduling (it doesn't)
- Be slower to react than event-driven (minimum poll interval vs instant)

The event-driven approach (engine pushes alerts) is more efficient and more responsive.

#### Comparison with Gastown's Approach

Gastown (`github.com/steveyegge/gastown`) solves the same problem with `gt nudge` — literally typing text into the agent's tmux session via `tmux send-keys`. Their `NudgeSession` function uses literal mode, debounce, ESC for vim mode, cross-process locking, and SIGWINCH to wake detached sessions.

This works but is fragile (terminal state, timing, escaping). Taskplane's supervisor runs as a pi extension in the same process — we have direct API access via `sendUserMessage`, which is cleaner and more reliable.

Gastown's relevant architectural patterns:
- **Event-driven, not polling** — Witness receives hooks (SubagentStop, TeammateIdle, TaskCompleted), doesn't poll
- **Crash loop prevention** — track respawn attempts per issue, escalate after 3 failures
- **Nudge queue** — file-based message queue with fsnotify watcher (we can use IPC instead)
- **Feedback to issue tracker** — Witness creates beads (issues) for recurring problems

### Layer 3: Feedback Loop

When the supervisor resolves an incident, it should:

1. **Log the incident** — what happened, what it did, outcome
2. **Classify the pattern** — is this a known type? Is it recurring?
3. **Create a GitHub issue** — if the pattern should be handled deterministically in Layer 1
4. **Tag the issue** — with severity, component, and reproduction steps

Over time, the feedback loop converts Layer 2 (LLM-handled) incidents into Layer 1 (deterministic) fixes. The supervisor should need to intervene less and less.

### Incident → Deterministic Fix Lifecycle

```
Incident occurs
  → Engine can't handle it (not in Layer 1)
    → Supervisor alerted via sendUserMessage
      → Supervisor investigates and recovers
        → Supervisor logs incident + creates GitHub issue
          → Developer implements deterministic fix in engine
            → Next occurrence handled by Layer 1 (no LLM needed)
```

## Alert Categories

### Category 1: Task Failure (engine sends alert)

```
⚠️ Task failure on lane-1: TP-003 (status-badge-component)
  Exit reason: TMUX session exited without .DONE (grace + branch check failed)
  Lane branch: task/henrylach-lane-1-20260327T...
  Worktree: .worktrees/tp-wt-1

  Batch state: wave 1, 2/3 tasks complete, 1 failed
  Failure policy: skip-dependents

  Available actions:
  - orch_status() to inspect current state
  - orch_resume(force=true) to retry
  - Read STATUS.md and lane logs for diagnosis
```

### Category 2: Merge Failure (engine sends alert)

```
⚠️ Merge failed for wave 1
  Lane 1 has mixed results (1 succeeded, 1 failed) — cannot merge partial branch
  Merge policy: pause on failure

  Available actions:
  - Investigate failed task, determine if work is salvageable
  - Force-resume to skip failed task and proceed
  - Abort batch if unrecoverable
```

### Category 3: Stall Detection (engine sends alert)

```
⚠️ Batch stalled: no progress for 15 minutes
  Lane 2, task TP-005: session alive but no tool calls in 15m
  Last activity: tool_execution_start (bash) at 14:32

  Available actions:
  - Check tmux session for errors
  - Kill and retry the stalled task
  - Skip and continue
```

### Category 4: Batch Complete (engine sends notification)

```
✅ Batch 20260327T... completed
  3/3 tasks succeeded, 1 wave, merged to orch branch

  Ready for integration. Run orch_integrate() or review first.
```

## Supervisor Response Protocol

When the supervisor receives an alert, it should:

1. **Acknowledge** — "I see the failure. Investigating."
2. **Diagnose** — Call `orch_status()`, read STATUS.md, check logs
3. **Decide** — Based on diagnosis, choose an action
4. **Act** — Execute the recovery (resume, retry, skip, abort)
5. **Report** — Tell the user what happened and what was done
6. **Learn** — If this is a pattern, create a GitHub issue for Layer 1 improvement

The supervisor should NOT ask the user for permission for routine recovery (retry, skip-dependents). It should only escalate for genuinely ambiguous situations (e.g., "this task has failed 3 times with different errors — should I keep trying or abort the batch?").

## Implementation Plan

### Phase 1: Engine → Supervisor Alerts (Next)

**Scope:** Engine sends alerts to supervisor via IPC → `sendUserMessage`.

1. Define alert message types in `engine-worker.ts` (new IPC message type: `supervisor-alert`)
2. Add alert emission points in engine code:
   - Task failure (after all deterministic recovery attempts exhausted)
   - Merge failure
   - Stall detection (no progress timeout)
   - Batch completion
3. Main thread handler in `extension.ts`: receive `supervisor-alert` IPC → call `ctx.sendUserMessage`
4. Update supervisor primer/template to expect and handle alerts
5. Test: force a task failure, verify supervisor receives alert and acts

### Phase 2: Supervisor Recovery Actions

**Scope:** Supervisor can fully recover from common failures.

1. Add `orch_retry_task` tool — retry a specific failed task
2. Add `orch_skip_task` tool — skip a task and unblock dependents
3. Add `orch_force_merge` tool — force merge a lane with mixed results
4. Supervisor template updated with recovery playbooks per alert category
5. Test: end-to-end unattended batch with injected failure → supervisor recovers

### Phase 3: Feedback Loop

**Scope:** Supervisor creates GitHub issues for recurring patterns.

1. Incident log format and storage (`.pi/incidents/`)
2. Supervisor creates GitHub issues via `gh` CLI when patterns recur
3. Issue template for "incident → deterministic fix" proposals
4. Metrics: incidents per batch, auto-recovered vs escalated

### Phase 4: Escalation and Autonomy Tuning

**Scope:** Configurable autonomy levels, escalation policies.

1. Autonomy levels: `full` (supervisor decides everything), `supervised` (asks before destructive actions), `notify-only` (alerts user, doesn't act)
2. Escalation policy: after N failed recovery attempts, notify user
3. Crash loop detection: if same task fails 3x, escalate instead of retrying
4. Token budget controls for supervisor reasoning

## Success Criteria

1. A batch with a recoverable failure completes without user intervention
2. The supervisor notifies the user of what happened and what it did
3. After N batches, recurring patterns are filed as issues and subsequently fixed in engine code
4. Incident rate per batch decreases measurably over time
5. User can leave a batch running overnight and find it completed (or cleanly failed with an incident report) in the morning
