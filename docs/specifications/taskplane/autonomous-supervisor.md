# Autonomous Supervisor Specification

**Status:** Draft
**Priority:** #1
**Created:** 2026-03-27

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

- **`.DONE` race condition** — ✅ Shipped in v0.21.3 (git branch check)
- **Stale tmux sessions** — detect and kill orphaned sessions from prior runs
- **Transient spawn failures** — retry with backoff (already exists)
- **Merge conflicts** — automatic retry with fresh worktree (partially exists)
- **Context pressure** — wrap-up signal and kill (already exists)

These are deterministic, fast, and don't require LLM reasoning. New patterns are added as they're discovered.

### Layer 2: Supervisor Autonomous Monitoring

The supervisor must have a **background monitoring loop** that runs independently of user interaction:

#### Option A: Engine-Driven Supervisor Triggers

The engine (Layer 1) detects situations it can't handle deterministically and sends a structured event to the supervisor:

```
{ type: "supervisor-intervention-needed",
  reason: "merge_failed_unknown",
  context: { waveIndex: 1, laneId: "lane-1", error: "..." },
  suggestedActions: ["investigate merge log", "retry merge", "skip task"] }
```

The supervisor receives this event and acts autonomously — no user message required.

**Pros:** Engine controls when LLM reasoning is needed. Efficient — supervisor only wakes for real issues.
**Cons:** Requires a mechanism for the engine to trigger supervisor action.

#### Option B: Supervisor Polling Loop

The supervisor has a timer-based loop that periodically:
1. Calls `orch_status()` to check batch state
2. Reads the events file for errors/warnings
3. Takes action if issues are detected

**Pros:** Simple conceptually. Supervisor is always watching.
**Cons:** Requires pi to support timer-based self-prompting (not currently available). Burns LLM tokens on polling even when nothing is wrong.

#### Option C: Hybrid — Engine Events + Supervisor Watchdog

The engine handles known patterns (Layer 1) and emits events for everything else. A lightweight watchdog (not LLM-based) monitors for:
- Batch stalled (no progress for N minutes)
- Unexpected engine process death
- Wave transition failures

When the watchdog detects an issue, it triggers the supervisor via a mechanism TBD (synthetic user message, tool invocation, or pi extension event).

**Pros:** Efficient — LLM only engaged when needed. Engine handles the fast path.
**Cons:** More complex. Requires a triggering mechanism.

### Recommended: Option C (Hybrid)

The hybrid approach matches how production systems work:
- Automated recovery for known issues (Layer 1)
- Monitoring infrastructure for detection (watchdog)
- Human-level reasoning for novel issues (supervisor LLM)

### Layer 3: Feedback Loop

When the supervisor resolves an incident, it should:

1. **Log the incident** — what happened, what it did, outcome
2. **Classify the pattern** — is this a known type? Is it recurring?
3. **Create a GitHub issue** — if the pattern should be handled deterministically in Layer 1
4. **Tag the issue** — with severity, component, and reproduction steps

Over time, the feedback loop converts Layer 2 (LLM-handled) incidents into Layer 1 (deterministic) fixes. The supervisor should need to intervene less and less.

## Open Questions

### Q1: How does the supervisor "wake up" without a user message?

Pi's agent model is request-response. The supervisor runs as the main pi session. Options:
- **Synthetic user message** — the engine/watchdog injects a message into the conversation
- **Extension event** — pi fires an event that triggers a handler which invokes LLM reasoning
- **Self-scheduling** — the supervisor's response includes a "check back in N seconds" signal
- **Separate process** — the supervisor runs as its own pi process, not the user's session

This is the key technical blocker. Needs investigation into what pi supports.

### Q2: How does the supervisor take corrective action?

The supervisor already has tools: `orch_status`, `orch_resume`, `orch_pause`, `orch_abort`, `orch_integrate`, `orch_start`. For most recovery scenarios, these are sufficient. Additional tools may be needed:
- `orch_retry_task` — retry a specific failed task
- `orch_skip_task` — skip a task and unblock dependents
- `orch_manual_fix` — apply a specific fix (edit batch state, force merge, etc.)

### Q3: What's the token budget for autonomous supervision?

Autonomous monitoring costs tokens. Need to balance:
- Frequency of status checks
- Depth of investigation on failure
- Cost ceiling per batch

### Q4: How does the user stay informed?

The supervisor should notify the user of:
- Incidents detected and actions taken (summary, not verbose)
- Decisions that need human judgment (escalation)
- Batch completion with incident report

Notification channels: pi chat (when user returns), dashboard, terminal notification.

## Implementation Phases

### Phase 1: Engine Deterministic Recovery (in progress)
- ✅ `.DONE` branch reconciliation (v0.21.3)
- [ ] Orphan tmux session cleanup on task failure (#242)
- [ ] Stale worktree detection and cleanup
- [ ] Merge retry with fresh worktree

### Phase 2: Supervisor Triggering Mechanism
- [ ] Investigate pi's extension event system for supervisor wake-up
- [ ] Prototype: engine emits event → supervisor handler → LLM reasoning
- [ ] Define the supervisor intervention protocol (event schema, response contract)

### Phase 3: Autonomous Supervisor Loop
- [ ] Supervisor monitors batch lifecycle events
- [ ] Supervisor investigates and recovers from failures
- [ ] Supervisor escalates to user when it can't resolve
- [ ] Incident logging and classification

### Phase 4: Feedback Loop
- [ ] Supervisor creates GitHub issues for recurring patterns
- [ ] Issue template for "incident → deterministic fix" proposals
- [ ] Metrics: incidents per batch, auto-recovered vs escalated

## Success Criteria

1. A batch with a recoverable failure (`.DONE` race, merge conflict, transient error) completes without user intervention
2. The supervisor notifies the user of what happened and what it did
3. After N batches, recurring patterns are filed as issues and subsequently fixed in engine code
4. Incident rate per batch decreases measurably over time
