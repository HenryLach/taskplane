# Watchdog & Recovery Tiers

> **Status:** Draft v1  
> **Created:** 2026-03-20  
> **Related:** [resilience-and-diagnostics-roadmap.md](resilience-and-diagnostics-roadmap.md), [polyrepo-workspace-implementation.md](polyrepo-workspace-implementation.md)  
> **Inspired by:** [Overstory](https://github.com/jayminwest/overstory) tiered watchdog model, [Gastown](https://github.com/steveyegge/gastown) coordinator pattern

---

## 1. Problem Statement

Taskplane's orchestrator is deterministic code — it plans well and executes
reliably on the happy path. But when failures occur (merge timeout, session
crash, stale state), recovery requires a human operator to diagnose, intervene,
and restart. If the operator is away, the batch sits paused for hours.

**Real incident (2026-03-20):** Wave 2 merge agent timed out at 600s. Batch
paused. On `/orch-resume`, the resume logic skipped wave 2's merge entirely
(bug #102) because all tasks showed `.DONE`. Wave 3 started against a codebase
missing wave 2's code. Required ~30 minutes of manual recovery: kill sessions,
manually merge lane branches, resolve conflicts, edit batch state JSON, clear
stale session names. All of these steps were deterministic.

**Core insight:** Most recovery steps don't require LLM judgment — they follow
known patterns. An LLM is only needed when the failure is ambiguous or the
recovery requires understanding code semantics (e.g., complex merge conflicts).

---

## 2. Design Principles

1. **Deterministic first, LLM only when necessary.** Known failure patterns
   get code-level handlers. LLM triage is a fallback for ambiguous cases.

2. **Tiered escalation.** Each tier handles what it can and escalates what it
   can't. No tier operates beyond its authority.

3. **Bounded cost.** No always-on LLM agents for monitoring. Tier 0 is free
   (code). Tier 1 is a single bounded LLM call per incident. Tier 2 is opt-in.

4. **Observable and auditable.** Every recovery action is logged with what was
   detected, what was attempted, and what the outcome was.

5. **Operator remains in control.** Tiers 0 and 1 can be fully disabled. The
   system degrades to current behavior (pause and wait for human) when
   recovery features are off.

---

## 3. Architecture Overview

```
Engine (engine.ts)
│
├── Normal execution path
│   ├── Wave loop (plan → execute → merge → cleanup → advance)
│   └── Poll loop (STATUS.md, .DONE, session liveness)
│
├── Tier 0: Mechanical Watchdog (deterministic code, no LLM)
│   ├── Liveness monitor — detect crashed/stalled sessions
│   ├── Merge timeout handler — retry with backoff
│   ├── Cleanup recovery — force-remove stale worktrees/branches
│   ├── State consistency checker — detect skipped merges, stale session refs
│   └── Recovery playbook — execute known recovery patterns automatically
│
├── Tier 1: Failure Triage (bounded LLM call, single prompt)
│   ├── Invoked ONLY when Tier 0 cannot classify or resolve
│   ├── Receives structured failure context + available strategies
│   ├── Returns strategy selection + confidence
│   └── Execution is still deterministic (code runs the selected strategy)
│
└── Tier 2: Fleet Patrol Agent (opt-in, LLM agent session)
    ├── Periodic deep health assessment
    ├── Cross-wave pattern detection
    ├── Proactive intervention recommendations
    └── Bounded authority (read-only by default)
```

---

## 4. Tier 0 — Mechanical Watchdog

**Cost:** Zero (deterministic TypeScript code)  
**Authority:** Full automatic recovery for known failure patterns  
**Always enabled:** Yes (part of the engine)

### 4.1 What Tier 0 Monitors

| Signal | Detection Method | Frequency |
|--------|-----------------|-----------|
| Session liveness | `tmux has-session -t {name}` | Every poll tick (5s default) |
| Merge agent timeout | Wall-clock timer vs `merge.timeoutMinutes` | During merge phase |
| Stall detection | STATUS.md unchanged for `stallTimeout` minutes | Every poll tick |
| Worktree health | `git worktree list` + directory existence | Before wave start |
| Branch consistency | Lane branches exist, orch branch ref valid | Before merge, after resume |
| State coherence | mergeResults aligns with currentWaveIndex | On resume, after merge |
| .DONE vs merge status | All tasks done but merge missing → flag | On wave transition |

### 4.2 Recovery Playbook

Each known failure pattern maps to a deterministic recovery sequence:

#### Pattern 1: Merge Agent Timeout

```
Trigger: Merge agent exceeds timeoutMs
Current behavior: Kill session, pause batch
Tier 0 recovery:
  1. Kill the merge agent session
  2. Check if merge result file was partially written
  3. If merge result exists and status=SUCCESS → accept it (agent was slow writing)
  4. If no result → retry merge with 2x timeout (up to configured max)
  5. If retry fails → pause with diagnostic
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
  5. If not retryable or max retries hit → mark failed, preserve branch
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
  6. If commits missing and branches gone → mark wave failed, pause with diagnostic
```

#### Pattern 4: Stale Worktree Blocks Wave Start

```
Trigger: git worktree add fails because path exists
Current behavior: Wave fails, batch pauses
Tier 0 recovery:
  1. Try git worktree remove --force
  2. If fails → rm -rf + git worktree prune
  3. Retry git worktree add
  4. If still fails → pause with diagnostic
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
Current behavior: Varies — sometimes cleanup-stale, sometimes crash
Tier 0 recovery:
  1. Attempt parse → if JSON invalid, check for .tmp file (interrupted atomic write)
  2. If .tmp exists and valid → promote to batch-state.json
  3. If no .tmp → attempt recovery from last known good state (if journaled)
  4. If unrecoverable → pause with diagnostic, never auto-delete
```

### 4.3 Retry Budget

Each recovery pattern has a bounded retry budget to prevent infinite loops:

```typescript
interface RetryBudget {
  mergeTimeout: { maxRetries: 2, backoffMultiplier: 2.0 };
  workerCrash:  { maxRetries: 1, cooldownMs: 5000 };
  worktreeStale:{ maxRetries: 1, cooldownMs: 2000 };
  resumeMerge:  { maxRetries: 1, cooldownMs: 0 };
}
```

Retry counters persist in batch state (`resilience.retryCountByScope`) so
they survive across pause/resume cycles.

### 4.4 Implementation Location

Tier 0 lives entirely within the existing engine:

| Component | File | Changes |
|-----------|------|---------|
| Merge retry | `merge.ts` | Wrap `waitForMergeResult` with retry loop |
| Session crash handler | `execution.ts` | Check for partial progress before marking failed |
| Resume merge check | `resume.ts` | Verify mergeResults before skipping wave |
| Stale session cleanup | `resume.ts` | Clear sessionName for pending tasks with dead sessions |
| Worktree recovery | `worktree.ts` | Add force-cleanup-and-retry to provisioning |
| State coherence | `persistence.ts` | Validate mergeResults vs waveIndex on load |

---

## 5. Tier 1 — Failure Triage

**Cost:** One LLM API call per incident (~$0.01-0.05 depending on context size)  
**Authority:** Selects from predefined recovery strategies; does NOT execute code  
**Enabled by default:** Yes (but can be disabled via config)

### 5.1 When Tier 1 is Invoked

Tier 1 is called **only** when Tier 0 encounters a failure it cannot classify
or when all Tier 0 recovery strategies have been exhausted:

```
Tier 0 detects failure
  → Checks playbook for matching pattern
  → If match found → execute recovery (no Tier 1)
  → If no match OR recovery exhausted → invoke Tier 1
```

### 5.2 Triage Prompt Design

Tier 1 is NOT an agent session. It is a single, focused LLM call with
structured input and structured output:

**Input (structured context):**

```json
{
  "failure": {
    "type": "merge_timeout",
    "wave": 2,
    "lane": 2,
    "repoId": "default",
    "duration": 600,
    "configuredTimeout": 600,
    "mergeAgentSession": "orch-henrylach-merge-2",
    "laneBranch": "task/henrylach-lane-2-20260319T140046",
    "orchBranch": "orch/henrylach-20260319T140046"
  },
  "context": {
    "batchPhase": "merging",
    "waveIndex": 1,
    "completedWaves": 1,
    "totalWaves": 4,
    "tasksInWave": ["TP-026", "TP-030", "TP-034"],
    "taskStatuses": { "TP-026": "succeeded", "TP-030": "succeeded", "TP-034": "succeeded" },
    "tier0Attempts": [
      { "strategy": "merge_retry", "result": "timeout_again", "duration": 1200 }
    ]
  },
  "availableStrategies": [
    {
      "id": "manual_merge",
      "description": "Manually merge lane branches into orch branch using git merge",
      "risk": "low",
      "requirements": ["lane branches exist", "orch branch exists"]
    },
    {
      "id": "skip_wave_merge",
      "description": "Skip merge for this wave, advance to next wave",
      "risk": "high",
      "requirements": ["accepting that wave work will be lost"]
    },
    {
      "id": "pause_for_operator",
      "description": "Pause batch and wait for human intervention",
      "risk": "none",
      "requirements": []
    },
    {
      "id": "increase_timeout_retry",
      "description": "Double the merge timeout and retry",
      "risk": "low",
      "requirements": ["merge agent not fundamentally broken"]
    }
  ]
}
```

**Output (structured selection):**

```json
{
  "selectedStrategy": "manual_merge",
  "confidence": "high",
  "reasoning": "Tier 0 already retried with 2x timeout and failed. Lane branches exist with completed work. Manual merge avoids losing hours of task work. Risk is low since merge conflicts, if any, will be in non-overlapping files.",
  "fallbackStrategy": "pause_for_operator"
}
```

**Key constraint:** The LLM selects a strategy. The deterministic code executes
it. The LLM never runs commands, edits files, or touches git directly.

### 5.3 Strategy Execution

After Tier 1 returns a selection, Tier 0 code executes the strategy:

```typescript
switch (triageResult.selectedStrategy) {
  case "manual_merge":
    return executeManualMerge(failureContext);  // deterministic code
  case "increase_timeout_retry":
    return retryMergeWithTimeout(failureContext, currentTimeout * 2);
  case "skip_wave_merge":
    return skipWaveMerge(failureContext);  // mark wave failed, advance
  case "pause_for_operator":
    return pauseForOperator(failureContext);
}
```

### 5.4 Triage for Merge Conflicts

The one area where Tier 1 adds real value beyond pattern matching is merge
conflict assessment. When a manual merge produces conflicts:

```json
{
  "failure": {
    "type": "merge_conflict",
    "conflictFiles": [
      "extensions/taskplane/types.ts",
      "extensions/taskplane/persistence.ts"
    ],
    "conflictDetails": [
      {
        "file": "extensions/taskplane/types.ts",
        "markers": 3,
        "oursContext": "TP-030 added exitDiagnostic with v3 JSDoc",
        "theirsContext": "TP-026 added exitDiagnostic with transition JSDoc"
      }
    ]
  },
  "availableStrategies": [
    {
      "id": "accept_ours",
      "description": "Accept current branch (orch) version for all conflicts"
    },
    {
      "id": "accept_theirs",
      "description": "Accept incoming branch (lane) version for all conflicts"
    },
    {
      "id": "delegate_to_merge_agent",
      "description": "Spawn merge agent with conflict context for semantic resolution"
    },
    {
      "id": "pause_for_operator",
      "description": "Pause and let human resolve conflicts"
    }
  ]
}
```

For tonight's incident, the conflicts were all JSDoc comment differences where
both tasks added the same field. Tier 1 could have identified this as
"comment-only conflicts on identical structural additions" and selected
`accept_ours` (take the canonical v3 schema version) with high confidence.

### 5.5 Configuration

```yaml
resilience:
  tier1_triage:
    enabled: true
    model: ""                    # empty = use default model
    max_calls_per_batch: 5       # prevent runaway triage cost
    confidence_threshold: 0.7    # below this → fall back to pause_for_operator
```

---

## 6. Tier 2 — Fleet Patrol Agent

**Cost:** Ongoing LLM session (~$0.50-2.00/hour depending on activity)  
**Authority:** Read-only by default; can recommend actions  
**Enabled by default:** No (opt-in for complex/long-running batches)

### 6.1 What Fleet Patrol Does

Tier 2 is an LLM agent that runs alongside the orchestrator and provides
continuous health monitoring that goes beyond Tier 0's mechanical checks:

- **Cross-wave pattern detection:** "Wave 2 and Wave 3 both had merge timeouts
  on the same repo — the verification tests are likely slow, not the merge itself"
- **Cost trajectory analysis:** "At current token consumption rate, this batch
  will cost ~$45. Wave 3 has 4 tasks with review level 2 — expect another ~$15"
- **Proactive stall detection:** "TP-032's worker has made 0 progress in 3
  iterations but hasn't hit no_progress_limit yet. The task may be fundamentally
  blocked."
- **Recovery recommendations:** "TP-031 failed because it imported from
  `diagnostics.ts` which was added by TP-025 but the worktree was force-cleaned.
  Recommend: re-provision worktree from orch branch tip."

### 6.2 What Fleet Patrol Does NOT Do

- Does not execute recovery actions (that's Tier 0/1)
- Does not modify files, run git commands, or edit batch state
- Does not spawn or kill agents
- Does not make decisions — it recommends, the operator or Tier 0/1 acts

### 6.3 Communication Model

Fleet Patrol communicates through structured files, not inter-process messaging:

```
.pi/fleet-patrol/
├── health-report.json        ← Updated every patrol cycle
├── recommendations.json      ← Actionable items for operator/Tier 0
└── observations.jsonl        ← Append-only log of observations
```

The engine checks `recommendations.json` on each poll tick and can auto-apply
recommendations tagged as `auto_safe: true` (if configured to do so).

### 6.4 Implementation Approach

Fleet Patrol is a pi session running the fleet-patrol agent prompt, launched
in a tmux session alongside the lane sessions:

```
tmux sessions during a batch:
  orch-henrylach-lane-1        ← worker execution
  orch-henrylach-lane-2        ← worker execution
  orch-henrylach-fleet-patrol  ← Tier 2 (optional)
```

The agent prompt instructs it to:
1. Read batch state and telemetry sidecars periodically
2. Analyze trends (cost, progress, failure patterns)
3. Write structured observations and recommendations
4. Never execute actions directly

### 6.5 Configuration

```yaml
resilience:
  fleet_patrol:
    enabled: false
    model: ""
    patrol_interval_minutes: 5
    auto_apply_safe_recommendations: false
```

---

## 7. Tier Interaction Model

```
Failure occurs
    │
    ▼
Tier 0: Pattern match in playbook?
    │
    ├── YES → Execute recovery → Log result → Continue
    │         (e.g., retry merge, clean worktree, save branch)
    │
    └── NO (or recovery exhausted)
         │
         ▼
    Tier 1 enabled?
         │
         ├── YES → Single LLM call with structured context
         │         → Returns strategy selection
         │         → Tier 0 executes selected strategy
         │         → Log result → Continue or pause
         │
         └── NO → Pause batch → Wait for operator
              │
              ▼
         Tier 2 running? (if enabled)
              │
              ├── YES → Fleet Patrol observes failure
              │         → Writes recommendation to file
              │         → Operator reads recommendation
              │
              └── NO → Standard pause behavior (current)
```

### Escalation Rules

1. Tier 0 **always** runs first. It's free and handles most cases.
2. Tier 1 is invoked **at most once per failure incident** (not per retry).
3. If Tier 1's selected strategy fails, the batch pauses. No further automatic
   escalation.
4. Tier 2 is advisory only — it never triggers recovery actions autonomously
   unless `auto_apply_safe_recommendations` is enabled.

### Cost Ceiling

Worst case per incident: one Tier 1 call (~$0.05). Worst case per batch:
`max_calls_per_batch` × $0.05 = $0.25 at default (5 calls).

Fleet Patrol, if enabled, runs as a continuous session but can be capped with
`max_worker_minutes` like any other agent.

---

## 8. Recovery Playbook: Full Pattern Catalog

Based on all observed incidents (14 in the incident ledger + tonight's):

| Pattern | Tier 0 Strategy | Tier 1 Fallback |
|---------|----------------|-----------------|
| Merge agent timeout | Retry with 2x timeout (max 2 retries) | Manual merge or pause |
| Worker session crash | Save branch, classify exit, retry if retryable | Assess if task is recoverable |
| Resume skips wave merge (#102) | Detect missing merge, re-attempt | — (always deterministic) |
| Stale worktree blocks provisioning | Force cleanup + prune + retry | — (always deterministic) |
| Stale session names on resume (#102b) | Clear sessionName for pending tasks | — (always deterministic) |
| Merge conflict (trivial) | Accept canonical version (later task's schema) | Classify conflict complexity |
| Merge conflict (complex) | Pause | Delegate to merge agent with conflict context |
| Pre-existing test failures block merge | Baseline comparison (Phase 4) | — (deterministic with baselines) |
| Terminal state traps resume | Force-resume policy (Phase 3) | — (deterministic) |
| Batch state corruption | Promote .tmp, journal recovery | Assess recoverability |
| Context overflow (worker) | Fresh iteration (existing behavior) | — (existing) |
| API rate limit | Cooldown + retry (existing in pi) | — (existing) |
| Windows file locks | Retry with delay, force-remove fallback | — (deterministic) |
| Worker makes no progress | Existing no_progress_limit | Assess if task scope is wrong |

---

## 9. Observability

Every tier produces structured diagnostic output:

### Tier 0 Event Log

```jsonl
{"ts":"2026-03-20T02:15:00Z","tier":0,"pattern":"merge_timeout","action":"retry","attempt":1,"timeout":1200000,"result":"timeout_again"}
{"ts":"2026-03-20T02:35:00Z","tier":0,"pattern":"merge_timeout","action":"escalate_tier1","reason":"max_retries_exhausted"}
```

### Tier 1 Triage Record

```jsonl
{"ts":"2026-03-20T02:35:05Z","tier":1,"input_tokens":1200,"output_tokens":150,"cost":0.02,"selected":"manual_merge","confidence":"high","reasoning":"..."}
```

### Tier 2 Observation Log

```jsonl
{"ts":"2026-03-20T02:40:00Z","tier":2,"type":"pattern","observation":"Merge timeouts correlating with verification test duration","recommendation":{"action":"increase_merge_timeout","value":2400,"auto_safe":true}}
```

All logs written to `.pi/watchdog/` directory, scoped by batch:
```
.pi/watchdog/{opId}-{batchId}-tier0.jsonl
.pi/watchdog/{opId}-{batchId}-tier1.jsonl
.pi/watchdog/{opId}-{batchId}-tier2.jsonl
```

---

## 10. Implementation Priority

### Immediate (fix the bugs that caused tonight's incident)

- Fix #102: Resume checks mergeResults before skipping wave
- Fix #102b: Clear sessionName for pending tasks with dead sessions
- Add merge timeout retry with backoff (Pattern 1)

### Phase 1 (Tier 0 core — pure code, no LLM)

- Implement recovery playbook patterns 1-6
- Add retry budget to batch state
- Add Tier 0 event logging
- Add state coherence validation on resume

### Phase 2 (Tier 1 triage — bounded LLM)

- Design triage prompt template
- Implement single-call triage invocation
- Strategy execution dispatcher
- Triage record logging
- Configuration and kill switch

### Phase 3 (Tier 2 fleet patrol — opt-in agent)

- Fleet patrol agent prompt design
- Tmux session lifecycle (start/stop alongside batch)
- Observation and recommendation file protocol
- Auto-apply for safe recommendations
- Cost tracking for patrol sessions

---

## 11. Comparison with Other Systems

| Concern | Taskplane (proposed) | Overstory | Gastown |
|---------|---------------------|-----------|---------|
| Orchestration | Deterministic code | LLM coordinator agent | LLM Mayor agent |
| Monitoring | Tier 0 code + optional Tier 2 agent | 3-tier watchdog (daemon + AI triage + monitor agent) | Mayor monitors Polecats |
| Recovery | Code-first with LLM triage fallback | AI-assisted triage + monitor intervention | Mayor reassigns/retries |
| Cost overhead | Near-zero (Tier 0) to ~$0.25/batch (Tier 1) | Continuous coordinator + monitor sessions | Continuous Mayor session |
| Determinism | High (code handles most cases) | Medium (LLM coordinator makes decisions) | Low (LLM makes all coordination decisions) |
| Debuggability | Full — read the TypeScript | Moderate — inspect agent transcripts | Low — Mayor's reasoning is opaque |
| Max agents | Bounded by `max_lanes` | Claims 20-30 | Claims 20-30 |

**Taskplane's advantage:** Predictable behavior with surgical LLM use. The
deterministic engine handles 90%+ of cases. Tier 1 handles the remaining ~10%.
Tier 2 is a luxury for operators who want proactive insights on long batches.

---

## 12. Open Questions

1. **Tier 0 retry budget persistence:** Should retry counters reset between
   pause/resume cycles, or accumulate across the batch lifetime?

2. **Tier 1 model selection:** Should triage use the same model as workers, or
   a smaller/cheaper model? The triage prompt is compact — a fast model with
   good instruction following may be ideal.

3. **Tier 2 patrol interval:** 5 minutes default? Too frequent wastes tokens,
   too infrequent misses time-sensitive issues.

4. **Manual merge in Tier 0:** When Tier 0 does a manual merge and hits
   conflicts, should it always escalate to Tier 1, or attempt heuristic
   resolution first (e.g., accept later task's version for comment-only
   conflicts)?

5. **Config reload:** Tonight's incident was worsened because the running
   session didn't pick up the timeout config change. Should the engine re-read
   config before each wave or merge attempt?

6. **Fleet Patrol scope:** Should Tier 2 have access to the telemetry sidecars
   (token counts, tool calls) or only batch state and STATUS.md files? Broader
   access enables better cost analysis but increases the context load.

7. **Cross-batch learning:** Should Tier 2 observations persist across batches
   to build a project-specific failure profile? E.g., "merge verification in
   this repo typically takes 90s, set timeout to 3x that."
