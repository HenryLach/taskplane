# Resilience & Diagnostics Roadmap

> **Status:** Consolidated spec — ready for task creation  
> **Created:** 2026-03-19  
> **Supersedes:** `resilience-architecture.md`, `lane-agent-design.md`, `tmux-telemetry-gap.md`  
> **Related:** [polyrepo-workspace-implementation.md](polyrepo-workspace-implementation.md), [architecture](../../../../docs/explanation/architecture.md)

---

## 1. Problem Statement

Taskplane's orchestrator plans and executes well, but when failures occur —
API errors, session crashes, context overflow, merge conflicts — recovery is
manual. The operator spends 30-60 minutes per incident diagnosing, recovering
partial progress, and restarting.

Three gaps combine to make this worse:

1. **No diagnostics.** When a worker session exits, we don't know why. The
   exit reason is a free-text string with no structured data — no exit code,
   no token counts, no error classification.

2. **No automatic recovery.** Known failure classes (API rate limit, stale
   worktree, pre-existing test failures) require the same manual steps every
   time. These patterns are deterministic and should be handled by code.

3. **No quality gate.** Task completion is determined by `.DONE` file presence,
   not by verifying the work actually matches requirements. STATUS.md checkboxes
   may claim completion that the diff doesn't support.

These gaps compound in polyrepo workspaces where failures can occur across
multiple repos, branches, and worktrees simultaneously.

**Goal:** Make the system self-diagnosing, self-recovering for known failures,
and quality-verified — in both repo mode and workspace mode.

---

## 2. Current State

### What works well (as of v0.5.12)

- Wave/dependency planning and parallel lane execution
- Orch-managed branch model (`orch/{opId}-{batchId}`) with safe integration
- Per-repo worktree isolation in workspace mode
- Cross-repo task routing and artifact staging
- Task-runner iteration model: step loop → worker iterations → review gates
- Subprocess mode: full JSON event stream with tokens, context %, tool calls
- STATUS.md progress tracking with stall detection (`no_progress_limit`)
- Dashboard with wave/lane/task progress visualization

### Runtime prerequisite policy (tmux)

**Decision:** Treat tmux as a required runtime dependency for Taskplane
execution commands.

- Commands that execute agents (`/task`, `/orch*`, merge/review worker sessions)
  must fail fast with actionable guidance if tmux is unavailable.
- Non-execution commands (`help`, config rendering, docs, static checks) may run
  without tmux.
- `taskplane doctor` remains the canonical prerequisite check and should provide
  one-step remediation (`taskplane install-tmux`) when missing.

Rationale:
- tmux is already required in practice for orchestrator operation
- consistent process model improves determinism and observability
- attachable sessions improve operator visibility during incidents

### What's missing

| Gap | Impact | Current Workaround |
|-----|--------|-------------------|
| No structured exit diagnostics | Can't distinguish API error from crash from context overflow | Operator guesses from tmux pane tail |
| No partial progress recovery | Commits on failed task's lane branch become unreachable | Manual `git fsck` + cherry-pick |
| No retry intelligence | All non-`.DONE` exits treated identically | Manual restart |
| Cost invisible in `/task` tmux mode | Token counts hardcoded to 0 | None — cost unknown |
| No merge verification baseline | Pre-existing test failures block valid merges | Manual test fixes |
| No transactional merge rollback | Failed merge leaves inconsistent state | Manual branch reset |
| Terminal `failed` phase traps resume | Batch unrecoverable without state deletion | Delete `batch-state.json` and restart |
| No post-completion quality verification | `.DONE` ≠ work is correct | Human review after batch |
| Stale worktrees/branches after cleanup failures | Next batch blocked by orphaned git state | Manual `rm -rf` + `git worktree prune` |

---

## 3. Design Principles

1. **Fail-forward over fail-stop** — Try deterministic repair first; pause
   with diagnostics before terminal failure.

2. **Deterministic first, LLM second** — Known failure classes handled by
   code paths, not model judgment.

3. **Resumability is sacred** — Batch state stays recoverable; terminal
   states require explicit intent.

4. **Transactional safety** — Every merge has rollback or safe-stop semantics.

5. **Scoped authority + full auditability** — Automated actions are bounded,
   logged, and reversible.

6. **Workspace-aware correctness** — Every path, branch, retry counter, and
   diagnostic artifact is scoped to the correct repo, operator, and batch.

7. **Polyrepo-safe by default** — New features must work identically in repo
   mode and workspace mode. No "workspace root ≠ repo root" assumptions.

---

## 4. Failure Taxonomy (Observed — 14 Incidents)

### Category A: Environment / Platform

| # | Failure | Root Cause | Status |
|---|---------|-----------|--------|
| 3 | Windows `nul` file blocks `git clean` | Agent used `2>nul` in bash | ✅ Fixed |
| — | Worktree cleanup race/locks | Windows file/process timing | ✅ Fixed |
| 11 | Stale merge worktree blocks next batch | `git worktree remove` fails on orphaned dir | 🔲 Planned (Phase 2) |
| 14 | `.DONE` files missing after `/orch-integrate` | Deleted during artifact staging | ✅ Fixed (v0.5.12) |

### Category B: State Management

| # | Failure | Root Cause | Status |
|---|---------|-----------|--------|
| 4 | `.DONE` not merged | Created but not committed | ✅ Fixed |
| 7 | Terminal `failed` phase traps resume | No force-resume semantics | 🔲 Planned (Phase 3) |
| 8 | Cached failure replay on resume | State not properly reset | 🔲 Planned (Phase 3) |

### Category C: Verification

| # | Failure | Root Cause | Status |
|---|---------|-----------|--------|
| 6 | Pre-existing failures blocked merge | No baseline comparison | 🔲 Planned (Phase 4) |

### Category D: Planning / Config

| # | Failure | Root Cause | Status |
|---|---------|-----------|--------|
| 1 | False lane serialization from file scopes | Over-broad overlap | ✅ Fixed |
| 2 | Wrong merge base branch | Configured branch drifted | ✅ Fixed |

### Category E: Agent Behavior

| # | Failure | Root Cause | Status |
|---|---------|-----------|--------|
| 9 | STATUS has unchecked system steps | Worker asked to check boxes it doesn't own | 🔲 Planned (Phase 5) |
| 10 | Duplicate definitions during iterations | Iterative edits on stale assumptions | ⚠️ Mitigatable |

### Category F: Observability & Diagnostics

| # | Failure | Root Cause | Status |
|---|---------|-----------|--------|
| 12 | Worker crash with no diagnostics | TMUX mode captures nothing | 🔲 Planned (Phase 1) |
| 13 | Partial progress lost to cleanup | Worktree removed despite lane commits | 🔲 Planned (Phase 2) |

**Total operator time lost to incidents:** ~5.75+ hours

---

## 5. Architecture (Target)

```text
Orchestrator
├── Wave/Lane Planner (existing)
├── Execution Engine (existing)
│   ├── RPC Wrapper (NEW — Phase 1)
│   │   └── Sidecar telemetry JSONL
│   ├── Structured exit diagnostics (NEW — Phase 1)
│   └── Partial progress preservation (NEW — Phase 2)
├── Merge Engine (existing)
│   ├── Verification baseline (NEW — Phase 4)
│   ├── Transaction envelope (NEW — Phase 4)
│   └── Retry/rollback controller (NEW — Phase 4)
├── State Engine (existing)
│   ├── Schema v3 + migration (NEW — Phase 3)
│   ├── Force-resume policy (NEW — Phase 3)
│   └── Cleanup gate (NEW — Phase 2)
├── Quality Gate (NEW — Phase 5)
│   ├── Cross-model structured review
│   ├── STATUS.md reconciliation
│   └── Post-completion verification
└── Dashboard (existing)
    ├── Real-time token/cost telemetry (NEW — Phase 1)
    └── Diagnostic report viewer (NEW — Phase 3)
```

### Naming Contract

All new artifacts (sidecar files, diagnostics, baselines, transaction records)
must be scoped using the existing naming contract from `naming.ts`:

- Operator-scoped: `{opId}` in all artifact paths
- Batch-scoped: `{batchId}` prevents cross-batch collision
- Repo-scoped: `{repoId}` for workspace mode (defaults to `"default"` in repo mode)
- Lane-scoped: `lane-{N}` where applicable

Pattern: `.pi/{artifactType}-{opId}-{batchId}-{repoId}[-lane-{N}].{ext}`

---

## 6. Implementation Phases

### Phase 1 — RPC Wrapper & Structured Diagnostics

**Goal:** Close the telemetry gap. Every worker/reviewer session produces
structured diagnostics regardless of spawn mode.

**Why first:** This is the foundation for all downstream work — retry
intelligence, cost tracking, dashboard telemetry, and quality verification
all need to know what happened in a session.

#### 1a. RPC Wrapper Script

Build `rpc-wrapper.mjs` — a thin Node.js script that:

1. Spawns `pi --mode rpc --no-session` as a child process
2. Sends the `prompt` command via stdin with the worker/reviewer prompt
3. Reads RPC events from stdout
4. Writes events to a sidecar JSONL file for real-time telemetry
5. Writes a final exit summary JSON on process exit
6. Displays minimal progress in the tmux pane (step, iteration, last tool, tokens)

```
tmux session (lane or task-worker)
  └─ rpc-wrapper.mjs
       └─ pi --mode rpc --no-session
            ├─ events → .pi/telemetry/{opId}-{batchId}-{repoId}-lane-{N}.jsonl
            └─ summary → .pi/telemetry/{opId}-{batchId}-{repoId}-lane-{N}-exit.json
```

**Key RPC events to capture:**

| Event | Diagnostic Value |
|-------|-----------------|
| `message_end` (with `usage`) | Token counts, cost per turn |
| `tool_execution_start/end` | Last tool call, tool error detection |
| `auto_retry_start/end` | API error type, retry count, success |
| `auto_compaction_start/end` | Context pressure, near-overflow |
| `agent_end` | Clean completion signal |
| Process exit code | Crash vs clean exit |

**Sidecar JSONL format:**

```jsonl
{"type":"message_end","ts":1773834100,"usage":{"input":1200,"output":500,"cacheRead":45000,"cost":0.014}}
{"type":"tool_execution_start","ts":1773834102,"toolName":"bash","args":"cd extensions && npx vitest run"}
{"type":"auto_retry_start","ts":1773834200,"attempt":1,"delayMs":2000,"error":"529 overloaded"}
```

**Exit summary format:**

```json
{
  "exitCode": 0,
  "exitSignal": null,
  "tokens": { "input": 45000, "output": 12000, "cacheRead": 180000, "cacheWrite": 5000 },
  "cost": 0.52,
  "toolCalls": 47,
  "retries": [{ "attempt": 1, "error": "529 overloaded", "delayMs": 2000, "succeeded": true }],
  "compactions": 1,
  "durationSec": 847,
  "lastToolCall": "bash: cd extensions && npx vitest run",
  "error": null,
  "classification": "completed"
}
```

**Polyrepo considerations:**
- Sidecar paths include `{repoId}` to avoid collisions across repos
- Telemetry files written to workspace `.pi/` (not per-repo `.pi/`)
- Task-runner reads from workspace-aware path when `TASKPLANE_WORKSPACE_ROOT` is set

#### 1b. Structured Exit Classification

Introduce a structured type alongside legacy `exitReason` during transition,
then promote it to canonical in schema v3:

```typescript
interface TaskExitDiagnostic {
  classification:
    | "completed"           // .DONE found
    | "api_error"           // API returned error (auth, rate limit, overload)
    | "context_overflow"    // Hit context window limit
    | "wall_clock_timeout"  // Killed by task-runner timer
    | "process_crash"       // Non-zero exit code, no API error
    | "session_vanished"    // tmux session disappeared, no exit info
    | "stall_timeout"       // No STATUS progress for N iterations
    | "user_killed"         // User manually killed session
    | "unknown";            // Couldn't determine
  exitCode: number | null;
  errorMessage: string | null;
  tokensUsed: TokenCounts | null;
  contextPct: number | null;
  partialProgressCommits: number;
  partialProgressBranch: string | null;
  durationSec: number;
  lastKnownStep: number | null;
  lastKnownCheckbox: string | null;
  repoId: string;           // "default" in repo mode, repo key in workspace mode
}
```

**How classification works:**

The task-runner reads the RPC wrapper's exit summary and classifies:

1. `.DONE` exists → `"completed"`
2. Exit summary has `retries` with final failure → `"api_error"`
3. Exit summary has `compactions` and high context % → `"context_overflow"`
4. Task-runner's own timer killed the session → `"wall_clock_timeout"`
5. Non-zero exit code, no API error indicators → `"process_crash"`
6. No exit summary file found (tmux vanished) → `"session_vanished"`
7. No STATUS.md progress for `no_progress_limit` iterations → `"stall_timeout"`
8. None of the above → `"unknown"`

#### 1c. Task-Runner Integration

Update `spawnAgentTmux()` and the poll loop in `task-runner.ts`:

1. Before spawning, generate sidecar file paths using naming contract
2. Spawn `rpc-wrapper.mjs` instead of `pi -p` in the tmux session
3. During polling, tail the sidecar JSONL for dashboard telemetry updates
4. After session exit, read exit summary for structured `TaskExitDiagnostic`
5. Persist diagnostic in `batch-state.json` task outcome as additive field
   (`exitDiagnostic`) while preserving legacy `exitReason` for compatibility
   until Phase 3 schema migration

#### 1d. Dashboard Telemetry

Update the dashboard to display real-time telemetry from sidecar files:

| Metric | Source | Update Frequency |
|--------|--------|-----------------|
| Tokens (input/output/cache) | `message_end.usage` | Per LLM turn (~30-60s) |
| Cost ($) per lane | `message_end.usage.cost` | Per LLM turn |
| Batch total cost ($) | Sum of all lane costs | Per poll interval |
| Context utilization % | Cumulative tokens vs model window | Per LLM turn |
| Last tool call | `tool_execution_start` | Per tool call |
| Active API retries | `auto_retry_start/end` | On retry events |
| Compaction count | `auto_compaction_end` | On compaction |

**Cost accuracy:** The batch cost must include ALL token expenditure — worker
turns, reviewer turns, merge agent turns, auto-retries, and compactions. The
RPC event stream includes retries and compactions automatically. Merge agents
also need the RPC wrapper treatment for complete cost tracking.

**Polyrepo considerations:**
- Dashboard already shows per-repo lane grouping
- Token/cost metrics attributed per-lane (which is per-repo)
- Batch total cost sums across all repos

#### 1e. Telemetry Data Hygiene (Redaction)

Telemetry sidecars and exit summaries must never persist secrets.

Redaction policy before writing sidecar/summary files:
- Strip or mask known secret-bearing env var names (`*_KEY`, `*_TOKEN`, `*_SECRET`)
- Redact auth headers and bearer tokens in tool arguments/output
- Truncate large command arguments to a safe preview length
- Record tool name + high-level operation, not full sensitive payloads

Retention policy:
- Telemetry files are diagnostic artifacts, not permanent logs
- Keep for the active batch lifecycle by default
- Provide optional retention config for operators who need longer history

#### 1f. Unify Spawn Paths (Optional Simplification)

`/orch` already forces `TASK_RUNNER_SPAWN_MODE: "subprocess"` for worker/reviewer
execution inside lane tmux sessions.

**Phase 1 non-goal:** do not alter this proven `/orch` execution path.

Phase 1 scope for RPC wrapper:
- `/task` tmux worker/reviewer sessions (close current diagnostic gap)
- merge/review agent tmux sessions where telemetry is currently absent

After Phase 1 hardening, we may evaluate full spawn-path unification as a
separate decision. It must be explicitly benchmarked for compatibility,
reliability, and operator visibility before adoption.

---

### Phase 2 — Progress Recovery & Cleanup Resilience

**Goal:** Preserve partial progress when tasks fail. Clean up reliably.

#### 2a. Partial Progress Preservation

When a task fails without `.DONE` but has commits on its lane branch:

1. Count commits ahead of base branch: `git rev-list --count {base}..{lane}`
2. If commits > 0:
   - Record commit count and branch name in task outcome
   - Save the branch: `git branch saved/{opId}-{taskId}-{batchId} {lane}`
   - Log: "Task {id} failed but has {N} commits of partial progress on saved/{...}"
3. Do NOT delete the lane branch during worktree cleanup

**Polyrepo considerations:**
- Saved branches are per-repo (branch exists in the repo the task executed in)
- In workspace mode, the task's `resolvedRepoId` determines which repo to check
- The save operation must use the correct repo root, not workspace root
- Saved branch naming includes `{repoId}` in workspace mode:
  `saved/{opId}-{taskId}-{batchId}` in repo mode,
  `saved/{opId}-{repoId}-{taskId}-{batchId}` in workspace mode

#### 2b. Stale Worktree Cleanup Fallback

When `git worktree remove` fails (orphaned dir, Windows locks):

1. Try `git worktree remove --force {path}`
2. If still fails, fall back to `rm -rf {path}` (or `rd /s /q` on Windows)
3. Run `git worktree prune` to clean git's internal worktree registry
4. Log the fallback path taken for diagnostics

This pattern already exists in `forceCleanupWorktree()` for lane worktrees.
Extend it to merge worktrees and batch-scoped container directories.

**Polyrepo considerations:**
- Cleanup must iterate over ALL workspace repos, not just the config repo
- Issue #93 (lane worktrees not cleaned in non-final-wave repos) is addressed
  here — cleanup runs for every repo that had lanes in any wave
- Empty `.worktrees/` parent directories should be removed after all lane
  worktrees in a repo are cleaned

#### 2c. Post-Merge Cleanup Gate

A successful merge is not sufficient to advance the batch. Cleanup is part of
the wave finalization:

1. Merge lane branches into orch branch
2. Run verification (if configured)
3. Clean up worktrees and lane branches in ALL repos for this wave
4. Only then mark wave complete and permit next-wave execution

If cleanup fails:
- Keep merged commits intact
- Force batch phase to `paused`
- Block transition to next wave
- Emit diagnostic with exact manual recovery commands

#### 2d. Polyrepo Cleanup Acceptance Criteria

After `/orch-integrate`, a run is only "clean" if all conditions hold:

1. No registered lane worktrees remain in any workspace repo (`git worktree list`)
2. No lane branches remain in any workspace repo (`task/{opId}-lane-*`)
3. No orch branch remains in any workspace repo (`orch/{opId}-{batchId}`)
4. No stale autostash entry from current batch remains in any repo
5. No non-empty `.worktrees/` containers remain in any repo

If any condition fails, classify as `cleanup_post_merge_failed`, record the
repo-specific failures, and keep phase `paused` until remediation succeeds.

---

### Phase 3 — State Resilience & Force-Resume

**Goal:** Make the batch state schema extensible and prevent terminal-state traps.

#### 3a. State Schema v3

Extend `.pi/batch-state.json` with resilience and diagnostic fields:

```json
{
  "schemaVersion": 3,
  "resilience": {
    "resumeForced": false,
    "retryCountByScope": { "shared-libs:w0:l1": 1 },
    "lastFailureClass": "api_error",
    "repairHistory": [
      {
        "id": "r-20260319-001",
        "strategy": "stale-worktree-cleanup",
        "status": "succeeded",
        "repoId": "shared-libs",
        "startedAt": 1773932000000,
        "endedAt": 1773932010000
      }
    ]
  },
  "diagnostics": {
    "taskExits": {
      "TP-001": { "classification": "completed", "cost": 0.52, "durationSec": 180 },
      "TP-002": { "classification": "api_error", "cost": 0.31, "retries": 2 }
    },
    "batchCost": 4.27
  }
}
```

**Migration rules:**
- `v1/v2 → v3`: default missing fields conservatively (`retryCount=0`, no diagnostics)
- During transition, preserve legacy `exitReason` while adding `exitDiagnostic`
  (readers should prefer `exitDiagnostic` when present)
- Unknown fields: preserve on read/write roundtrip
- Corrupt/unparseable state: enter `paused` with diagnostic, never auto-delete

**Compatibility contract:**
- New runtime resumes older states
- Old runtime reading v3: explicit version mismatch error with upgrade guidance

#### 3b. Force-Resume Policy

`/orch-resume --force` must:

1. Run pre-resume diagnostics (worktree health, branch consistency, state coherence)
2. Record force intent: `resilience.resumeForced = true`
3. Reset to `paused` phase only after diagnostics pass
4. Merge failure defaults to `paused` (not `failed`) — `failed` reserved for
   unrecoverable invariant violations after retry exhaustion

**Resume eligibility matrix:**

| Phase | Eligible | Notes |
|---|---|---|
| `paused` | ✅ | Standard resume |
| `executing` | ✅ | Crash recovery |
| `merging` | ✅ | Interrupted merge recovery |
| `stopped` | ⚠️ | `--force` only |
| `failed` | ⚠️ | `--force` only |
| `completed` | ❌ | Terminal |

#### 3c. Diagnostic Reports

Every batch completion/failure produces a structured diagnostic:

1. **JSONL event log:** `.pi/diagnostics/{opId}-{batchId}-events.jsonl`
2. **Human-readable summary:** `.pi/diagnostics/{opId}-{batchId}-report.md`

Event schema:

```json
{
  "ts": "2026-03-19T14:21:00Z",
  "batchId": "20260319T110033",
  "operatorId": "henrylach",
  "repoId": "shared-libs",
  "wave": 1,
  "lane": 2,
  "action": "task_exit",
  "classification": "completed",
  "cost": 0.52,
  "tokens": { "input": 45000, "output": 12000 }
}
```

**Polyrepo considerations:**
- All diagnostic files live in workspace `.pi/diagnostics/`, not per-repo
- Events include `repoId` for filtering and attribution
- Report includes per-repo summary section

---

### Phase 4 — Merge Verification & Transaction Safety

**Goal:** Prevent bad merges from advancing, and safely roll back when they do.

#### 4a. Verification Baseline Strategy

Before each wave merge, capture a verification baseline per repo:

1. Run configured verification commands (`testing.commands` from config)
2. Parse results into normalized fingerprints:
   ```json
   {
     "commandId": "verify.tests",
     "file": "tests/orch-pure-functions.test.ts",
     "case": "Orchestrator Pure Functions > passes all assertions",
     "kind": "assertion_error",
     "messageNorm": "Function not found in source"
   }
   ```
3. Store as: `.pi/verification/{opId}/baseline-b{batchId}-repo-{repoId}-wave-{n}.json`

After merge, capture post-merge fingerprints. New failures = post - baseline.

**Flaky handling:**
- Re-run failed commands once
- If failure disappears: classify `flaky_suspected`, warn but don't block
- If persistent: classify `new_failure`, block merge

**Baseline unavailable:**
- Strict mode: pause with diagnostic
- Permissive mode: continue with current verification behavior
- Default: strict (fail-safe)

**Polyrepo considerations:**
- Baselines are per-repo — each repo may have different verification commands
- Baseline path includes `{repoId}` to avoid cross-repo confusion
- In workspace mode, verification commands run in the repo's working directory
  (the merge worktree), not the workspace root

#### 4b. Transactional Merge Envelope

Each lane merge attempt is a transaction:

1. Capture pre-merge refs: `baseHEAD`, `laneHEAD`
2. Perform merge
3. Run verification
4. If pass: finalize (update-ref, continue)
5. If fail: rollback to `baseHEAD`
6. If rollback fails: safe-stop (`paused`) with exact recovery commands

Persist transaction record:
`.pi/verification/{opId}/txn-b{batchId}-repo-{repoId}-wave-{n}-lane-{k}.json`

**Safe-stop semantics:**
- Phase forced to `paused`
- No branch deletions, no worktree removals
- Emit exact git commands to restore consistency

#### 4c. Retry Policy Matrix

| Failure Class | Auto-Retry? | Max | Cooldown | Exhaustion Action |
|---|:-:|---:|---:|---|
| `verification_preexisting` | ✅ | 1 | 0s | Continue (no new failures) |
| `verification_new_failure` | ✅ | 1 | 0s | Pause + diagnostic |
| `git_worktree_dirty` | ✅ | 1 | 2s | Force cleanup, then pause |
| `git_lock_file` | ✅ | 2 | 3s | Pause + lock diagnostics |
| `merge_conflict_unresolved` | ❌ | 0 | — | Pause + escalation |
| `cleanup_post_merge_failed` | ✅ | 1 | 2s | Pause hard (wave gate) |
| `api_error` (rate limit) | ✅ | 3 | 60s | Pause |
| `api_error` (overloaded) | ✅ | 3 | 120s | Pause |
| `api_error` (auth) | ❌ | 0 | — | Pause + escalate |
| `context_overflow` | ✅ | 1 | 0s | Retry (fresh context) |
| `process_crash` | ✅ | 1 | 5s | Pause |
| `session_vanished` | ✅ | 1 | 5s | Pause |
| `stall_timeout` | ❌ | 0 | — | Mark failed |
| `user_killed` | ❌ | 0 | — | Pause |
| `unknown` | ❌ | 0 | — | Pause + diagnostics |

Rules:
- Retry counters persist in batch state, scoped by `(repoId, wave, lane)`
- Retries are idempotent-aware (no duplicate destructive operations)
- Retries never silently skip tasks
- `cleanup_post_merge_failed` sets a wave gate (no next wave until resolved)

---

### Phase 5 — Quality Gate

**Goal:** Verify task output matches requirements before `.DONE` creation.

**Context:** The task-runner already implements a worker iteration loop with
review gates (plan review at level ≥ 1, code review at level ≥ 2, REVISE
verdict triggers re-iteration). The quality gate adds a structured
post-completion verification layer on top.

#### 5a. Cross-Model Structured Review

After the task-runner's existing worker/review cycle reaches a
ready-to-complete state (all task steps complete), but **before final `.DONE`
creation**, run an additional structured verification:

1. Spawn a review agent (configurable model, different from worker) with:
   - PROMPT.md requirements
   - STATUS.md final state
   - Git diff (worktree branch vs base)
   - File change list
2. Review agent produces a structured JSON verdict:

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
      "file": "path/to/file",
      "remediation": "Specific fix instruction"
    }
  ],
  "statusReconciliation": [
    {
      "checkbox": "Original checkbox text",
      "actualState": "done" | "not_done" | "partial",
      "evidence": "Why we believe this"
    }
  ]
}
```

**Verdict rules:**
- Any `critical` finding → `NEEDS_FIXES`
- 3+ `important` findings → `NEEDS_FIXES`
- Only `suggestion` findings → `PASS`
- Any `status_mismatch` (box checked but work not done) → `NEEDS_FIXES`

**Pass = review confirms task done.** Fail = one remediation cycle, then
escalate to operator.

#### 5b. STATUS.md Reconciliation

After review, automatically correct STATUS.md mismatches:

- Boxes checked but review finds work not done → uncheck
- Work done but box not checked → check
- Reconciliation recorded in diagnostic report

#### 5c. Remediation Cycle

If review returns `NEEDS_FIXES` and retries remain:

1. Write `REVIEW_FEEDBACK.md` to the task folder with findings
2. Spawn a fix agent (same worktree, incremental) with instructions to
   address critical and important findings
3. Fix agent exits → re-run structured review
4. If second review still fails → mark task failed with review findings

`.DONE` contract rule:
- With quality gate enabled, `.DONE` is created **only after** PASS verdict
- No delete/recreate cycle for `.DONE` (preserves completion marker integrity)

**Budget:** Max 2 review cycles (initial + after fix). No infinite loops.

#### 5d. Configuration

```yaml
quality_gate:
  enabled: false              # opt-in, backward compatible
  review_model: "different-model"
  max_review_cycles: 2
  max_fix_cycles: 1
  pass_threshold: "no_critical"  # no_critical | no_important | all_clear
  reconcile_status: true
```

When `quality_gate.enabled: false` (default), behavior is unchanged —
`.DONE` creation by the task-runner is authoritative.

When `quality_gate.enabled: true`, `.DONE` creation is deferred until the
quality gate returns PASS.

**Polyrepo considerations:**
- Review agent runs in the task's worktree (repo-specific)
- Git diff is computed within that repo only
- In workspace mode, the review evidence package includes `repoId` context
- Cross-repo task dependencies are out of scope for per-task review — that's
  a merge-time concern

#### 5e. Task Artifact Staging Scope

Tighten what gets staged in post-task artifact commits:

Allowed:
- `<taskFolder>/.DONE`
- `<taskFolder>/STATUS.md`
- `<taskFolder>/REVIEW_VERDICT.json` (if quality gate enabled)

Disallowed:
- Arbitrary untracked files at worktree root
- Files outside the task folder scope
- `.worktrees/` directory content (already excluded in v0.5.12)

---

### Phase 6 — Supervisor Agent (Future)

**Goal:** Autonomous repair of non-trivial failures by a bounded supervisor.

This phase is deliberately deferred until Phases 1-5 are stable. The
deterministic layers handle most known failures. The supervisor addresses
the long tail.

#### Operating Modes

1. **Observe/Propose (default)** — Diagnoses and writes repair plan. No writes.
2. **Guarded Auto-Repair** — Executes approved repair classes with audit trail.
3. **Escalated Auto-Repair (opt-in)** — Time-boxed broader authority.

#### Action Class Boundaries

| Class | Scope | Examples |
|-------|-------|---------|
| A: Safe operational | Auto-allowed in guarded | Cleanup worktrees, retry merge, rerun verification, reset phase |
| B: Guarded repo | Allowed with constraints | Fix non-task files (tests, config), resolve merge conflicts |
| C: Restricted | Never auto | Edit task implementation, skip tasks/deps, push/release |

**Config mutation rule:** Supervisor may apply temporary overrides to current
batch state (`resilience.overrides`) but must not persist config file changes
in guarded mode.

### Phase Definitions of Done & Test Matrix

| Phase | Definition of Done | Required Validation |
|------|---------------------|---------------------|
| 1 | RPC wrapper produces sidecar + exit summary; task outcomes include `exitDiagnostic`; dashboard shows live token/cost updates | Unit tests for classification + parser; integration tests for tmux/session exit paths; dashboard telemetry regression tests |
| 2 | Failed tasks with lane commits preserve recoverable branch; cleanup fallback works across all repos; cleanup gate blocks next wave on failure | Workspace integration tests covering multi-wave cleanup across repos; regression for issue #93; tests for saved branch naming + commit count |
| 3 | Schema v3 migration works from v1/v2; `--force` resume policy enforced; diagnostic report emitted | State migration tests; resume matrix tests (`paused`, `failed`, `stopped`); corruption handling tests |
| 4 | Baseline/post-merge diffing implemented; transaction rollback works; retry matrix persisted in state | Verification fingerprint tests; transactional merge rollback tests; flaky rerun policy tests |
| 5 | Quality gate enforces PASS before `.DONE`; structured review output parsed; STATUS reconciliation deterministic | Task-runner quality-gate integration tests; `.DONE` authority contract tests; STATUS reconciliation fixtures |
| 6 | Supervisor modes and action boundaries enforced with audit logs | Policy guardrail tests (Class A/B/C); audit event schema tests; kill-switch behavior tests |

---

## 7. Polyrepo Integration Summary

Every phase in this roadmap must work correctly in workspace mode. Key
invariants:

| Concern | Repo Mode | Workspace Mode |
|---------|-----------|----------------|
| Telemetry sidecar path | `.pi/telemetry/{opId}-...` | `{workspaceRoot}/.pi/telemetry/{opId}-...` |
| Diagnostic path | `.pi/diagnostics/{opId}-...` | `{workspaceRoot}/.pi/diagnostics/{opId}-...` |
| Saved branch for partial progress | `saved/{opId}-{taskId}-{batchId}` | `saved/{opId}-{repoId}-{taskId}-{batchId}` (in task's repo) |
| Verification baseline | Per-repo, run in merge worktree | Same — per-repo, merge worktree is repo-specific |
| Retry counter scope | `(wave, lane)` | `(repoId, wave, lane)` |
| Worktree cleanup | In repo root | In EACH workspace repo that had lanes |
| Cleanup acceptance | No lane worktrees/branches/autostash residue | Same, validated across all workspace repos |
| Exit diagnostic `repoId` | `"default"` | Repo key from workspace config |
| Cost attribution | Per-lane = per-batch | Per-lane = per-repo (dashboard shows per-repo breakdown) |
| Quality gate review | In task's worktree | Same — worktree is already repo-specific |

**Key lesson from polyrepo development:** Every workspace bug was a place where
"workspace root ≠ repo root" leaked through. The same principle applies here —
every new feature must accept `repoRoot` as a parameter, not derive it from `cwd`.

---

## 8. Feature Flags

```yaml
runtime:
  require_tmux: true            # execution commands fail fast if tmux missing

resilience:
  enabled: true
  diagnostics:
    enabled: true                # Phase 1: telemetry + exit classification
    rpc_wrapper: true            # Use RPC wrapper for worker sessions
  progress_recovery:
    enabled: true                # Phase 2: save partial progress branches
    cleanup_fallback: true       # Phase 2: force cleanup on failure
  state:
    force_resume: true           # Phase 3: allow --force resume
    schema_version: 3            # Phase 3: v3 state schema
  verification:
    enabled: false               # Phase 4: merge baselines (opt-in)
    mode: strict                 # strict | permissive
    flaky_reruns: 1
  merge_retry:
    enabled: true                # Phase 4: auto-retry on known failures
    max_attempts: 1
  quality_gate:
    enabled: false               # Phase 5: post-completion review (opt-in)
    review_model: null
    max_review_cycles: 2
    reconcile_status: true
  supervisor:
    enabled: false               # Phase 6: autonomous repair (future)
    mode: observe
```

**Rollout:**
- tmux prerequisite enforcement ships as baseline runtime policy for execution commands
- Phase 1 ships enabled by default (diagnostics are pure additive)
- Phase 2 ships enabled by default (cleanup improvements, progress preservation)
- Phase 3 ships enabled by default (state resilience, resume improvements)
- Phase 4 ships opt-in (verification baselines change merge behavior)
- Phase 5 ships opt-in (quality gate adds latency and cost)
- Phase 6 ships opt-in (supervisor requires trust configuration)

---

## 9. Success Criteria

1. Every task exit produces a structured `TaskExitDiagnostic` with classification
2. Dashboard shows real-time token counts, cost, and context % for all lanes
3. Batch cost is accurate to within 5% of actual API billing
4. Partial progress preserved for ≥ 80% of failed tasks with lane commits
5. Stale worktree/branch cleanup succeeds without manual intervention
6. Polyrepo cleanup is complete after integrate (no registered lane worktrees,
   no lane branches, no current-batch autostash residue in any workspace repo)
7. Pre-existing test failures no longer block valid merges (when verification enabled)
8. Failed merges roll back cleanly; batch remains resumable
9. Execution commands fail fast with actionable tmux prerequisite guidance when
   tmux is missing
10. Operator time lost per incident drops from ~25 min average to < 5 min
11. All of the above work identically in repo mode and workspace mode

---

## 10. Appendix: Iteration Model Reference

For context on how the task-runner's execution loop works (relevant to Phases
1 and 5):

**Outer loop (steps):** Sequential, driven by PROMPT.md step list. Skips
completed steps (read from STATUS.md).

**Inner loop (worker iterations per step):** Up to `max_worker_iterations`
(default 20). Each iteration spawns a fresh pi instance with full system
prompt + step-specific instructions.

After each iteration:
1. Re-read STATUS.md
2. Compare checked boxes before vs after
3. No new boxes → increment `noProgressCount`
4. `noProgressCount >= no_progress_limit` (default 3) → step blocked, fail
5. All boxes checked → step complete, advance

**Review gates:**
- Level ≥ 1: Plan review before first worker iteration of each step
- Level ≥ 2: Code review after step completion
- REVISE verdict → one more worker pass

**Context management (subprocess/RPC):**
- Track context utilization via event stream
- At `warn_percent` (70%): write wrap-up signal file
- At `kill_percent` (85%): kill worker, start fresh iteration

**Context management (TMUX without RPC):**
- No context telemetry — wall-clock timeout only
- Warn at 80% of `max_worker_minutes`, kill at 100%

**With RPC wrapper (Phase 1):** TMUX mode gains the same context telemetry as
subprocess mode. The wrap-up signal and kill thresholds work identically.

---

## 11. Appendix: Incident Ledger

| # | Failure | Cat | Resolution | Time Lost | Phase |
|---|---------|-----|-----------|-----------|-------|
| 1 | False lane serialization from file scopes | D | Scope refinement | ~30m | ✅ Fixed |
| 2 | Wrong base branch/worktree source | D | Runtime base branch capture | ~60m | ✅ Fixed |
| 3 | Windows reserved filename cleanup failure | A | OS-level force cleanup fallback | ~60m | ✅ Fixed |
| 4 | `.DONE` not committed | B | Post-task artifact commit | ~30m | ✅ Fixed |
| 5 | Missing completion markers on restart | B | Manual marker recreation | ~20m | Phase 2 |
| 6 | Pre-existing verification failures blocked merge | C | Verification baseline strategy | ~30m | Phase 4 |
| 7 | Terminal failed-state trapped resume | B | Force-resume semantics | ~20m | Phase 3 |
| 8 | Cached/terminal failure replay on resume | B | State recovery matrix | ~10m | Phase 3 |
| 9 | STATUS system steps not worker-owned | E | Template/task-runner hygiene | ~5m | Phase 5 |
| 10 | Iterative duplicate definitions | E | Agent self-correction | ~0m | — |
| 11 | Stale merge worktree blocks next batch merge | A | Force cleanup fallback | ~30m | Phase 2 |
| 12 | Worker session crash with no diagnostics | F | RPC wrapper + exit classification | ~45m | Phase 1 |
| 13 | Partial task progress lost to cleanup | F | Saved branch preservation | ~30m | Phase 2 |
| 14 | `.DONE` files missing after `/orch-integrate` | A | Stop deleting during artifact staging | ~15m | ✅ Fixed |

**Total operator time lost:** ~5.75+ hours  
**Addressed by Phases 1-4:** ~3.5+ hours (incidents 5-8, 11-13)  
**Already fixed:** ~2.25+ hours (incidents 1-4, 14)

---

## 12. Appendix: Retired Design Concepts

### Lane Agent as Separate Abstraction

The original lane-agent-design.md (2026-03-11) proposed a Lane Agent as a
distinct supervision layer between the orchestrator and the task-runner. Since
then, the task-runner has grown to include most of the proposed capabilities:

| Lane Agent Proposal | Task-Runner Status (v0.5.12) |
|--------------------|-----------------------------|
| Worker lifecycle management | ✅ Implemented |
| STATUS.md progress polling | ✅ Implemented |
| Stall detection | ✅ `no_progress_limit` |
| Review cycle (plan + code) | ✅ Review levels 1-2, REVISE |
| Fix cycle after review | ✅ Worker re-iterates after REVISE |
| `.DONE` creation authority | ✅ Task-runner creates on completion |

The unique Lane Agent value — cross-model structured review and STATUS.md
reconciliation — is incorporated into Phase 5 (Quality Gate) as an extension
of the existing task-runner, not a new architectural layer. This avoids
introducing a new process/abstraction while preserving the quality verification
benefit.

### TMUX Worker Mode Elimination

The tmux-telemetry-gap.md proposed eliminating the TMUX spawn mode for workers
entirely (Section 4.5). With the RPC wrapper (Phase 1), this is no longer
necessary — the wrapper provides full telemetry in any spawn context. The
spawn mode distinction can remain for users who prefer it, while the telemetry
gap is closed regardless.

---

## 13. Open Questions

1. **RPC wrapper UI handling:** Extension UI sub-protocol (select/confirm
   dialogs) needs handling in the wrapper. Auto-resolve with defaults in
   headless mode? Workers shouldn't trigger interactive UI, but extensions
   might unexpectedly.

2. **Per-task cost attribution:** Sidecar file is per-lane, but lanes execute
   multiple tasks sequentially. Need task boundary markers in the telemetry
   stream (or separate files per task) for accurate per-task cost.

3. **Merge agent RPC:** Should merge agents also use the RPC wrapper? They
   currently run as bare `pi -p` in tmux with zero telemetry. Full cost
   tracking requires this.

4. **Verification command portability:** Verification baselines assume
   test output is parseable into fingerprints. Need adapters for common
   test frameworks (vitest, jest, pytest, go test) plus a raw-diff fallback.

5. **Quality gate cost/latency:** Each quality gate review adds an LLM call
   with potentially large context (full git diff). Should there be a diff
   size threshold beyond which review is skipped?

6. **Cross-task integration review:** Per-task quality gate verifies individual
   tasks. Should there be a post-wave review that checks coherence across
   merged lanes? This is a different concern — merge-time integration quality.

7. **Dashboard cost breakdown:** Per-wave breakdown vs batch total vs per-repo?
   What's most useful for operator decision-making?
