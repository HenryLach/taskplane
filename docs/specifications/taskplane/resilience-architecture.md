# Resilience Architecture — Self-Healing Orchestration

> **Status:** ⚠️ SUPERSEDED — consolidated into [resilience-and-diagnostics-roadmap.md](resilience-and-diagnostics-roadmap.md) on 2026-03-19.  
> This file is retained for historical reference. All new work should reference the consolidated roadmap.
>
> **Created:** 2026-03-15  
> **Last Updated:** 2026-03-15  
> **Related:** [lane-agent-design.md](lane-agent-design.md), [architecture](../../../../docs/explanation/architecture.md)

---

## 1. Problem Statement

Taskplane's orchestrator currently behaves like a strong scheduler with weak
supervision: it plans waves/lane execution well, but when failures occur,
recovery is manual.

Today, the practical recovery loop is:

1. Batch fails/pauses
2. Human asks a separate agent to diagnose and repair
3. Human restarts or resumes batch

This proves repair is feasible but externally orchestrated. We need that
supervision capability **inside** Taskplane.

**Core insight:** The missing runtime role is not another worker, but a
**supervisor** with bounded authority to diagnose, repair common failures, and
escalate safely.

---

## 2. Failure Taxonomy (Observed)

### Category A: Environment / Platform

| Failure | Root Cause | Human Fix | Automatable? |
|---|---|---|---|
| Windows `nul` file blocks `git clean` | Agent used `2>nul` in bash, creating literal file | Added OS-level cleanup fallback (`rd /s /q`) | ✅ fixed |
| Worktree cleanup race/locks | Windows file/process timing | Force cleanup + prune | ✅ fixed |
| Stale merge worktree blocks next batch | `merge-workspace-{opId}` not removed after prior failure; `git worktree remove` fails because dir is orphaned (not registered), then `git worktree add` fails because path exists | Manual `rm -rf` + `git worktree prune` | ✅ planned — merge.ts cleanup should fall back to `rm -rf` + prune when `git worktree remove` fails (same pattern as `forceCleanupWorktree()` for lane worktrees) |

### Category B: State Management

| Failure | Root Cause | Human Fix | Automatable? |
|---|---|---|---|
| `.DONE` not merged | `.DONE` created but not committed | Added post-task artifact commit | ✅ fixed |
| Batch became terminal `failed` | Resume retry transitioned from `paused` to `failed` | Deleted state + restarted | ✅ planned |
| Lane work preserved but hard to recover | Merge failure/reset left branch/worktree mismatch | Manual merge + cleanup | ✅ planned |

### Category C: Verification

| Failure | Root Cause | Human Fix | Automatable? |
|---|---|---|---|
| Pre-existing failures blocked merge | No baseline vs post-merge comparison | Fixed tests manually | ✅ planned |
| Source-inspection tests drifted after refactor | Tests pointed to old file paths | Updated tests | ⚠️ partially (baseline + guardrails) |

### Category D: Planning / Config

| Failure | Root Cause | Human Fix | Automatable? |
|---|---|---|---|
| False lane affinity reduced parallelism | Over-broad file scope overlap | Narrowed scopes | ⚠️ detect yes, auto-fix risky |
| Wrong merge base branch in worktrees | Configured branch drifted from current branch | Removed config field; used current branch | ✅ fixed |

### Category E: Agent Behavior

| Failure | Root Cause | Human Fix | Automatable? |
|---|---|---|---|
| Duplicate definitions during iterations | Iterative edits on stale assumptions | Agent self-corrected | ⚠️ hard, mitigatable |
| STATUS has unchecked system steps | Worker asked to check boxes it doesn't own | Template/task-runner cleanup | ✅ planned |

### Category F: Observability & Diagnostics

| Failure | Root Cause | Human Fix | Automatable? |
|---|---|---|---|
| Worker session exits with no diagnostic info | TMUX mode captures no exit code, no error output, no token counts, no context %. Exit reason is "session exited without .DONE" with only tmux pane tail (often just startup banner) | Manual investigation — cherry-pick unreachable commits from reflog, guess at root cause | ✅ planned — see Section 18 |
| Partial task progress lost on session crash | Worker completes Steps 0-2 with commits on lane branch, then crashes. Orchestrator marks task "failed", cleanup removes worktree. Commits become unreachable (reflog only). No automatic recovery. | Manual `git fsck`, cherry-pick, mark .DONE | ✅ planned — see Section 18 |
| No distinction between crash vs completion failure | Task runner treats all non-.DONE exits the same: "failed". No way to distinguish API error, context overflow, pi crash, user kill, wall-clock timeout (when not killed by task-runner itself) | Operator guesses from circumstantial evidence | ✅ planned — see Section 18 |

---

## 3. Design Principles

1. **Fail-forward over fail-stop**  
   Try deterministic repair first; pause with diagnostics before terminal failure.

2. **Deterministic first, LLM second**  
   Known failure classes should be handled by code paths, not model judgment.

3. **Resumability is sacred**  
   Batch state should stay recoverable; terminal states require explicit intent.

4. **Transactional safety**  
   Every repair/merge operation must have rollback or safe-stop semantics.

5. **Scoped authority + full auditability**  
   Supervisor actions must be bounded and logged in machine-readable form.

6. **Workspace-aware correctness**  
   Recovery must work in repo mode and workspace/polyrepo mode.

---

## 4. Architecture (Target)

```text
Orchestrator
├── Wave/Lane Planner
├── Lane Supervisor (per-lane execution resilience)
├── Merge Resilience Engine
│   ├── Baseline verifier (pre-merge)
│   ├── Post-merge verifier
│   ├── Failure classifier
│   └── Retry/rollback controller
├── State Recovery Engine
│   ├── Resume eligibility + force policy
│   ├── Orphan reconciliation
│   └── Worktree/branch recovery
└── Escalation Engine
    ├── Deterministic repair strategies
    ├── Structured diagnostics
    └── Optional supervisor agent (bounded)
```

### 4.1 Team-Scale Naming Compatibility (TP-010)

Resilience components must respect TP-010 naming contracts:

- Lane/session/worktree identifiers are operator-scoped (`opId`) and batch-scoped.
- Lane branches follow `task/{opId}-lane-{N}-{batchId}`.
- Sidecar and verification artifacts must include `opId` + `batchId` to avoid
  collisions across concurrent operators in shared repos/workspaces.

Any resilience feature that discovers sessions/worktrees/branches by pattern must
use naming helpers from `naming.ts` (never hardcoded regexes).

---

## 5. State Schema & Migration Plan (NEW)

Resilience features require explicit persisted state evolution.

### 5.1 Schema Additions

Add to `.pi/batch-state.json` (schema v3):

```json
{
  "schemaVersion": 3,
  "phase": "paused",
  "baseBranch": "feat/polyrepo-support",
  "operatorId": "hlach",
  "resilience": {
    "resumeForced": false,
    "mergeRetryCountByScope": { "default:w0:l1": 1 },
    "lastFailureClass": "verification_preexisting",
    "repairHistory": [
      {
        "id": "r-20260315-001",
        "strategy": "baseline-compare",
        "status": "succeeded",
        "startedAt": 1773580000000,
        "endedAt": 1773580010000
      }
    ]
  },
  "verification": {
    "baselineByScope": {
      "default:w1": ".pi/verification/hlach/baseline-b20260315T101711-repo-default-wave-1.json"
    },
    "postMergeByScope": {
      "default:w1": ".pi/verification/hlach/post-merge-b20260315T101711-repo-default-wave-1.json"
    }
  }
}
```

### 5.2 Migration Rules

- `v1/v2 -> v3`: default missing fields conservatively (`retryCount=0`, no baseline, `operatorId="op"`).
- Unknown fields: preserve on read/write roundtrip.
- If state file corrupt/unparseable: enter `paused` with diagnostic + safe-stop,
  never auto-delete state.

### 5.3 Compatibility Contract

- New runtime must resume older states.
- Old runtime reading v3 should fail with explicit version mismatch guidance.

---

## 6. Retry Policy Matrix (NEW)

Explicit retry semantics per failure class:

| Failure Class | Auto-Retry? | Max Attempts | Cooldown | Action on Exhaustion |
|---|---:|---:|---:|---|
| `verification_preexisting` | ✅ | 1 | 0s | Continue if no new failures |
| `verification_new_failure` | ✅ | 1 | 0s | Pause + diagnostic |
| `git_worktree_dirty` | ✅ | 1 | 2s | Force cleanup, then pause |
| `git_lock_file` | ✅ | 2 | 3s | Pause + lock diagnostics |
| `merge_conflict_unresolved` | ❌ | 0 | - | Pause + escalation |
| `cleanup_post_merge_failed` | ✅ | 1 | 2s | Force cleanup once, then pause hard (no next wave) |
| `state_phase_terminal` | ✅ (`--force` policy) | 1 | 0s | Pause with force-required note |
| `unknown` | ❌ | 0 | - | Pause + escalation |

Rules:
- Retry counters persist in batch state.
- Retries are **idempotent-aware** (no duplicate destructive operations).
- Retries must never silently skip tasks.
- Any `cleanup_post_merge_failed` classification sets a **wave gate**: do not start
  the next wave until cleanup is successful or operator explicitly resumes/forces.

---

## 7. Verification Baseline Strategy (Expanded)

### 7.1 Scope: Not Just Tests

Baseline/post-merge comparison applies to each configured verification command,
not only `vitest`.

Examples:
- unit tests
- integration tests
- lint
- build
- `taskplane doctor` or custom project checks

### 7.2 Fingerprint Format (Regression-safe)

Do not compare raw text blobs. Use normalized fingerprints:

```json
{
  "commandId": "verify.tests",
  "file": "tests/orch-pure-functions.test.ts",
  "case": "Orchestrator Pure Functions > passes all assertions",
  "kind": "assertion_error",
  "messageNorm": "Function 'computeOrchSummaryCounts' not found in source"
}
```

`newFailures = postMergeFingerprints - baselineFingerprints`

### 7.3 Flaky Handling

For failures not in baseline:
1. Re-run same command once.
2. If failure disappears, classify as `flaky_suspected`, do not block merge,
   but emit warning + diagnostic.
3. If persistent, classify as `new_failure` and block.

### 7.4 Baseline Capture Failure Policy

If baseline command cannot run (tool missing, env failure):
- Do **not** silently hard-fail merge.
- Classify `baseline_unavailable`.
- Policy:
  - if strict mode: pause + diagnostic
  - if permissive mode: continue with current verification behavior

Default: **pause with diagnostic** (aligned with fail-forward + operator clarity).

---

## 8. Transactional Merge Safety (NEW)

Merge + verification is a transaction-like flow.

### 8.1 Transaction Envelope

For each lane merge attempt:

1. Capture pre-merge refs (`baseHEAD`, `laneHEAD`).
2. Perform merge.
3. Run verification.
4. If pass: commit result and continue.
5. If fail:
   - attempt revert/reset to `baseHEAD`
   - if revert fails, enter safe-stop (`paused`) with explicit repo instructions.

### 8.2 Required Artifacts

Persist `.pi/verification/{opId}/txn-b{batchId}-repo-{repoId}-wave-{n}-lane-{k}.json` with:
- operator id + batch id
- repo id + lane id
- pre-merge head
- post-merge head
- verification results
- rollback status

### 8.3 Safe-Stop Semantics

If rollback cannot guarantee consistency:
- phase forced to `paused`
- no branch deletions
- no worktree removals
- emit exact commands to restore consistency

### 8.4 Post-Merge Cleanup Gate (NEW)

A successful merge is **not** sufficient to advance the batch. Cleanup is part of
transaction finalization.

Required sequence per wave:
1. Merge lane branches
2. Verify merged result
3. Finalize cleanup (reset/remove worktrees, branch cleanup)
4. Only then mark wave complete and permit next-wave execution

If step 3 fails (`cleanup_post_merge_failed`):
- keep merged commits intact
- preserve diagnostic artifacts
- force batch phase to `paused`
- block transition to next wave

This prevents the failure mode where Wave N merges successfully but stale/locked
worktree state causes Wave N+1 to fail immediately.

### 8.5 Task Artifact Staging Scope (NEW)

Post-task artifact commits must stage **only task-owned paths**, never global
`git add -A` in lane worktrees.

Allowed staging set:
- `<taskFolder>/.DONE`
- `<taskFolder>/STATUS.md`
- task-owned review artifacts (optional by policy)

Disallowed by default:
- arbitrary untracked files at worktree root (e.g., `nul`, temp files)
- unrelated repository changes outside the active task scope

Rationale: limits blast radius from rogue files and avoids cleanup poisoning by
unrelated untracked artifacts.

---

## 9. State Recovery & Resume (Updated)

### 9.1 Resume Eligibility

| Phase | Eligible | Notes |
|---|---|---|
| `paused` | ✅ | standard resume |
| `executing` | ✅ | crash recovery |
| `merging` | ✅ | interrupted merge recovery |
| `stopped` | ⚠️ | `--force` only |
| `failed` | ⚠️ | `--force` or auto-repair path |
| `completed` | ❌ | terminal |

### 9.2 Forced Resume Contract

`/orch-resume --force` must:
1. run pre-resume diagnostics
2. record force intent in state (`resilience.resumeForced=true`)
3. reset to recoverable phase (`paused`) only after diagnostics pass policy

### 9.3 Merge Failure Phase Rule

Merge failure defaults to `paused` unless policy explicitly says `abort`.
`failed` is reserved for unrecoverable internal invariants after retries/exhaustion.

---

## 10. Supervisor Agent Authority Model (Revised)

This is the key balance: maximize autonomous recovery **without** letting the
supervisor silently rewrite task outcomes.

### 10.1 Three Operating Modes

1. **Observe/Propose (default)**
   - Supervisor diagnoses and writes repair plan.
   - No writes except diagnostics.

2. **Guarded Auto-Repair (recommended)**
   - Supervisor may execute approved repair classes (see below).
   - Must create audit events + reversible snapshots.

3. **Escalated Auto-Repair (opt-in, high trust)**
   - Time-boxed broader authority for incident recovery.
   - Requires explicit config + operator acknowledgement.

### 10.2 Action Classes (Balanced Boundaries)

#### Class A — Safe Operational Actions (auto-allowed in Guarded mode)
- cleanup/prune stale worktrees/branches
- reset batch phase from recoverable terminal states per policy
- rerun verification commands
- capture baseline/post-merge diagnostics
- retry merge transaction
- apply **temporary runtime overrides** (in state) for retry behavior

#### Class B — Guarded Repo Actions (allowed with constraints)
- modify non-task infrastructure files (`extensions/tests/**`, orchestrator internals)
- resolve merge conflicts in non-task files
- amend local repair branches

Constraints:
- must not touch task folders except diagnostics/log artifacts
- must create `repair/*` commit with structured metadata
- must run verification and attach results before continuing

#### Class C — Restricted Actions (never auto in Guarded mode)
- editing task implementation files produced by worker for active tasks
- editing `PROMPT.md` / task requirements to pass checks
- skipping wave/tasks/dependencies
- pushing/PR/release actions
- persistent config mutation without explicit operator policy

### 10.3 Config Mutation Decision (Important Balance)

To preserve recovery power without hidden policy drift:

- Supervisor **may** apply temporary config overrides to current batch via
  runtime state (`batchState.resilience.overrides`) for retry logic.
- Supervisor **must not** persist `.pi/task-orchestrator.yaml` changes in
  Guarded mode.
- Persistent config edits require:
  - Escalated mode, or
  - explicit operator confirmation token/policy.

This gives high recovery capability while preventing silent long-term behavior
changes.

### 10.4 Kill Switches

- `resilience.supervisor.enabled=false`
- `resilience.supervisor.mode=observe|guarded|escalated`
- `resilience.supervisor.maxActionsPerBatch`
- `resilience.supervisor.allowedPaths`

---

## 11. Auditability Contract (NEW)

Every automated resilience action must emit:

1. JSONL event in `.pi/resilience-events.jsonl`
2. human summary in `.pi/diagnostics/batch-{id}.md`
3. optional repair patch references (commit SHA / diff path)

Event schema:

```json
{
  "ts": "2026-03-15T16:21:00Z",
  "batchId": "20260315T101711",
  "operatorId": "hlach",
  "repoId": "default",
  "wave": 1,
  "lane": 1,
  "laneId": "lane-1",
  "actor": "supervisor",
  "mode": "guarded",
  "action": "merge_retry",
  "class": "A",
  "inputs": { "failureClass": "verification_preexisting" },
  "result": "succeeded",
  "artifacts": [".pi/verification/hlach/post-merge-b20260315T101711-repo-default-wave-1.json"]
}
```

---

## 12. Workspace / Polyrepo Considerations (NEW)

Resilience logic must be repo-aware and operator-scoped:

1. Baselines are per operator + batch + repo + wave (`{opId}/baseline-b{batchId}-repo-{repoId}-wave-{n}.json`).
2. Retry counters are scoped by `(opId, batchId, repoId, wave, lane)`.
3. Cleanup must target the correct repo root from execution context.
4. Diagnostics must include `repoId`, `opId`, and `batchId` to avoid ambiguous actions.
5. Supervisor path guards must enforce repo-local boundaries.

---

## 13. Feature Flags & Rollout Plan (NEW)

### 13.1 Flags

```yaml
resilience:
  enabled: true
  resume_force:
    enabled: true
  merge_baseline:
    enabled: true
    mode: strict   # strict | permissive
    flaky_reruns: 1
  merge_retry:
    enabled: true
    max_attempts: 1
  diagnostics:
    enabled: true
  supervisor:
    enabled: false
    mode: observe  # observe | guarded | escalated
```

### 13.2 Rollout Stages

1. **Stage 1**: diagnostics + baseline compare (no autonomous write actions)
2. **Stage 2**: deterministic retries + force-resume
3. **Stage 3**: guarded supervisor auto-repair
4. **Stage 4**: optional escalated mode

---

## 14. Implementation Roadmap (Updated)

### Sprint 0 — Diagnostic Foundation (NEW — Highest Priority)

0a. Pi exit file protocol (session-exit JSON for TMUX mode)
0b. Structured exit reason classification (`TaskExitDiagnostic`)
0c. Partial progress recovery (preserve lane branch on task failure, record commit count)
0d. Stale merge worktree cleanup fallback (`rm -rf` + `git worktree prune`)
0e. Retry policy by classification (API error → retry, crash → retry once, unknown → pause)

### Sprint 1 — Critical Reliability

1. state schema v3 + migration
2. `/orch-resume --force` eligibility + policy
3. merge failure defaults to `paused`
4. diagnostic report + JSONL events

### Sprint 2 — Verification Resilience

5. verification adapter + fingerprinting
6. baseline/post-merge comparison across all verification commands
7. flaky rerun policy
8. strict/permissive behavior for missing baseline

### Sprint 3 — Transactional Merge

9. merge transaction envelope (pre/post refs, rollback, safe-stop)
10. retry matrix implementation + persisted counters
11. branch/worktree preservation guarantees on failure
12. post-merge cleanup gate (block next-wave start until cleanup finalizes)

### Sprint 4 — Supervisor Integration

13. deterministic repair strategies
14. supervisor modes + action class guards + path policy
15. temporary runtime overrides (non-persistent config mutation)
16. guarded auto-repair pilot

### Sprint 5 — Task Artifact Hygiene

17. remove system-owned checklist items from task templates
18. finalize STATUS reconciliation behavior in task-runner/lane supervisor
19. restrict post-task artifact staging to task-owned paths (no `git add -A`)

---

## 15. Success Criteria

1. Operator no longer performs manual cleanup in normal incidents.
2. Pre-existing verification failures no longer block valid merges.
3. Batch remains resumable after common failures.
4. Every automated repair is auditable and reproducible.
5. No batch advances to the next wave after a post-merge cleanup failure.
6. Post-task artifact commits never fail due to unrelated untracked root files.
7. ≥90% of known failure classes resolved without human intervention.

---

## 16. Diagnostic Example (Corrected)

```markdown
## Batch Failure Diagnostic

**Batch:** 20260315T101711
**Failed at:** Wave 1 merge
**Failure type:** Post-merge verification

### What happened
Merge succeeded, but post-merge verification reported 4 failures.

### Baseline comparison
- Baseline failures before merge: 4
- Post-merge failures: 4
- New failures introduced by merge: 0

### Classification
verification_preexisting

### Automated decision
No new failures. Merge accepted under baseline policy.

### State
- Lane branch preserved: task/hlach-lane-1-20260315T101711
- Base branch head: <sha>
- Batch phase: paused (if additional manual review policy requires)
```

---

## 17. Appendix: Incident Ledger (Polyrepo Run)

| # | Failure | Category | Resolution | Time Lost |
|---|---|---|---|---|
| 1 | False lane serialization from file scopes | D | Scope refinement | ~30m |
| 2 | Wrong base branch/worktree source | D | Runtime base branch capture | ~60m |
| 3 | Windows reserved filename cleanup failure | A | OS-level force cleanup fallback | ~60m |
| 4 | `.DONE` not committed | B | post-task artifact commit | ~30m |
| 5 | Missing completion markers on restart | B | manual marker recreation | ~20m |
| 6 | Pre-existing verification failures blocked merge | C | test refactor + baseline strategy | ~30m |
| 7 | Terminal failed-state trapped resume | B | planned force-resume semantics | ~20m |
| 8 | Cached/terminal failure replay on resume | B | planned state recovery matrix | ~10m |
| 9 | STATUS system steps not worker-owned | E | template/task-runner hygiene | ~5m |
| 10 | Iterative duplicate definitions | E | agent self-correction | ~0m |
| 11 | Stale merge worktree blocks next batch merge | A | manual rm -rf + prune + cherry-pick recovery | ~30m |
| 12 | Worker session crash with no diagnostics | F | manual reflog search, cherry-pick, guess at root cause | ~45m |
| 13 | Partial task progress (Steps 0-2 done) lost to cleanup | F | manual git fsck + cherry-pick + .DONE marker | ~30m |
| 14 | .DONE files missing after /orch-integrate | A | .DONE deleted during merge artifact staging, not reliably restored by ff | ~15m |

**Observed operator time lost:** ~5.75+ hours

---

## 18. TMUX Mode Diagnostic Gap (NEW — Critical)

### 18.1 Problem

The task-runner's TMUX spawn mode has a **fundamental observability gap** compared
to subprocess mode. When a worker session crashes, the operator gets almost no
information about what happened.

**What subprocess mode captures:**
- Exit code (0, 1, signal, etc.)
- Full stdout/stderr output
- Token counts (input, output, cache read, cache write)
- Context utilization percentage (warn at 70%, kill at 85%)
- Per-tool-call telemetry (tool name, arguments)
- Cost tracking

**What TMUX mode captures:**
- ❌ No exit code (hardcoded to 0)
- ❌ No error output (hardcoded to "")
- ❌ No token counts
- ❌ No context percentage
- ❌ No per-tool telemetry
- ✅ tmux pane tail (last ~40 lines, often just startup banner)
- ✅ Lane log file tail (if log redirection enabled — often empty on Windows)
- ✅ STATUS.md tail (shows last known state)

The exit reason string is: `"TMUX session '{name}' exited without creating .DONE file
(grace period Nms expired). Last output: {pane_tail}"`

This is the **only diagnostic** the operator gets. No way to distinguish:
- API authentication failure
- API rate limit
- Model returned error (overloaded, etc.)
- Pi process crash (segfault, OOM, unhandled exception)
- Context overflow (hit model's actual limit)
- Wall-clock timeout (killed by task-runner — this one IS distinguishable)
- User accidentally killed the session

### 18.2 Root Cause

`spawnAgentTmux()` in `task-runner.ts` creates a tmux session running
`pi -p --no-session ...` and then polls `tmux has-session` every 2 seconds.
When the session disappears, it returns `{ output: "", exitCode: 0, killed: false }`.

Pi's `-p` flag means "process prompt and exit" — there's no JSON event stream,
no telemetry socket, no structured output. The tmux session is a black box.

### 18.3 Impact

1. **No root cause analysis.** When a task fails after hours of execution,
   the operator must guess why. Was it an API error? A crash? Context overflow?

2. **No partial credit.** The task is marked "failed" even if the worker
   completed 60% of the work. The operator must manually search `git fsck`
   for unreachable commits to recover progress.

3. **No retry intelligence.** Without knowing WHY the session died, the
   system can't make smart retry decisions. An API rate limit should be
   retried after a cooldown. A context overflow should not.

4. **Cost invisible.** In TMUX mode, token counts are zero. The operator
   has no idea how much a failed batch cost.

### 18.4 Proposed Solutions

#### 18.4.1 Pi Exit File Protocol (Short-term)

Have the task-runner write a "session contract" file before spawning pi.
Pi (or a wrapper script) writes exit diagnostics to a known path on exit:

```
.pi/session-exit-{sessionName}.json
```

Contents:
```json
{
  "exitCode": 1,
  "exitSignal": null,
  "error": "API error: 529 Overloaded",
  "tokensUsed": { "input": 45000, "output": 12000 },
  "contextPct": 23.5,
  "durationSec": 3847,
  "lastToolCall": "bash: cd extensions && npx vitest run",
  "crashStack": null
}
```

Implementation: wrap the pi command in a shell script that captures exit code
and writes the JSON. The task-runner reads it after session exit.

#### 18.4.2 Partial Progress Recovery (Short-term)

When a task fails without .DONE but has lane branch commits:

1. Check if lane branch has commits ahead of base branch
2. If yes, record the commit SHA in the task outcome
3. Do NOT delete the lane branch during cleanup
4. Preserve the lane branch as `saved/{opId}-{taskId}-{batchId}`
5. Log: "Task {id} failed but has N commits of partial progress on branch {name}"

This is partially implemented for merge failures (`removeAllWorktrees` already
preserves unmerged branches as saved refs) but NOT for task execution failures.

#### 18.4.3 Structured Exit Reason Classification (Medium-term)

Replace the free-text `exitReason` string with a structured classification:

```typescript
interface TaskExitDiagnostic {
  classification:
    | "completed"           // .DONE found
    | "api_error"           // API returned error (auth, rate limit, overload)
    | "context_overflow"    // Hit context window limit
    | "wall_clock_timeout"  // Killed by task-runner timer
    | "process_crash"       // Non-zero exit code, no API error
    | "session_vanished"    // tmux session disappeared, no exit info
    | "stall_timeout"       // No STATUS progress for N minutes
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
}
```

#### 18.4.4 Retry Policy by Classification

Once we have classifications, retry decisions become deterministic:

| Classification | Auto-Retry? | Cooldown | Action |
|---|---|---|---|
| `api_error` (rate limit) | ✅ | 60s | Retry same step |
| `api_error` (overloaded) | ✅ | 120s | Retry same step |
| `api_error` (auth) | ❌ | — | Pause + escalate |
| `context_overflow` | ✅ | 0s | Retry (fresh context) |
| `wall_clock_timeout` | ⚠️ | 0s | Retry if progress was made |
| `process_crash` | ✅ | 5s | Retry once, then pause |
| `session_vanished` | ✅ | 5s | Retry once, then pause |
| `stall_timeout` | ❌ | — | Mark failed |
| `user_killed` | ❌ | — | Pause |
| `unknown` | ❌ | — | Pause + diagnostics |

### 18.5 Iteration Model Reference

For context, the task-runner's iteration model works as follows:

**Outer loop (steps):** Sequential, driven by PROMPT.md step list. The task-runner
iterates through steps in order, skipping completed ones (read from STATUS.md).

**Inner loop (worker iterations per step):** Up to `max_worker_iterations` (default 20).
Each iteration spawns a **fresh pi instance** with:
- Full system prompt (worker agent + project context)
- Step-specific prompt ("Execute Step N")
- Instructions to read STATUS.md first to find where it left off

After each iteration:
1. Re-read STATUS.md
2. Compare checked boxes before vs after
3. If no new boxes checked → increment `noProgressCount`
4. If `noProgressCount >= no_progress_limit` (default 3) → mark step blocked, fail
5. If all boxes checked → step complete, move to next step

**Review gates (between iterations):**
- Review level ≥ 1: Plan review BEFORE first worker iteration of each step
- Review level ≥ 2: Code review AFTER step completion
- REVISE verdict → one more worker pass to address issues

**Context management (subprocess mode only):**
- Track context utilization via JSON event stream
- At `warn_percent` (70%): write wrap-up signal file
- At `kill_percent` (85%): kill worker, start fresh iteration
- Worker reads signal file and wraps up gracefully

**Context management (TMUX mode):**
- No context telemetry available
- Wall-clock timeout only: warn at 80% of `max_worker_minutes`, kill at 100%
- Default `max_worker_minutes`: 30 (from `failure.max_worker_minutes`)

**Key implication:** In TMUX mode, a worker that uses context efficiently
(e.g., Opus with 1M window) could run for the full 30 minutes on a single
iteration without any context pressure. If the model or API fails at minute 28,
the entire iteration's work is lost — there are no intermediate checkpoints
within a single pi invocation. Checkpoints only happen between iterations
(STATUS.md is the checkpoint mechanism).
