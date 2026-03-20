# Watchdog, Supervisor & Recovery Architecture

> **Status:** Draft v2  
> **Created:** 2026-03-20  
> **Last Updated:** 2026-03-20  
> **Related:** [resilience-and-diagnostics-roadmap.md](resilience-and-diagnostics-roadmap.md), [polyrepo-workspace-implementation.md](polyrepo-workspace-implementation.md)  
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
