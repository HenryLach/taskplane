# Watchdog, Supervisor & Recovery Architecture

> **Status:** Draft v3  
> **Created:** 2026-03-20  
> **Last Updated:** 2026-03-20  
> **Related:** [resilience-and-diagnostics-roadmap.md](implemented/resilience-and-diagnostics-roadmap.md), [polyrepo-workspace-implementation.md](implemented/polyrepo-workspace-implementation.md)  
> **Inspired by:** [Overstory](https://github.com/jayminwest/overstory) tiered watchdog model, [Gastown](https://github.com/steveyegge/gastown) coordinator pattern

---

## 1. Problem Statement

Taskplane's orchestrator is deterministic code — it plans well and executes
reliably on the happy path. But when failures occur (merge timeout, session
crash, stale state), recovery requires a human operator to diagnose, intervene,
and restart. If the operator is away, the batch sits paused for hours.

**Real incidents (2026-03-20 batch):**

1. Wave 2 merge agent timed out at 600s. Batch paused. On `/orch-resume`, the
   resume logic skipped wave 2's merge entirely (bug #102) because all tasks
   showed `.DONE`. Wave 3 started against a codebase missing wave 2's code.
   Required ~30 minutes of interactive recovery with an AI agent.

2. Wave 3 merge timed out again. Manual merge recovery needed. The merge had
   actually succeeded — verification tests pushed it past the timeout.

3. `/orch-resume` repeatedly failed to restart wave 4 due to stale counters,
   missing worktrees, and session name contamination from earlier crashes.
   Each attempt required inspecting batch state JSON and hand-editing fields.

**Core insight:** Every recovery step the operator performed with an AI agent
was something an AI agent could have done autonomously. The human added no
unique judgment — they just relayed error messages to an agent and approved
fixes. An integrated supervisor eliminates that relay.

**Cost insight:** A batch of 11 tasks costs ~$100+ in API calls for workers,
reviewers, and merge agents. A supervisor agent monitoring the batch costs ~$5.
The operator's time debugging failures costs far more than either. The
supervisor pays for itself on the first incident it handles autonomously.

---

## 2. Design Principles

1. **Deterministic first, supervisor for the rest.** Known failure patterns get
   code-level handlers (Tier 0). The supervisor handles novel failures and
   complex recovery that code can't anticipate.

2. **The supervisor is always present.** Not opt-in, not a luxury. It's the
   agent that watches over your batch the way a senior engineer watches over a
   deployment. The cost is negligible relative to the batch cost.

3. **The operator stays in control.** The supervisor's pi session is
   interactive — the operator can ask questions, give instructions, or override
   decisions at any time. This isn't fire-and-forget; it's supervised autonomy.

4. **Bounded authority with full transparency.** The supervisor can execute
   recovery actions (git operations, state edits, session management) but logs
   everything it does. The operator can review the audit trail at any time.

5. **Escalate, don't guess.** When the supervisor is uncertain, it asks the
   operator rather than making a risky choice. The interactive session makes
   this a conversation, not a blocking dialog.

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Operator's Terminal (interactive pi session)                    │
│                                                                  │
│  /orch all                                                       │
│    → Engine starts (async, non-blocking)                         │
│    → Supervisor agent activates                                  │
│    → Terminal becomes interactive command center                  │
│                                                                  │
│  Operator: "How's wave 2 going?"                                 │
│  Supervisor: "Wave 2 executing. TP-030 on Step 3 (87% complete), │
│              TP-026 just finished. TP-034 on Step 4."            │
│                                                                  │
│  [Supervisor detects merge timeout]                              │
│  Supervisor: "⚠️ Wave 2 merge timed out on lane 2. Tier 0       │
│              retry in progress with 2x timeout..."               │
│                                                                  │
│  [Tier 0 retry also fails]                                       │
│  Supervisor: "Tier 0 exhausted. I'll attempt manual merge.       │
│              Lane branches intact, 3 tasks succeeded."           │
│  Supervisor: "Manual merge complete. 2 comment-only conflicts    │
│              resolved (kept v3 canonical). Tests pass (1564).    │
│              Advancing to wave 3."                               │
│                                                                  │
│  Operator: "Good. I'm going to bed. Handle whatever comes up."   │
│  Supervisor: "Got it. I'll handle recoverable issues and pause   │
│              with a summary if I hit something I can't resolve."  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
         │                           │
         │ monitors & controls       │ spawns & polls
         ▼                           ▼
┌──────────────────┐    ┌──────────────────────────────┐
│ Tier 0: Watchdog │    │ Engine (async, non-blocking)  │
│ (deterministic)  │    │                               │
│                  │    │ Wave loop → Lane sessions     │
│ • Merge retry    │    │ → Poll .DONE/STATUS.md        │
│ • Session liven. │    │ → Merge → Verify → Advance    │
│ • Cleanup recov. │    │                               │
│ • State coherence│    │ tmux: worker/reviewer/merger   │
└──────────────────┘    └──────────────────────────────┘
```

### What Changed from v1

The three-tier model (Tier 0 code / Tier 1 triage call / Tier 2 optional
patrol) is replaced by a two-layer model:

- **Tier 0 (Watchdog):** Unchanged — deterministic code handlers for known
  failure patterns. Free, always on, handles the mechanical stuff.

- **Supervisor Agent:** Replaces both Tier 1 (bounded triage) and Tier 2
  (fleet patrol). A persistent, interactive agent session that monitors the
  batch, handles novel failures, communicates with the operator, and executes
  recovery actions using standard tools.

The key insight from v1's design was that Tier 1 (single LLM call picking from
a menu) was too limited — it couldn't handle multi-step recovery like tonight's
incident. And Tier 2 (read-only patrol) was too restricted — it could observe
problems but not fix them. The supervisor combines both into an agent that can
reason AND act.

---

## 4. Interactive Session Model

### 4.1 Non-Blocking `/orch`

The critical architecture change: `/orch all` must become non-blocking.

**Current behavior:**
```
/orch all → handler blocks → streams logs → returns when batch completes
```

**Proposed behavior:**
```
/orch all → starts engine async → activates supervisor → returns to pi session
```

The engine runs in the background via event-driven polling (the tmux sessions
and poll loops already work this way — we just need to not `await` the entire
batch lifecycle in the command handler).

The pi session remains interactive. The operator is talking to the supervisor
agent, whose system prompt gives it context about the running batch and tools
to monitor and intervene.

### 4.2 Supervisor System Prompt

The supervisor agent runs in the same pi session as the operator. Its system
prompt establishes:

- **Identity:** "You are the batch supervisor for Taskplane. You monitor the
  running batch, handle failures, and keep the operator informed."
- **Context:** Batch state file path, telemetry sidecar paths, orch branch
  name, wave plan, task list with dependencies
- **Capabilities:** Full tool access (read, write, edit, bash). Can read batch
  state, tail telemetry, run git commands, edit state JSON, kill/start tmux
  sessions, run tests.
- **Standing orders:** Monitor batch progress. When problems occur, attempt
  Tier 0 recovery first. If Tier 0 fails, reason about the failure and attempt
  recovery. If uncertain, ask the operator. Log all actions.
- **Periodic check-in:** Every N minutes (configurable), read batch state and
  report status if significant changes occurred.

### 4.3 Operator Interaction Patterns

The supervisor supports natural conversation:

| Operator Says | Supervisor Does |
|---------------|-----------------|
| "How's it going?" | Reads batch state, reports wave/task progress, cost so far |
| "What's TP-030 doing?" | Reads STATUS.md from worktree, reports current step and checkboxes |
| "Pause the batch" | Writes pause signal, confirms when paused |
| "Why did the merge fail?" | Reads error from batch state, inspects merge result files, explains |
| "Fix it" | Executes recovery (merge retry, manual merge, state repair) |
| "I'm going to bed, handle it" | Acknowledges autonomous mode, sets escalation to pause-and-summarize |
| "Skip TP-033 and finish the batch" | Marks task skipped, advances wave, proceeds to integrate |
| "Show me the cost so far" | Reads telemetry sidecars, sums token usage and cost |
| "What did the reviewer say about TP-030?" | Reads review files from .reviews/ directory |

### 4.4 Notification Model

The supervisor proactively notifies the operator about significant events:

- **Wave completion:** "✅ Wave 2 complete. 3 tasks succeeded. Merging..."
- **Merge success:** "✅ Wave 2 merged. 1321 tests pass. Starting wave 3."
- **Failure detected:** "⚠️ Merge timeout on lane 2. Attempting Tier 0 retry..."
- **Recovery success:** "✅ Recovered from merge timeout. Manual merge succeeded."
- **Recovery failure:** "❌ Cannot recover automatically. [explanation]. What would you like me to do?"
- **Batch complete:** "🏁 Batch complete. 11/11 tasks succeeded. Run `/orch-integrate --pr` to create a PR."

These appear as natural messages in the conversation — not log spam. The
supervisor summarizes rather than dumping raw log lines.

### 4.5 Autonomy Levels

The operator can set how much the supervisor does on its own:

| Level | Behavior |
|-------|----------|
| **Interactive** (default) | Supervisor asks before executing recovery. Good for learning/trust-building. |
| **Supervised** | Supervisor executes Tier 0 recovery automatically, asks before novel recovery. |
| **Autonomous** | Supervisor handles everything it can. Pauses and summarizes only when stuck. |

```
Operator: "Set autonomy to autonomous. I'll check back in the morning."
Supervisor: "Understood. I'll handle recoverable issues and pause with a
            summary if I encounter something I can't resolve."
```

---

## 5. Tier 0 — Mechanical Watchdog

**Cost:** Zero (deterministic TypeScript code)  
**Authority:** Full automatic recovery for known failure patterns  
**Always enabled:** Yes (part of the engine)

*Tier 0 is unchanged from v1 — see below for the full pattern catalog.*

### 5.1 What Tier 0 Monitors

| Signal | Detection Method | Frequency |
|--------|-----------------|-----------|
| Session liveness | `tmux has-session -t {name}` | Every poll tick (5s default) |
| Merge agent timeout | Wall-clock timer vs `merge.timeoutMinutes` | During merge phase |
| Stall detection | STATUS.md unchanged for `stallTimeout` minutes | Every poll tick |
| Worktree health | `git worktree list` + directory existence | Before wave start |
| Branch consistency | Lane branches exist, orch branch ref valid | Before merge, after resume |
| State coherence | mergeResults aligns with currentWaveIndex | On resume, after merge |
| .DONE vs merge status | All tasks done but merge missing → flag | On wave transition |

### 5.2 Recovery Playbook

#### Pattern 1: Merge Agent Timeout

```
Trigger: Merge agent exceeds timeoutMs
Current behavior: Kill session, pause batch
Tier 0 recovery:
  1. Kill the merge agent session
  2. Check if merge result file was partially written
  3. If merge result exists and status=SUCCESS → accept it (agent was slow writing)
  4. If no result → retry merge with 2x timeout (up to configured max)
  5. If retry fails → escalate to supervisor
  6. Max retries: 2 (configurable)
```

#### Pattern 2: Worker Session Crash (no .DONE)

```
Trigger: tmux session disappears, no .DONE, no exit summary
Current behavior: Mark task failed
Tier 0 recovery:
  1. Check lane branch for commits ahead of base
  2. If commits exist → save branch, record partial progress
  3. Read exit summary file if RPC wrapper produced one → classify exit
  4. If classification is retryable (api_error, process_crash) → retry task
  5. If not retryable or max retries hit → escalate to supervisor
  6. Max retries: 1 (configurable)
```

#### Pattern 3: Resume Finds Completed Tasks but No Merge

```
Trigger: All wave tasks have .DONE but mergeResults missing/failed for that wave
Current behavior: BUG — skips wave entirely (issue #102)
Tier 0 recovery:
  1. Detect: wave N tasks all succeeded, but mergeResults[N] missing or failed
  2. Check if lane branches still exist
  3. If yes → re-attempt merge (create merge worktree, merge lanes, verify)
  4. If lane branches gone → check orch branch for task commits
  5. If commits present on orch → mark merge succeeded (already integrated)
  6. If commits missing and branches gone → escalate to supervisor
```

#### Pattern 4: Stale Worktree Blocks Wave Start

```
Trigger: git worktree add fails because path exists
Tier 0 recovery:
  1. Try git worktree remove --force
  2. If fails → rm -rf + git worktree prune
  3. Retry git worktree add
  4. If still fails → escalate to supervisor
```

#### Pattern 5: Stale Session Names on Resume

```
Trigger: Pending task has sessionName from previous failed attempt, no session alive
Current behavior: BUG — marks task failed instead of pending
Tier 0 recovery:
  1. Detect: task.status === "pending" AND task.sessionName !== "" AND session not alive
  2. Clear sessionName and laneNumber
  3. Task remains pending for fresh allocation
```

#### Pattern 6: Batch State Corruption

```
Trigger: batch-state.json unparseable or schema invalid
Tier 0 recovery:
  1. Attempt parse → if JSON invalid, check for .tmp file (interrupted atomic write)
  2. If .tmp exists and valid → promote to batch-state.json
  3. If no .tmp → escalate to supervisor
  4. Never auto-delete state
```

### 5.3 Retry Budget

```typescript
interface RetryBudget {
  mergeTimeout:  { maxRetries: 2, backoffMultiplier: 2.0 };
  workerCrash:   { maxRetries: 1, cooldownMs: 5000 };
  worktreeStale: { maxRetries: 1, cooldownMs: 2000 };
  resumeMerge:   { maxRetries: 1, cooldownMs: 0 };
}
```

Retry counters persist in batch state (`resilience.retryCountByScope`) so
they survive across pause/resume cycles.

### 5.4 Tier 0 → Supervisor Escalation

When Tier 0 exhausts its playbook, it escalates to the supervisor with
structured context:

```typescript
interface EscalationContext {
  pattern: string;           // which playbook pattern was attempted
  attempts: number;          // how many retries were tried
  lastError: string;         // what went wrong on the last attempt
  affectedTasks: string[];   // which tasks are impacted
  affectedWave: number;      // which wave
  laneBranches: string[];    // branches that may need manual merge
  orchBranchTip: string;     // current orch branch HEAD
  batchStatePath: string;    // for the supervisor to read/edit
  suggestion: string;        // Tier 0's best guess at what to try next
}
```

The supervisor receives this as a notification in the conversation and decides
what to do — either executing recovery, asking the operator, or pausing.

---

## 6. Supervisor Agent

**Cost:** ~$3-10 per batch (depends on batch duration and incident count)  
**Authority:** Full tool access with audit logging  
**Always active:** Yes, whenever a batch is running

### 6.1 What the Supervisor Does

The supervisor is the "senior engineer on call" for your batch:

**Continuous monitoring:**
- Reads batch state on each poll cycle
- Tails telemetry sidecars for cost and progress
- Watches for Tier 0 escalations
- Tracks overall batch health trajectory

**Incident response:**
- Receives Tier 0 escalations with structured context
- Reasons about the failure using codebase knowledge
- Executes multi-step recovery (git operations, state edits, session management)
- Verifies recovery succeeded (runs tests, checks state consistency)
- Reports outcome to operator

**Proactive insights:**
- "Wave 3 has been running for 2 hours. TP-032 is on iteration 8 of Step 2 — it may be struggling."
- "Batch cost so far: $47. Estimated remaining: $35 based on current rates."
- "The merge timeout is set to 10 minutes but verification tests take 90 seconds. Consider increasing."

**Operator communication:**
- Answers questions about batch progress, task status, costs
- Explains failures in plain language
- Takes instructions ("skip that task", "increase the timeout", "pause and I'll look at it")

### 6.2 What the Supervisor Does NOT Do

- **Does not write task code.** That's the worker's job.
- **Does not review task output.** That's the reviewer's job.
- **Does not decide task scope or dependencies.** That was decided at planning time.
- **Does not merge task code.** That's the merge agent's job. (But it CAN do
  emergency manual merges when the merge agent fails.)
- **Does not push to remote or create PRs.** That's `/orch-integrate`.

### 6.3 Supervisor Authority Model

The supervisor has full tool access but operates under a transparency contract:

**Before any destructive action:**
1. Log the action to `.pi/supervisor/actions.jsonl`
2. In interactive/supervised mode, describe what it's about to do and why
3. In autonomous mode, execute and report

**Destructive actions include:**
- Killing tmux sessions
- Editing batch-state.json
- Running `git reset`, `git merge`, `git branch -D`
- Removing worktrees
- Modifying STATUS.md or .DONE files

**Non-destructive actions (always allowed):**
- Reading any file
- Running `git status`, `git log`, `git diff`
- Running test suites
- Tailing telemetry sidecars
- Reporting to operator

### 6.4 Audit Trail

Every supervisor action produces a structured log entry:

```jsonl
{"ts":"2026-03-20T02:35:00Z","action":"merge_retry","wave":2,"lane":2,"reason":"Tier 0 escalation: merge timeout after 2 retries","command":"git merge --no-ff task/henrylach-lane-2-20260319T140046","result":"success_with_conflicts","conflicts":["types.ts","persistence.ts","resume.ts"],"resolution":"accepted HEAD (v3 canonical) for all 3 comment-only conflicts","tests":"1564 pass","duration_sec":45}
```

The operator can ask "what did you do while I was away?" and the supervisor
summarizes from the audit trail.

---

## 7. Implementation Architecture

### 7.1 Engine Becomes Non-Blocking

The core change that enables everything:

```typescript
// Current (blocking)
pi.registerCommand("orch", {
  handler: async (args, ctx) => {
    await runOrchBatch(config, ...);  // blocks until batch complete
  }
});

// Proposed (non-blocking)
pi.registerCommand("orch", {
  handler: async (args, ctx) => {
    startOrchBatch(config, ...);  // starts async, returns immediately
    activateSupervisor(ctx, ...); // supervisor takes over the session
  }
});
```

The engine runs its wave loop via `setInterval`/event callbacks. State
transitions emit events that the supervisor observes. The pi session's
foreground is the supervisor conversation.

### 7.2 Supervisor as Extension Behavior

The supervisor isn't a separate process or a separate pi session. It's a
behavioral mode of the existing task-orchestrator extension:

1. After `/orch all` starts the engine, the extension injects a supervisor
   system prompt into the pi session's context
2. The supervisor prompt includes: batch metadata, file paths for state and
   telemetry, standing instructions for monitoring and recovery
3. The operator's messages in the pi session are handled by the supervisor
4. Engine events (wave complete, merge failed, task done) appear as context
   updates that the supervisor can reference

This avoids the complexity of inter-process communication. The supervisor
and the engine share the same process, the same file system, and the same
pi session.

### 7.3 Engine Event Notifications

The engine emits structured events that the supervisor observes:

| Event | When | Data |
|-------|------|------|
| `wave_start` | Wave execution begins | waveIndex, taskIds, laneCount |
| `task_complete` | Task .DONE detected | taskId, duration, outcome |
| `task_failed` | Task failed/stalled | taskId, reason, partialProgress |
| `merge_start` | Wave merge begins | waveIndex, laneCount |
| `merge_success` | Merge and verification pass | waveIndex, testCount, duration |
| `merge_failed` | Merge or verification fails | waveIndex, lane, error |
| `tier0_recovery` | Tier 0 attempts recovery | pattern, attempt |
| `tier0_escalation` | Tier 0 exhausted | EscalationContext |
| `batch_complete` | All waves done | summary |
| `batch_paused` | Batch paused (failure or manual) | reason |

Events are written to `.pi/supervisor/events.jsonl` for the supervisor to tail,
and can also trigger proactive notifications in the conversation.

### 7.4 Config Reload on Recovery

A lesson from the current batch: the supervisor should re-read config before
retry attempts. When the operator says "I increased the merge timeout to 40
minutes," the supervisor picks up the change on the next recovery attempt
instead of using the cached config from session start.

---

## 8. Recovery: Full Pattern Catalog

Based on all observed incidents (14 in the incident ledger + 3 from tonight):

| # | Pattern | Tier 0 Handler | Supervisor Fallback |
|---|---------|---------------|-------------------|
| 1 | Merge agent timeout | Retry with 2x timeout (max 2) | Manual merge + verify |
| 2 | Worker session crash | Save branch, classify exit, retry if retryable | Assess task, retry or skip |
| 3 | Resume skips wave merge (#102) | Detect missing merge, re-attempt | Manual merge if branches exist |
| 4 | Stale worktree blocks provisioning | Force cleanup + prune + retry | Investigate and repair |
| 5 | Stale session names on resume | Clear sessionName for dead pending tasks | — (always deterministic) |
| 6 | Batch state corruption | Promote .tmp, validate | Reconstruct from orch branch + .DONE files |
| 7 | Merge conflict (trivial) | Accept canonical version | — (Tier 0 handles) |
| 8 | Merge conflict (complex) | Escalate | Analyze conflict, resolve or delegate to merge agent with context |
| 9 | Pre-existing test failures block merge | Baseline comparison | Classify failures, advise operator |
| 10 | Terminal state traps resume | Force-resume with diagnostics | Repair state, re-provision worktrees |
| 11 | Config not reloaded after change | Re-read config before retry | — (always deterministic) |
| 12 | Resume destroys worktrees for pending tasks | Detect and prevent cleanup of future-wave assets | Re-provision from orch branch |
| 13 | Counters/flags contaminated from prior crash | Validate state coherence on resume | Full state audit and repair |
| 14 | API rate limit / overload | Cooldown + retry (pi handles) | Monitor pattern, advise if persistent |
| 15 | Context overflow | Fresh iteration (task-runner handles) | Monitor iteration count, advise if stuck |
| 16 | Windows file locks on cleanup | Retry with delay, force-remove | — (Tier 0 handles) |
| 17 | Verification tests exceed merge timeout | Check merge result before timeout kill | Extend timeout, re-verify separately |

---

## 9. Observability

### 9.1 Supervisor Audit Trail

```
.pi/supervisor/
├── actions.jsonl      ← Every action the supervisor took
├── events.jsonl       ← Engine events received
├── conversation.jsonl ← Operator interaction log
└── summary.md         ← Human-readable batch summary (generated on completion)
```

### 9.2 Batch Summary (Generated by Supervisor)

When the batch completes (or is abandoned), the supervisor writes a summary:

```markdown
# Batch Summary: 20260319T140046

**Duration:** 10h 33m
**Cost:** $127.43
**Result:** 11/11 tasks succeeded

## Wave Timeline
- Wave 1 (3 tasks): 45 min execution, 2 min merge ✅
- Wave 2 (3 tasks): 3h 20m execution, merge timeout → manual recovery → ✅
- Wave 3 (4 tasks): 4h 10m execution, merge timeout → manual recovery → ✅
- Wave 4 (1 task): 1h 50m execution, 3 min merge ✅

## Incidents
1. Wave 2 merge timeout (10 min). Tier 0 retried 2x, then I merged manually.
   3 comment-only conflicts resolved. 1321 tests pass.
2. Wave 3 merge timeout (10 min). Merge had actually succeeded — verification
   pushed past timeout. Accepted existing merge result. 1564 tests pass.

## Recommendations
- Increase merge.timeoutMinutes to 20 (verification alone takes 90s)
- Consider disabling merge verification for non-critical batches
- TP-032 took 8 worker iterations on Step 2 — may need task scope reduction

## Cost Breakdown
| Wave | Workers | Reviewers | Mergers | Total |
|------|---------|-----------|---------|-------|
| 1    | $18.50  | $12.30    | $2.10   | $32.90 |
| 2    | $31.20  | $18.40    | $4.50   | $54.10 |
| 3    | $22.80  | $9.50     | $3.20   | $35.50 |
| 4    | $3.80   | $1.13     | $0.00   | $4.93  |
| **Total** | **$76.30** | **$41.33** | **$9.80** | **$127.43** |
```

---

## 10. Configuration

```yaml
supervisor:
  enabled: true                    # always on by default
  autonomy: "supervised"           # interactive | supervised | autonomous
  model: ""                        # empty = use default model
  check_interval_minutes: 2        # how often to read batch state
  max_recovery_attempts: 3         # per incident before pausing

resilience:
  tier0:
    enabled: true                  # deterministic watchdog
    merge_retry:
      max_retries: 2
      backoff_multiplier: 2.0
    worker_crash_retry:
      max_retries: 1
      cooldown_ms: 5000
    config_reload_on_retry: true   # re-read config before retries
```

---

## 11. Implementation Priority

### Immediate (fix bugs from tonight)

- Fix #102: Resume checks mergeResults before skipping wave
- Fix #102b: Clear sessionName for pending tasks with dead sessions
- Fix: Check merge result file before killing merge agent on timeout
- Fix: Re-read config before merge retry attempts

### Phase 1: Tier 0 Watchdog (pure code)

- Implement recovery playbook patterns 1-6
- Add retry budget to batch state
- Add Tier 0 event logging
- Add state coherence validation on resume
- Tier 0 → supervisor escalation interface

### Phase 2: Non-blocking engine

- Refactor `/orch` command handler to start engine async and return
- Engine emits events to `.pi/supervisor/events.jsonl`
- State transitions via callbacks instead of blocking await

### Phase 3: Supervisor agent

- Supervisor system prompt design
- Integration with pi session (prompt injection after `/orch`)
- Batch state and telemetry reading tools
- Recovery action execution with audit logging
- Operator interaction patterns
- Autonomy level switching

### Phase 4: Polish

- Batch summary generation on completion
- Cost tracking and breakdown
- Proactive insights (stalled tasks, cost trajectory)
- Cross-batch learning (persistent recommendations)

---

## 12. Comparison with Other Systems

| Concern | Taskplane (proposed) | Overstory | Gastown |
|---------|---------------------|-----------|---------|
| Orchestration engine | Deterministic code | LLM coordinator agent | LLM Mayor agent |
| Supervision | Integrated supervisor agent (interactive) | 3-tier watchdog + monitor agent | Mayor monitors Polecats |
| Operator interaction | Natural conversation in same terminal | Separate monitor session | Separate Mayor session |
| Recovery | Tier 0 code + supervisor agent fallback | AI-assisted triage + monitor | Mayor reassigns/retries |
| Cost overhead | ~$3-10/batch (supervisor) | Continuous coordinator + monitor | Continuous Mayor session |
| Determinism | High for known patterns, LLM for novel | Medium (LLM makes most decisions) | Low (LLM makes all decisions) |

**Taskplane's differentiator:** The supervisor shares the operator's terminal.
You're not switching between windows to check on your batch or talk to a
coordinator. You start the batch and you're immediately in conversation with
the agent watching it. That's a fundamentally better UX than separate
monitoring sessions.

---

## 13. Open Questions

1. **Non-blocking engine complexity:** How much refactoring does the engine
   need to become event-driven? The current blocking await is deeply embedded
   in the wave loop. This may be the hardest implementation task.

2. **Supervisor context management:** Long batches (10+ hours) will accumulate
   significant context in the supervisor session. How do we handle compaction
   without losing incident history? Perhaps the audit trail files serve as
   persistent memory that survives compaction.

3. **Multiple batches:** If the operator starts a second batch while the first
   is running (different workspace), should there be one supervisor per batch
   or one supervisor managing multiple batches?

4. **Supervisor model selection:** Should the supervisor use the same model as
   workers, or a different model? A reasoning-heavy model (Claude Opus) might
   be better for complex incident diagnosis, while workers use a faster model.

5. **Testing the supervisor:** How do we test supervisor behavior? Simulated
   failure injection? Recorded incident replay? This is inherently harder to
   test than deterministic code.

6. **Graceful degradation:** If the supervisor's own LLM call fails (API
   error), the system should fall back to Tier 0 behavior (pause on failure)
   rather than cascading failures.

7. **Dashboard integration:** Should the dashboard show supervisor status and
   conversation history? Or is the terminal sufficient?

8. **Supervisor and `/task` mode:** Should the supervisor also activate for
   single-task `/task` execution? Currently `/task` is a simpler flow, but
   it still benefits from crash recovery and progress monitoring. The
   supervisor could offer a lighter-touch mode for single tasks.

9. **Multi-project operation:** An operator may have Taskplane set up in
   multiple projects. Should the supervisor maintain awareness across
   projects (e.g., "your other project's batch finished 2 hours ago"),
   or is each pi session fully independent?

10. **Supervisor handoff on session restart:** If the operator closes their
    terminal and reopens pi later, the supervisor needs to reconstruct its
    context from the audit trail and batch state. How smooth is this
    re-hydration? The primer + audit files should make it work, but it
    needs explicit design for the "I'm back, what happened while I was
    gone?" scenario.

---

## 14. Supervisor-Led Onboarding

### 14.1 Vision

The supervisor is not just a batch monitor — it's the persistent intelligent
interface for all of Taskplane. The user's first interaction with Taskplane
should be a conversation, not a CLI wizard. Instead of `taskplane init`
generating config files with wrong defaults that the user must manually fix,
the supervisor discovers the project, asks questions, and proposes a setup
that actually fits.

**Entry point:** The user types `/orch` with no arguments. If no config exists,
the supervisor detects this as a first-run scenario and initiates onboarding.

```
User: /orch
Supervisor: "Welcome to Taskplane! I don't see a configuration for this
            project yet. Let me help you get set up. Give me a moment to
            look around your project..."

[Supervisor reads repo structure, package.json, git branches, existing docs]

Supervisor: "This looks like a Node.js monorepo with src/api/, src/web/,
            and libs/shared/. You're on the 'develop' branch with 'main'
            as protected. I have a few questions to get your task areas
            configured correctly..."
```

### 14.2 Onboarding Scripts

These are **conversational guides** for the supervisor agent — not deterministic
code. They tell the supervisor what to explore, what questions to ask, what
decisions need to be made, and what artifacts to create. The supervisor adapts
the conversation based on what it discovers.

---

#### Script 1: First Time Ever Using Taskplane

**Trigger:** No `.pi/` directory exists. No `taskplane-config.json`. User may
not know what Taskplane does.

**Goals:**
- Explain what Taskplane does (in one paragraph, not a manual)
- Assess the project and propose a setup
- Create all required config and scaffolding
- Get the user to a running first task within the conversation

**Exploration phase:**
```
1. Read the repo structure (top-level dirs, key files)
2. Identify project type:
   - package.json → Node.js/TypeScript
   - pyproject.toml / setup.py → Python
   - go.mod → Go
   - Cargo.toml → Rust
   - pom.xml / build.gradle → Java
   - Multiple languages → polyglot
3. Check for existing docs (README, CONTRIBUTING, architecture docs)
4. Check git state:
   - Current branch name
   - Remote branches (main, develop, master, etc.)
   - Branch protection (gh api if available)
   - Recent commit activity
5. Check for existing task/issue tracking:
   - GitHub Issues (gh issue list)
   - TODO/FIXME comments in code
   - Existing task folders or ticket references
6. Check for test infrastructure:
   - Test commands in package.json scripts
   - Test directories (test/, tests/, __tests__/, spec/)
   - CI config (.github/workflows/, .gitlab-ci.yml)
```

**Conversation script:**
```
Introduction:
  "Welcome to Taskplane! I'm your project supervisor. I'll help you set up
  task orchestration for this project. Taskplane lets AI agents work on
  coding tasks autonomously — I plan the work, manage parallel execution,
  handle merges, and keep you informed."

Project assessment:
  "Let me take a look at your project..."
  [Run exploration]
  "Here's what I found: [summary]. A few questions:"

Task area discussion (delegate to Script 4: Task Area Design):
  "Where should we organize tasks for this project?"

Git branching discussion (delegate to Script 5: Git Branching):
  "Let's make sure Taskplane works well with your git workflow."

Config generation:
  "Based on our conversation, here's what I'll set up:
   - Config: .pi/taskplane-config.json
   - Task area: [path] with prefix [PREFIX]
   - CONTEXT.md describing [project summary]
   - Agent prompts: .pi/agents/ (thin overrides, base prompts maintained by Taskplane)
   - .gitignore entries for Taskplane working files"
  [Generate files]

First task:
  "You're all set! Want me to create a task to work on? I can:
   - Pull from GitHub Issues if you have any labeled 'ready'
   - Help you describe something you want built
   - Create a small smoke test task to verify everything works"

Handoff:
  "To run your first batch: /orch all
   To see the plan first: /orch-plan all
   I'll be here monitoring and ready to help."
```

---

#### Script 2: First Use in a New/Empty Project

**Trigger:** Config doesn't exist. Repo has minimal content — maybe a README,
some spec docs, an empty src/ directory, but little to no code.

**Goals:**
- Understand what the user is building (from docs/specs if available)
- Set up task areas that match the planned architecture (not current file structure)
- Help decompose the initial build into tasks
- Possibly create the first batch of tasks from spec docs

**Exploration phase:**
```
1. Read any existing docs (README, specs, design docs, PRDs)
2. Check if there's a project plan or architecture doc
3. Look for technology choices (framework configs, dependency files)
4. Assess how much structure exists vs how much needs to be created
```

**Conversation script:**
```
Assessment:
  "This looks like a new project — I see [what exists]. Let me read
  through your docs to understand what you're building..."
  [Read available docs]
  "Based on [doc], it looks like you're building [summary]."

Architecture-first task areas:
  "Since the codebase is just getting started, let's organize tasks
  around your planned architecture rather than the current file structure.
  From your [spec/README], it looks like the main components are:
   - [component A]
   - [component B]
   - [component C]
  Should we create a task area per component? Or would you prefer to
  start with a single area and split later as the codebase grows?"

Initial task decomposition:
  "Want me to break down your [spec/plan] into executable tasks? I can
  create a batch that builds out the initial scaffolding — project
  structure, core interfaces, basic tests — and you can review the
  task definitions before we run them."

  [If user agrees, use create-taskplane-task skill to generate tasks
   from the spec, with proper dependencies]

Guidance for greenfield:
  "A few recommendations for a new project:
   - Start with small tasks (S/M) to build confidence in the workflow
   - The first batch should establish patterns the later tasks can follow
   - I'd suggest review level 2 (plan + code review) for foundational work
   - Once patterns are established, you can drop to level 1 for speed"
```

---

#### Script 3: First Use in an Established Project

**Trigger:** Config doesn't exist. Repo has substantial code, docs, tests,
and history. May have an existing task management system.

**Goals:**
- Understand the project's domain, architecture, and conventions
- Discover existing task/issue tracking and offer to integrate
- Set up task areas that reflect the actual project structure
- Respect existing conventions (commit formats, branch naming, test commands)

**Exploration phase:**
```
1. Full project structure scan (deep, not just top-level)
2. Read key docs: README, CONTRIBUTING, architecture docs
3. Detect conventions:
   - Commit message format (conventional commits? ticket refs?)
   - Branch naming patterns (feature/, fix/, etc.)
   - PR templates (.github/PULL_REQUEST_TEMPLATE.md)
   - Code review requirements
4. Detect existing task tracking:
   - GitHub Issues (count, labels, milestones)
   - Jira references in commits
   - Linear/Asana/Notion links in docs
   - TODO comments in code
5. Analyze code structure:
   - Service boundaries (microservices, monorepo packages)
   - Shared libraries
   - Test coverage patterns
   - Build/deploy configuration
6. Check team indicators:
   - CODEOWNERS file
   - Multiple contributors in git log
   - Branch protection rules
```

**Conversation script:**
```
Assessment:
  "This is an established project — I can see [X commits], [N
  contributors], and a [framework] codebase organized as [structure].
  Let me dig deeper..."
  [Run full exploration]

Existing workflow integration:
  "I found [GitHub Issues / Jira refs / etc.]. Taskplane can work
  alongside your existing tracking — I create tasks from issues and
  report results back. Want me to show you how that works?"

  [If GitHub Issues: mention load-gh-issues skill if available]

Task area design (delegate to Script 4):
  "Your code is organized as [description]. Let me propose task areas
  that match..."

Convention detection:
  "I noticed you use [conventional commits / ticket refs / etc.] in your
  commit messages. I'll configure Taskplane to follow the same pattern.
  Your test command looks like [detected command] — I'll use that for
  verification."

Existing standards:
  "I found [CONTRIBUTING.md / coding standards / etc.]. I'll include
  these as reference docs so task workers follow your project's rules."

Migration path (if existing task system found):
  "You have [N open issues / tasks in Jira / etc.]. Want me to:
   - Import some as Taskplane tasks for autonomous execution?
   - Keep them in [existing system] and just link?
   - Show you how the two systems work together?"
```

---

#### Script 4: Task Area Design

**Trigger:** Delegated from Scripts 1-3 during onboarding, or invoked when
the user wants to reorganize task areas.

**Goals:**
- Propose task area structure that matches the project
- Explain what task areas are and why structure matters
- Create CONTEXT.md files that accurately describe each area's scope
- Set appropriate prefixes to avoid ID collisions

**Conversation script:**
```
Explain (brief, only if first time):
  "Task areas are how Taskplane organizes work. Each area has its own
  folder, ID prefix, and context doc. When you create a task, it goes
  into the area that owns that part of the codebase. The orchestrator
  uses areas to find tasks and manage dependencies."

Propose structure based on project analysis:
  [For a monorepo with clear domains:]
  "Based on your project structure, I'd suggest:
   - 'api' area (prefix: API) for backend service work → tasks/api/
   - 'web' area (prefix: WEB) for frontend work → tasks/web/
   - 'platform' area (prefix: PLT) for shared libs/infra → tasks/platform/
  Each gets a CONTEXT.md describing what it owns."

  [For a single-service project:]
  "Your project is a single [type]. I'd suggest starting with one area:
   - 'general' area (prefix: T) → taskplane-tasks/
  You can split into multiple areas later if the project grows."

  [For a polyrepo workspace:]
  "This is a multi-repo workspace. I'd suggest:
   - One task area per repo, or per domain that spans repos
   - Tasks declare which repo they target via Execution Target
   - The shared config repo holds all task areas"

CONTEXT.md generation:
  "I'll create a CONTEXT.md for each area with:
   - What this area owns (based on the code I found)
   - Key files and directories
   - Technical debt / known issues (if I found any)
   - Next Task ID counter
  Want to review these before I write them?"

Path discussion:
  "Where should the task folders live?
   - Inside the project: tasks/ or taskplane-tasks/ (common for monorepos)
   - Alongside docs: docs/task-management/ (keeps tasks near specs)
   - Custom path: whatever makes sense for your team"
```

---

#### Script 5: Git Branching & Protection

**Trigger:** Delegated from Scripts 1-3, or invoked when the supervisor
detects potential git workflow issues.

**Goals:**
- Understand the project's branching strategy
- Ensure Taskplane's orch branch model works with it
- Guide the user toward protective guardrails
- Configure default branch and integration mode

**Exploration phase:**
```
1. List remote branches: git branch -r
2. Detect primary branches: main, master, develop, etc.
3. Check branch protection: gh api repos/{owner}/{repo}/branches/{branch}/protection
4. Check PR requirements: required reviews, CI checks, etc.
5. Look for branching convention in CONTRIBUTING.md or PR templates
```

**Conversation script:**
```
Assessment:
  "Let me check your git setup..."
  [Run exploration]

Branch strategy discussion:
  [If simple (just main):]
  "You're working directly on 'main'. Taskplane will create an orch
  branch for batch work and integrate back when done. Since 'main'
  isn't protected, /orch-integrate can fast-forward directly."

  [If main + develop:]
  "You have a 'main' and 'develop' branch. Which do you normally work
  from? Taskplane should branch from your working branch — probably
  'develop' if that's where feature work goes."

  [If protected main:]
  "Your 'main' branch has protection rules (requires PR with [N] reviews).
  Perfect — Taskplane will use --pr mode for integration, which creates
  a PR from the orch branch to 'main' for your normal review process."

  [If no protection:]
  "I notice 'main' doesn't have branch protection. I'd recommend adding
  it — at minimum, require a PR so you can review Taskplane's work
  before it lands. Want me to walk you through setting that up?"

Protection recommendations:
  "For the best experience with Taskplane, I'd recommend:
   - Protect your primary branch (main/develop) — require PRs
   - Enable required CI checks so Taskplane's /orch-integrate --pr
     goes through your normal quality gates
   - Taskplane never pushes directly — it always goes through
     /orch-integrate, which respects your branch protection
  This way, you review a clean PR with all the batch's work before
  it merges."

Configure defaults:
  "I'll set your default branch to '[branch]' and integration mode to
  '[auto/manual/pr]'. You can change this anytime in taskplane-config.json
  or via /taskplane-settings."
```

---

#### Script 6: Returning User — Batch Planning

**Trigger:** Config exists, user types `/orch` with no arguments, no pending
tasks or user wants guidance.

**Goals:**
- Help the user decide what to work on
- Surface open issues, tech debt, or pending tasks
- Guide task creation if needed
- Start a batch when ready

**Conversation script:**
```
Status check:
  "Welcome back! Let me check what's available..."
  [Scan task areas for pending tasks]
  [Check GitHub Issues if gh CLI available]
  [Read CONTEXT.md tech debt sections]

  [If pending tasks exist:]
  "You have [N] pending tasks:
   - [list with sizes and dependencies]
  Want me to plan a batch? /orch-plan all will show you the wave breakdown."

  [If no pending tasks:]
  "No pending tasks right now. Here's what I found that could become tasks:
   - [N] GitHub Issues labeled 'ready' / 'good first issue'
   - [M] tech debt items in CONTEXT.md
   - [K] TODO comments in the codebase
  Want me to turn some of these into tasks?"

  [If issues exist:]
  "I can pull in GitHub Issues and create task packets for them.
  Which ones should we tackle? Or I can suggest a batch based on
  priority and dependencies."
```

---

#### Script 7: Project Health Check

**Trigger:** User asks "how's the project doing?" or supervisor detects
potential issues during routine operation.

**Goals:**
- Assess overall project health from Taskplane's perspective
- Surface issues that might affect batch execution
- Recommend maintenance actions

**Conversation script:**
```
Health assessment:
  [Check config validity]
  [Check git state — clean working tree, correct branch]
  [Check for stale worktrees or branches from prior batches]
  [Check for orphaned batch state]
  [Run taskplane doctor checks]
  [Check disk space for worktrees]
  [Check tmux availability]

Report:
  "Project health check:
   ✅ Config valid (3 task areas, 4 lanes configured)
   ✅ Git clean, on 'develop'
   ⚠️ Found 2 stale worktree dirs from a previous batch — want me to clean them?
   ✅ tmux available
   ✅ No orphaned batch state

  Task inventory:
   - 3 pending tasks (TP-042, TP-043, TP-044)
   - 41 completed tasks
   - 5 tech debt items logged
   - 12 open GitHub Issues (4 labeled 'status:ready-to-task')

  Recommendations:
   - Clean the stale worktrees (takes 2 seconds)
   - Consider creating tasks from the 4 ready GitHub Issues
   - TP-042 has been pending for 5 days — still relevant?"
```

---

#### Script 8: Post-Batch Retrospective

**Trigger:** After `/orch-integrate` completes, or operator asks "how did
that batch go?"

**Goals:**
- Summarize batch outcomes
- Highlight issues and learnings
- Recommend config adjustments
- Suggest next steps

**Conversation script:**
```
Summary:
  [Read batch diagnostic report]
  [Read audit trail]

  "Batch complete! Here's the summary:

  📊 Results: 11/11 tasks succeeded
  ⏱  Duration: 10h 33m
  💰 Cost: $127.43

  Highlights:
  - Wave 2 merge timed out — recovered automatically (Tier 0 retry)
  - TP-032 took 8 iterations on Step 2 (others averaged 3-4)
  - Reviewer approved on first pass for 6/11 tasks (up from 0/11 last batch!)

  Recommendations:
  - Increase merge timeout to 20 min (verification tests take 90s)
  - TP-032 scope may have been too large — consider splitting similar tasks
  - The reviewer prompt changes reduced review overhead by ~30%

  Ready to plan the next batch? I see 3 new tasks staged."
```

---

#### Script 9: Supervisor-Managed Integration

**Trigger:** Batch completes (all waves merged to orch branch). Supervisor
takes over the integration flow instead of waiting for the operator to
manually type `/orch-integrate`.

**Goals:**
- Complete the full batch lifecycle without operator intervention
- Respect branch protection and project git workflow
- Handle conflicts, PR creation, review, and merge
- Report final outcome

**Configuration (set during onboarding Script 5, or later via settings):**

```yaml
integration:
  mode: "supervised"   # manual | supervised | auto
```

| Mode | Behavior |
|------|----------|
| `manual` | Current behavior — supervisor tells operator to run `/orch-integrate`. Operator does it themselves. |
| `supervised` | Supervisor proposes integration strategy, explains what it will do, and asks for confirmation before executing. |
| `auto` | Supervisor executes integration without asking. Pauses only if it hits something it can't resolve (complex conflicts, failed CI). |

**Conversation script (supervised mode):**
```
Supervisor: "🏁 Batch complete! All 11 tasks succeeded. Here's my
            integration plan:

            Your branch: main (protected — requires PR)
            Orch branch: orch/henrylach-20260320T111421
            Strategy: Create PR → wait for CI → squash merge

            I'll:
            1. Sync the orch branch with main (in case main advanced)
            2. Push the orch branch to origin
            3. Create a PR targeting main
            4. Wait for CI to pass
            5. Merge the PR (squash)
            6. Clean up the orch branch

            Ready to proceed?"

Operator: "Go for it"

Supervisor: "Syncing orch branch with main..."
            "PR #115 created. CI running..."
            "CI passed. Merging..."
            "✅ Integrated! 42 commits squashed into main. Orch branch
            cleaned up. Here's the batch summary: [...]"
```

**Conversation script (auto mode):**
```
Supervisor: "🏁 Batch complete! Integrating automatically...
            Syncing orch branch → PR #115 created → CI passing →
            Merged to main. ✅

            Batch summary: 11/11 tasks, $127.43, 10h 33m.
            2 incidents recovered automatically."
```

**Conflict handling during integration:**
```
[Supervisor syncs orch branch, discovers conflicts with main]

Supervisor: "The orch branch has conflicts with main — someone pushed
            changes to main while the batch was running. Let me analyze...

            Conflicts in 2 files:
            - extensions/taskplane/types.ts (comment differences — trivial)
            - README.md (both sides added a section — needs decision)

            I can resolve types.ts automatically (keep orch version).
            For README.md, should I:
            1. Keep both additions (merge both sections)
            2. Keep the orch branch version
            3. Show you the diff and let you decide?"
```

**PR review (when supervisor has autonomy):**

In auto mode, the supervisor can also review the PR diff before merging — a
final sanity check that the batch's combined output makes sense:

```
Supervisor: "PR #115 ready. Quick review of the combined diff:
            - 30,681 additions across 298 files
            - 24 new test files (1661 tests, all passing)
            - 11 new modules: diagnostics, quality-gate, verification...
            - No changes to protected docs
            Looks clean. Merging."
```

**Edge cases:**
- **CI fails on PR:** Supervisor reports the failure, attempts diagnosis
  (read CI logs), suggests fixes or asks operator
- **PR has merge conflicts after CI:** Re-sync and retry
- **Branch protection requires specific reviewers:** Supervisor can't approve
  its own PR. Reports this and asks operator to approve, or tags the required
  reviewers
- **Operator changes mind:** "Actually, don't merge yet — I want to review
  first." Supervisor acknowledges and leaves the PR open.

---

### 14.3 Script Maintenance

Scripts ship as part of the supervisor primer (`extensions/taskplane/supervisor-primer.md`)
and update via `pi update`. As we learn from real user interactions:

- New scripts are added for scenarios we didn't anticipate
- Existing scripts are refined based on where users get confused
- Project type detection heuristics improve (new languages, frameworks)
- Convention detection gets smarter (more commit formats, branch patterns)

Scripts are conversational guides, not rigid flows. The supervisor adapts based
on what the user says and what it discovers. If the user says "just give me the
defaults and let me tweak later," the supervisor respects that and skips the
detailed discussions.

### 14.4 Replacing `taskplane init`

Once supervisor-led onboarding is stable, `taskplane init` becomes a thin
fallback for non-interactive scenarios (CI, scripting, headless setup). The
interactive path becomes:

```
Current:  npm install taskplane → taskplane init → manually fix config → create tasks → /orch
Proposed: npm install taskplane → pi → /orch → supervisor guides everything
```

The CLI `taskplane init` command would remain for:
- CI/CD pipelines that need non-interactive setup
- `--preset` mode for known project types
- Users who prefer CLI over conversation

But the recommended path for new users would be: "Install Taskplane, open pi,
type `/orch`, and let the supervisor guide you."
