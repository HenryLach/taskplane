# Multi-Repo Task Execution Specification (#51)

**Status:** Draft — requested for implementation planning
**Priority:** P0 (polyrepo production blocker)
**Created:** 2026-03-27
**Updated:** 2026-03-28
**Related:** #51, `autonomous-supervisor.md`, `implemented/polyrepo-support-spec.md`

## Problem Statement

Taskplane workspace mode currently assumes a practical execution model of **one task → one execution repo at a time**. That assumption breaks down when:

1. Task packets (`PROMPT.md`, `STATUS.md`, `.DONE`) live in a central task-management repo
2. Code changes for that task happen in other repos
3. The same task naturally spans multiple repos

Observed failures (polyrepo smoke tests) are consistent with this mismatch:
- workers complete useful code changes
- sessions exit successfully
- `.DONE`/`STATUS.md` are written in a different location than orchestrator expects
- orchestrator marks tasks failed after apparent completion

This is not a small bug. It is a **model gap**.

---

## Design Goals

1. **First-class multi-repo tasks**
   - A single task packet may execute across multiple repos.

2. **Deterministic packet home**
   - Packet home repo is explicit config, never inferred by the LLM.

3. **Single source of truth for task memory**
   - `STATUS.md` and `.DONE` are authoritative in the task packet home repo.

4. **Maximum unattended progress**
   - Failures should notify supervisor and allow intelligent continuation of unaffected work.

5. **Preserve orchestration parallelism**
   - Multiple lanes run in parallel.
   - Multiple tasks can run in parallel **across different lanes**.
   - Within a lane, tasks run serially.
   - Intra-task execution remains deterministic.

6. **Backwards compatibility**
   - Existing mono-repo and single-repo task behavior remains unchanged.

7. **Deterministic mode enforcement**
   - Workspace config presence forces workspace mode (no silent repo-mode fallback).
   - Non-git cwd without workspace config is a hard setup error.

---

## Non-Goals (v1 of #51)

1. Atomic distributed transactions across repos
2. Human-perfect checklist discipline
3. Fully autonomous semantic dependency inference from arbitrary prose
4. Parallel execution of multiple segments of the same task (deferred)

---

## Core Concepts

## 0) Mode Determination and Enforcement (normative)

Taskplane must select mode deterministically:

1. **Workspace config present** (`taskplane-config.json` workspace section or legacy workspace yaml)
   - Force **workspace mode**.
   - Do not fall back to repo mode.

2. **No workspace config + cwd is a git repo**
   - Use **repo mode**.

3. **No workspace config + cwd is not a git repo**
   - Fail fast with actionable setup error (e.g., "workspace configuration required").

This avoids ambiguous behavior in polyrepo roots and prevents accidental mis-execution.

## 1) Task Packet Home Repo (new required workspace contract)

Every workspace must define a deterministic packet home repo.

- All task packet files (`PROMPT.md`, `STATUS.md`, `.DONE`, `.reviews/*`) are authored and persisted there.
- This may be:
  - one of the product repos (e.g., `shared-libs`), or
  - a dedicated task-management repo.

**Design decision:** packet home repo is explicit configuration, not inferred.

### Terminology: packet home vs task-management home

| Term | Meaning | Runtime role |
|---|---|---|
| `routing.tasksRoot` | Filesystem root where task packets are discovered | Discovery path |
| `routing.taskPacketRepo` | Repo ID that owns packet files in git/worktree terms | Authority for `STATUS.md` / `.DONE` writes and commits |
| Task areas | Logical grouping (`path/prefix/context`) under tasks root | Discovery + context organization |

In most deployments, task-management home and packet home are effectively the same place conceptually:
- task packets are discovered under `tasksRoot`
- and that root is owned by `taskPacketRepo`

### Required invariant (v1)

To keep behavior deterministic and operator-friendly, #51 enforces:

1. `tasksRoot` MUST resolve inside `repos[taskPacketRepo].path`
2. every task area path MUST resolve inside `tasksRoot`

This prevents split ownership and removes ambiguity during execution/resume.

## 2) Multi-Repo Task Segments

A task is decomposed into **segments**:

- Segment = execution unit for one repo (repo-scoped worktree/session/commit stream)
- One task can have N segments (N >= 1)
- Segments form an intra-task DAG

Example:
- `TP-002`
  - segment A: `api-service`
  - segment B: `web-client`
  - segment C: `shared-libs`

## 3) Global Scheduling Unit

Scheduler moves from task-level nodes to segment-level nodes:

- Node ID: `<taskId>::<repoId>`
- Edges come from:
  - inter-task dependencies (existing task DAG)
  - intra-task segment DAG (new)

---

## Execution Model

## Segment ordering and DAG

### Recommendation (Decision)

Use an explicit+inferred hybrid, with explicit syntax available in v1:

1. **Optional explicit segment DAG metadata** in `PROMPT.md` is supported now.
2. **Deterministic inference** builds default edges when explicit metadata is absent.
3. **Stable fallback ordering** resolves ambiguity.

### Why not free-form guessing

Inferring causal code order from prose alone is non-deterministic and brittle.

### Deterministic inference inputs (v1)

- Repo touch set from file scope path prefixes
- First appearance order of repo-scoped items in checklist steps
- Existing task dependencies (inter-task)

### Fallback (when no confident edge signal)

- Segments are considered independent from an ordering perspective,
- but **v1 executes one active segment per task at a time** using stable sort by first appearance then repoId.

This keeps behavior deterministic while we accumulate real-world data for richer DAG inference.

## Segment concurrency policy

- **Within one task:** sequential segment execution (DAG-respecting)
- **Within one lane:** tasks/segments execute **sequentially** (one active unit at a time)
- **Across lanes (within the same wave):** execution remains **parallel**
- **Across waves:** execution remains **serial**

This matches your requirement: keep global throughput while avoiding intra-task race complexity.

## Dynamic Segment Expansion (runtime)

Workers may discover new cross-repo requirements while executing a segment.

### Guardrail

- Worker may **read across all repos** for diagnosis/planning.
- Worker may **write/commit only** to:
  1. active segment repo worktree
  2. packet home repo worktree (`STATUS.md`, `.DONE`, `.reviews/*`)

No silent writes to a non-active repo are allowed.

### Expansion request flow

If a worker determines that repo `B` must change while executing segment in repo `A`:

1. Worker emits a structured `segment-expansion-request` (taskId, fromRepo, requestedRepoIds, rationale, optional suggested edges).
2. Engine validates request:
   - requested repo IDs exist in workspace config
   - proposed edges do not introduce cycles
3. Engine notifies supervisor with request payload.
4. Supervisor decides: approve / modify / reject.
5. Engine persists graph revision (batch-state v4) and updates runnable frontier.

### Scheduler behavior after approval

- New segments are added as pending nodes.
- Existing completed segment outputs remain valid.
- Newly added dependencies can block downstream segments deterministically.
- Unrelated tasks/segments continue when policy allows.
- Supervisor may reorder **dependency-ready, non-dependent** pending segments to improve recovery/progress, with full audit trail (who/when/why) persisted in batch state.

### Operator visibility

Dashboard and summaries must show:
- that expansion occurred
- which repos were added
- supervisor decision and rationale
- resulting DAG change

---

## Preserving agent outcome quality (cross-repo cohesion concern)

Sequential segments do not require fragmented thinking.

To preserve solution quality:

1. Worker retains full task context and cross-repo plan in `STATUS.md`.
2. Worker can read across all repos during planning/diagnosis.
3. Write/commit boundaries are segment-scoped for determinism and recoverability.

This gives coherent design thinking with deterministic execution checkpoints.

---

## Packet File Authority and I/O Contract

## Authoritative locations

For every task:
- `PROMPT.md` authoritative in packet home repo worktree
- `STATUS.md` authoritative in packet home repo worktree
- `.DONE` authoritative in packet home repo worktree

No other location may be considered authoritative for completion.

## Engine/runner path contract (new)

Introduce explicit packet-path environment contract for task-runner:

- `TASK_PACKET_PROMPT_PATH`
- `TASK_PACKET_STATUS_PATH`
- `TASK_PACKET_DONE_PATH`
- `TASK_PACKET_REVIEWS_DIR`

Execution `cwd` remains the active segment repo worktree.

Task-runner reads/writes packet files via packet-path vars, not by deriving from `cwd`.

This removes split-brain behavior between source/worktree/cross-repo paths.

---

## Supervisor Integration (unattended-first)

When a segment fails:

1. Engine records deterministic segment failure state.
2. Engine emits supervisor alert event.
3. Supervisor decides recoverability and policy action.
4. Engine applies decision and continues unaffected graph work where safe.

Candidate supervisor actions:
- retry segment
- skip segment and block dependent segments
- continue unrelated segments/tasks
- pause batch only when required
- escalate to operator only for truly blocked states

This aligns with `autonomous-supervisor.md` and unattended operation goals.

---

## STATUS.md and checklist repo sections

Repo-grouped checklist presentation is useful but **non-authoritative**.

Rules:

1. Repo section headings are organizational hints only.
2. Hydration from worker/reviewer may be messy; parser must be tolerant.
3. Functional routing derives from segment plan + file paths, not heading placement.
4. Engine should support normalization/linting suggestions without failing execution.

---

## Configuration Changes (proposed)

> Canonical config is `.pi/taskplane-config.json` (JSON-first).

Add workspace routing contract fields:

```json
{
  "workspace": {
    "repos": {
      "shared-libs": { "path": "../shared-libs", "defaultBranch": "main" },
      "api-service": { "path": "../api-service", "defaultBranch": "main" },
      "web-client": { "path": "../web-client", "defaultBranch": "main" }
    },
    "routing": {
      "tasksRoot": "shared-libs/task-management/platform/general",
      "defaultRepo": "shared-libs",
      "taskPacketRepo": "shared-libs"
    },
    "multiRepoTasks": {
      "segmentOrdering": "dag-sequential"
    }
  }
}
```

Workspace mode is mandatory when workspace config is present; this is not an operator-facing opt-in toggle.

Legacy `.pi/taskplane-workspace.yaml` remains fallback-only and maps into the same runtime schema.

---

## Persistence Schema (v4) — required

Persist segment-level runtime state in `.pi/batch-state.json`:

- task-level:
  - `packetRepoId`
  - `packetTaskPath`
  - `segmentIds[]`
  - `activeSegmentId`
- segment-level:
  - `segmentId`, `repoId`, `status`
  - `laneId`, `sessionName`, `worktreePath`, `branch`
  - timestamps, retries, exit diagnostics
  - dependency edges (`dependsOnSegmentIds[]`)

Resume must reconstruct execution from this state without rediscovery ambiguity.

---

## Dashboard and observability

Dashboard should display:

1. Task packet home repo
2. Segment graph/status per task
3. Active segment per lane
4. Packet file status (`STATUS.md` updated, `.DONE` present)
5. Supervisor interventions and decisions

---

## Implementation Plan

## Phase A — Spec + contracts (this doc)

- finalize data model
- finalize env/path contract
- finalize failure/supervisor protocol

## Phase B — Planning + schema

- segment graph builder
- batch-state v4 migration
- deterministic segment scheduling rules

## Phase C — Execution engine

- dual-context execution (segment repo + packet repo)
- packet-path env vars
- segment-level outcome handling

## Phase D — Supervisor policy integration

- segment-failure alert payloads
- supervisor decision hooks
- continue-unaffected behavior

## Phase E — Dashboard + docs + templates

- segment visualization
- packet-home status visibility
- prompt template updates for optional explicit segment hints

## Phase F — acceptance validation

- polyrepo 6-task smoke passes twice consecutively
- forced interruption + resume passes
- dynamic segment-expansion scenario passes (worker requests new repo segment mid-task)
- no false `.DONE` failures
- no `TASK_AUTOSTART file not found` for valid packet paths

---

## Acceptance Criteria

1. A task spanning 3 repos executes with deterministic segment progression.
2. `STATUS.md` and `.DONE` always resolve in packet home repo worktree.
3. Unrelated tasks continue when one segment fails and policy permits.
4. Supervisor receives actionable segment-level alerts and can recover unattended runs.
5. Resume reconstructs exact segment frontier from persisted state.
6. Mid-task segment expansion is deterministic, persisted, and supervisor-auditable.

---

## Risks and Mitigations

1. **State complexity increase**
   - Mitigation: schema v4 with explicit segment state and migration tests.

2. **Operator confusion during transition**
   - Mitigation: dashboard segment view + clear batch summaries.

3. **Checklist inconsistency by humans/agents**
   - Mitigation: treat section headers as non-functional hints.

4. **Quality regressions from strict repo partitioning**
   - Mitigation: preserve cross-repo read context and single cohesive task memory.

---

## Resolved Decisions (2026-03-28)

1. **Explicit segment DAG syntax in `PROMPT.md`:** support now (optional), with deterministic inference fallback when omitted.
2. **Supervisor reordering of non-dependent pending segments:** allowed, but only for dependency-ready segments; all reorder actions must be persisted and observable.
3. **Optional segment bundles (two repos in one execution window):** defer until after v1 stability; introduce as an experimental, feature-flagged capability after baseline reliability metrics are met.

---

## Summary Decision

Taskplane should stop treating cross-repo task execution as an edge case.

#51 will introduce a first-class model:
- task packets have explicit home repo
- tasks decompose into repo segments
- segment DAG drives deterministic execution
- supervisor maximizes unattended progress
- packet files remain authoritative and recoverable

This is the required foundation for production polyrepo rollout.
