# Lane Agent Design

> **Status:** ⚠️ SUPERSEDED — consolidated into [resilience-and-diagnostics-roadmap.md](resilience-and-diagnostics-roadmap.md) on 2026-03-19.  
> The unique value from this doc (cross-model structured review, STATUS.md reconciliation) is incorporated as Phase 5 (Quality Gate) in the consolidated roadmap. Most other proposals are already implemented in the task-runner.  
> This file is retained for historical reference.
>
> **Created:** 2026-03-11  
> **Last Updated:** 2026-03-11

## 1. Problem Statement

The current orchestrator has a flat execution model: it assigns tasks to lanes, spawns a worker agent per task, and determines success solely by the presence of a `.DONE` file. This creates several gaps:

| Gap | Impact |
|-----|--------|
| No quality evaluation of worker output | `.DONE` exists ≠ work is correct |
| No cross-model review before merge | Same model reviews its own work (blind spots) |
| No remediation path for partial completions | Task either "succeeded" or "failed" — no retry with feedback |
| Unchecked STATUS.md items for completed work | Cosmetic but erodes trust in progress reporting |
| No detection of stuck workers until timeout | Wasted time and tokens |

## 2. Proposed Architecture

### 2.1 Supervision Hierarchy

```
Orchestrator (batch coordinator)
│
│   Responsibilities:
│   - Wave planning and lane assignment
│   - Dependency resolution
│   - Merge coordination
│   - Batch lifecycle (start → execute → merge → complete)
│
└─── Lane Agent (team lead) ← NEW
     │
     │   Responsibilities:
     │   - Worker lifecycle management (spawn, monitor, terminate)
     │   - Output evaluation and quality gating
     │   - Review/fix cycle coordination
     │   - STATUS.md reconciliation
     │   - .DONE creation authority
     │
     ├─── Worker Agent (implementer)
     │    Current task-runner. Writes code, runs tests, checks STATUS.md boxes.
     │
     ├─── Review Agent (code reviewer)
     │    Different model. Evaluates the complete diff against PROMPT.md requirements.
     │    Produces structured verdict: PASS or NEEDS_FIXES with specifics.
     │
     └─── Fix Agent (remediation)
          Spawned only if review returns NEEDS_FIXES.
          Receives review feedback as input. Makes targeted corrections.
```

### 2.2 Key Principle: Language/Project Agnostic

The orchestrator (including Lane Agents) is a general-purpose tool for any coding project and language. Lane Agents **cannot** assume:

- Programming language or build tools
- Test frameworks or linting tools
- Project structure beyond the task folder

Lane Agents **can** assume:

- `STATUS.md` exists with checkboxes (universal progress contract)
- `PROMPT.md` exists with task requirements
- `.DONE` file is the completion signal
- Git worktrees with branches (one per lane)
- Lane logs capture session output

### 2.3 What Lane Agents Do NOT Do

- **Do not edit files** — they manage agents that edit files
- **Do not decide task scope or dependencies** — that's the orchestrator
- **Do not merge** — that's the merge agent
- **Do not override a PASS verdict** — if review says PASS, the task is done

## 3. Lane Agent Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                     LANE AGENT LIFECYCLE                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. RECEIVE    ← Task assignment from orchestrator           │
│       │                                                      │
│  2. SPAWN      → Start Worker Agent in worktree              │
│       │                                                      │
│  3. MONITOR    ← Poll STATUS.md, lane logs, session health   │
│       │          Detect stuck workers (no progress for N min) │
│       │                                                      │
│  4. WORKER     → Worker session exits                        │
│     EXITS        (or is terminated by lane agent)            │
│       │                                                      │
│  5. EVALUATE   ← Parse STATUS.md completion                  │
│       │          Diff worktree branch                        │
│       │          Spawn Review Agent (different model)        │
│       │                                                      │
│  6. VERDICT    ← Review Agent returns PASS or NEEDS_FIXES   │
│       │                                                      │
│       ├── PASS ──────────────────────────┐                   │
│       │                                  ▼                   │
│       │                          7. FINALIZE                 │
│       │                             Reconcile STATUS.md      │
│       │                             Create .DONE             │
│       │                             Report to orchestrator   │
│       │                                                      │
│       └── NEEDS_FIXES ──┐                                    │
│              │           │                                   │
│              ▼           │                                   │
│       6a. REMEDIATE      │ (if retries remain)               │
│           Write review   │                                   │
│           feedback file  │                                   │
│           Spawn Fix Agent│                                   │
│              │           │                                   │
│              └───► Go to step 5                              │
│                                                              │
│       6b. EXHAUSTED      │ (max retries hit)                 │
│           Reconcile STATUS.md with actual state              │
│           Mark task failed (with review findings)            │
│           Report to orchestrator                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 4. Detailed Phase Design

### 4.1 Phase: Monitor (Step 3)

While the Worker Agent is running, the Lane Agent periodically:

- **Polls STATUS.md** — tracks checkbox progress over time
- **Detects stalls** — if no STATUS.md change for a configurable duration, the worker may be stuck
- **Reads lane logs** — watches for error patterns (optional, future)

**Open Question: Intervention vs. Restart**

Two approaches when a worker is stuck:

| Approach | How | Pros | Cons |
|----------|-----|------|------|
| **Live steering** | Inject guidance into the worker's session | Preserves worker context | Hard to implement; requires IPC with the agent session |
| **Restart with context** | Kill the session, spawn new worker with "here's what the previous attempt produced" | Simple; clean state | Loses accumulated context; costs tokens |

**Current recommendation:** Start with restart-with-context. Live steering is a future enhancement that requires agent protocol support.

**Stall detection parameters (configurable):**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `stall_timeout_minutes` | 10 | No STATUS.md change triggers stall warning |
| `max_stall_restarts` | 1 | How many restart-with-context attempts before failing the task |

### 4.2 Phase: Evaluate (Step 5)

After the Worker Agent exits, the Lane Agent gathers evidence:

**Evidence collected (language-agnostic):**

| Evidence | Source | What It Tells Us |
|----------|--------|-----------------|
| STATUS.md checkbox completion | Parse `- [x]` vs `- [ ]` | Claimed progress |
| Git diff (worktree branch vs base) | `git diff` | Actual file changes |
| Files created/deleted | `git status` | Scope of changes |
| PROMPT.md requirements | Task folder | What was asked |
| Worker exit status | Session monitoring | Clean exit or crash |
| Lane log tail | Log file | Last actions before exit |

**What the Lane Agent does with evidence:**

1. Packages it into a structured review request
2. Spawns a Review Agent (different model) with the evidence
3. Waits for the review verdict

### 4.3 Phase: Review (Step 6)

The Review Agent receives a structured review request and produces a structured verdict.

**Review request contents:**

```
Task Requirements:     [PROMPT.md content]
STATUS.md State:       [Current checkbox state, X/Y completed]
Git Diff:              [Full diff of worktree branch]
Files Changed:         [List of files added/modified/deleted]
Worker Exit:           [Clean exit / crash / stall-terminated]
```

**Review verdict structure:**

```json
{
  "verdict": "PASS" | "NEEDS_FIXES",
  "confidence": "high" | "medium" | "low",
  "summary": "Brief overall assessment",
  "findings": [
    {
      "severity": "critical" | "important" | "suggestion",
      "category": "missing_requirement" | "incorrect_implementation" | "incomplete_work" | "status_mismatch",
      "description": "What's wrong",
      "file": "path/to/file (if applicable)",
      "remediation": "Specific fix instruction"
    }
  ],
  "status_reconciliation": [
    {
      "checkbox": "Original checkbox text",
      "actual_state": "done" | "not_done" | "partial",
      "evidence": "Why we believe this"
    }
  ]
}
```

**Verdict rules:**

- Any `critical` finding → `NEEDS_FIXES`
- 3+ `important` findings → `NEEDS_FIXES`
- Only `suggestion` findings → `PASS` (suggestions logged but don't block)
- `status_mismatch` (box checked but work not done) → always `NEEDS_FIXES`

**Open Question: Review scope boundaries**

The review should be "did the task accomplish what PROMPT.md asked?" — not "is this production-ready code?" The bar is: *would a team lead accept this PR relative to the task requirements?*

### 4.4 Phase: Remediate (Step 6a)

If the review returns `NEEDS_FIXES` and retries remain:

1. Lane Agent writes a `REVIEW_FEEDBACK.md` file into the worktree task folder
2. Spawns a Fix Agent in the same worktree with instructions to:
   - Read `REVIEW_FEEDBACK.md`
   - Address each `critical` and `important` finding
   - Update STATUS.md as items are fixed
   - Create `.DONE` when finished
3. Fix Agent exits → Lane Agent runs another review cycle (step 5)

**REVIEW_FEEDBACK.md format:**

```markdown
# Review Feedback

This task was reviewed after the initial implementation. Address the findings below.

## Critical Findings (must fix)
1. [description] — File: [path] — Fix: [remediation]

## Important Findings (should fix)
1. [description] — File: [path] — Fix: [remediation]

## Suggestions (optional)
1. [description]
```

### 4.5 Phase: Finalize (Step 7)

Regardless of PASS or max-retries-exhausted, the Lane Agent:

1. **Reconciles STATUS.md** — uses `status_reconciliation` from the review to correct any mismatched checkboxes
2. **Creates `.DONE`** (if PASS) or marks task failed (if exhausted)
3. **Writes a lane summary** — structured log of the full lifecycle (worker time, review verdict, fix cycles)
4. **Reports to orchestrator** — task result with metadata

**Important:** The Lane Agent (not the Worker Agent) has final authority over `.DONE` creation. This moves the completion signal from "the worker says it's done" to "the team lead confirms it's done."

## 5. Retry Budget

| Parameter | Default | Description |
|-----------|---------|-------------|
| `max_review_cycles` | 2 | Total review passes (initial + after fix) |
| `max_fix_agents` | 1 | Fix agent spawns before giving up |

**Lifecycle with defaults:**

```
Worker → Review₁ → [PASS] → Done
Worker → Review₁ → [NEEDS_FIXES] → Fix → Review₂ → [PASS] → Done
Worker → Review₁ → [NEEDS_FIXES] → Fix → Review₂ → [NEEDS_FIXES] → Exhausted (fail)
```

The second review is final — no more fix cycles. This prevents infinite loops while giving one genuine shot at remediation.

## 6. Configuration

All Lane Agent parameters should be configurable in `task-orchestrator.yaml`:

```yaml
lane_agent:
  enabled: true                    # false = current behavior (no lane agent)
  review:
    enabled: true                  # Enable post-worker review cycle
    model: "different-model-name"  # Model for Review Agent (cross-model review)
    max_cycles: 2                  # Total review passes
    max_fix_agents: 1              # Fix attempts before failing
    pass_threshold: "no_critical"  # Verdict rule: no_critical | no_important | all_clear
  monitor:
    enabled: true                  # Enable progress monitoring during worker execution
    stall_timeout_minutes: 10      # No STATUS.md progress triggers stall
    max_stall_restarts: 1          # Restart-with-context attempts
  finalize:
    reconcile_status: true         # Auto-fix STATUS.md mismatches
    lane_agent_owns_done: true     # .DONE created by lane agent, not worker
```

**Backward compatibility:** When `lane_agent.enabled: false`, the orchestrator falls back to current behavior — spawn worker, wait for `.DONE`, proceed to merge.

## 7. Implementation Considerations

### 7.1 Lane Agent as Process Model

The Lane Agent is a **TypeScript control loop** (not an LLM agent session). It:

- Runs as async logic within the orchestrator process
- Spawns Worker, Review, and Fix agents as separate sessions (subprocess or tmux)
- Makes deterministic decisions based on structured review output
- Only invokes LLMs indirectly (through the agents it spawns)

**Rationale:** The Lane Agent's decisions are algorithmic (parse review JSON, check retry count, spawn next agent). Using an LLM for this coordination would add latency, cost, and non-determinism without clear benefit.

### 7.2 Review Agent Session Design

The Review Agent needs:

- Read access to the worktree (to examine files)
- The git diff (passed as input or computed by the agent)
- PROMPT.md and STATUS.md content
- A structured output contract (JSON verdict file)

**Output contract:** The Review Agent writes a `REVIEW_VERDICT.json` file to a known path. The Lane Agent reads and parses it. If the file is missing or malformed, the Lane Agent treats it as a PASS (fail-open to avoid blocking the pipeline).

### 7.3 .DONE Authority Transfer

Currently: Worker creates `.DONE` → Orchestrator detects it → task "succeeded"

Proposed: Worker signals completion (session exits cleanly) → Lane Agent evaluates → Lane Agent creates `.DONE` if satisfied

**Migration path:** This can be introduced gradually:
1. First: Lane Agent runs review *after* `.DONE` already exists (additive, non-breaking)
2. Later: Lane Agent takes ownership of `.DONE` creation (requires task-runner change to not create `.DONE`)

## 8. Quality Impact Analysis

**What this catches that the current system doesn't:**

| Issue | Current | With Lane Agent |
|-------|---------|-----------------|
| Checked boxes for incomplete work | Undetected until human review | Review Agent compares diff against STATUS.md claims |
| Missing requirements from PROMPT.md | Undetected | Review Agent compares diff against PROMPT.md |
| Code quality issues | Self-review only (same model blind spots) | Cross-model review catches different issues |
| Partial completions shipped as "done" | `.DONE` exists = success | Review verdict gates `.DONE` creation |
| Stuck workers wasting time | Only timeout detection | Stall detection with restart-with-context |

**What this does NOT catch:**

- Runtime correctness (requires actually running the code — language-specific)
- Integration issues across tasks (that's a merge-time concern)
- Requirements that were wrong in PROMPT.md to begin with

## 9. Open Questions

> Items needing further discussion before implementation.

### 9.1 Review Agent Model Selection

Should the review model be:
- **Configured globally** in `task-orchestrator.yaml`?
- **Configured per-task** in PROMPT.md metadata?
- **Automatically different** from the worker model (system picks the alternative)?

### 9.2 Cost Implications

Each review cycle adds an LLM invocation with a potentially large context (full git diff). For large tasks, this could be significant. Should there be:
- A diff size threshold beyond which review is skipped?
- A cost budget per lane that includes worker + review + fix?

### 9.3 Fix Agent vs. New Worker

When remediation is needed, should the Fix Agent:
- **Work in the same worktree** (incremental fix on top of worker's output)?
- **Start fresh** (new worktree, worker output as reference)?

Current recommendation: same worktree (incremental). Starting fresh wastes the worker's valid output.

### 9.4 Merge-Time Review

Should there be an additional review at merge time? The merge agent currently just does `git merge` + verification commands. Should it also evaluate whether the merged result is coherent across multiple lanes?

This is a different concern from per-task review — it's about cross-task integration. Potentially a separate design.

### 9.5 Reporting and Observability

What should the Lane Agent expose to the dashboard?
- Current phase (monitoring / reviewing / remediating / finalizing)
- Review verdict summary
- Fix cycle count
- Time spent in each phase

---

## Appendix A: Glossary

| Term | Definition |
|------|-----------|
| **Orchestrator** | The batch coordinator. Plans waves, assigns lanes, manages merge. |
| **Lane Agent** | Per-lane supervisor. Manages worker lifecycle and quality gating. |
| **Worker Agent** | The implementer. Current task-runner that writes code and checks STATUS.md boxes. |
| **Review Agent** | Cross-model code reviewer. Evaluates worker output against task requirements. |
| **Fix Agent** | Remediation worker. Addresses specific findings from the Review Agent. |
| **Verdict** | Structured review output: PASS or NEEDS_FIXES with findings. |
| **Review Cycle** | One pass of: evaluate → review → (optionally fix). Max 2 cycles by default. |

## Appendix B: Session Naming Contract (TP-010)

> **Added:** 2026-03-15 — Aligned with TP-010 naming hardening.

Lane Agent supervision relies on TMUX session names being **unique, deterministic, and parseable**. The naming contract (implemented in `naming.ts`) ensures this at team scale.

### Session name structure

```
{tmux_prefix}-{opId}-lane-{N}          (repo mode)
{tmux_prefix}-{opId}-{repoId}-lane-{N} (workspace mode)
```

Worker and reviewer sessions append `-worker` / `-reviewer` to the parent lane session name, inheriting collision resistance automatically.

### Operator identifier (`opId`)

Resolved from (first non-empty): `TASKPLANE_OPERATOR_ID` env → `operator_id` config → OS username → `"op"` fallback.

Sanitized: lowercase, alphanumeric + hyphens, truncated to 12 chars.

### Implications for Lane Agent design

1. **Session discovery:** Lane Agents monitoring worker sessions can use the structured session name to identify ownership. The `opId` token ensures a Lane Agent only manages its operator's sessions.
2. **Cross-operator safety:** Multiple operators can run concurrent batches. Sessions from different operators are distinguishable by `opId` in the name.
3. **Observability:** The token order (`prefix → opId → [repoId] → lane-N`) enables both human readability in `tmux ls` and programmatic parsing via `parseOrchSessionNames()`.
4. **Length budget:** Worst-case TMUX session names stay under 64 characters (see `naming-collision.test.ts` human-readability assertions).

### Related artifacts using the same naming contract

| Artifact | Pattern |
|---|---|
| Worktree dirs | `{worktree_prefix}-{opId}-{N}` |
| Git branches | `task/{opId}-lane-{N}-{batchId}` |
| Merge sessions | `{tmux_prefix}-{opId}-merge-{N}` |
| Merge sidecars | `merge-result-w{W}-lane{L}-{opId}-{batchId}.json` |
| Merge workspace | `merge-workspace-{opId}` |

## Appendix C: Revision History

| Date | Change |
|------|--------|
| 2026-03-11 | Initial draft — supervision hierarchy, lifecycle, review cycle, configuration |
| 2026-03-15 | Added Appendix B — Session naming contract alignment (TP-010) |
