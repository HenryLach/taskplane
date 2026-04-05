# Dynamic Segment Expansion — Implementation Specification

**Status:** Draft
**Parent:** `multi-repo-task-execution.md` (post-MVP section)
**Created:** 2026-04-05
**Author:** Supervisor (reviewed with operator)

## Overview

Dynamic segment expansion allows a worker agent executing a task segment in
repo A to request that the engine add a new segment for repo B — a repo not
in the original segment plan. This covers the scenario where cross-repo
requirements are discovered at runtime rather than at task-authoring time.

**Current state:** The multi-repo segment infrastructure (TP-132–136) supports
deterministic planning and sequential execution of segment DAGs. Segment plans
are computed at batch start from `## Segment DAG` metadata or inference from
`## File Scope`. Once planned, the segment set is immutable for the task's
lifetime. This spec extends that model.

---

## Design Principles

1. **No mid-segment blocking.** Workers never pause waiting for expansion
   approval. They finish their current segment normally, and expansion is
   processed between segments.

2. **Deterministic after approval.** Once an expansion is approved, the
   resulting segment DAG is as deterministic as a statically-planned one.
   Resume reconstructs the expanded graph from persisted state.

3. **Minimal blast radius.** Expansion modifies only the requesting task's
   segment frontier. It does not affect other tasks, lanes, or the wave plan.

4. **Fail-safe defaults.** Invalid requests (unknown repos, cycles) are
   rejected silently with worker notification. No batch state corruption.

---

## 1. Tool Contract — `request_segment_expansion`

### Registration

Registered in `agent-bridge-extension.ts` as an RPC tool available to worker
agents. Only available when the task has a segment plan (workspace mode).

### Input Schema

```typescript
{
  /** Repo IDs to add as new segments (must exist in workspace config) */
  requestedRepoIds: string[];          // required, non-empty

  /** Why the worker needs these repos */
  rationale: string;                   // required

  /** Where new segments should execute relative to current segment.
   *  "after-current" (default): new segments depend on the current segment.
   *  "end": new segments added at the end of the segment chain.
   *  "after:<segmentId>": new segments depend on the specified segment. */
  placement?: string;

  /** Optional edges between newly requested repos (if ordering matters) */
  edges?: Array<{ from: string; to: string }>;
}
```

### Output Schema

```typescript
{
  /** Whether the request was accepted for processing */
  accepted: boolean;

  /** Request ID for tracking (null if rejected) */
  requestId: string | null;

  /** Human-readable status message */
  message: string;

  /** Rejected repo IDs with reasons (if any) */
  rejections?: Array<{ repoId: string; reason: string }>;
}
```

### Validation (tool-level, immediate)

The tool performs lightweight validation before writing the request:

1. `requestedRepoIds` is non-empty
2. Each repo ID matches `^[a-z0-9][a-z0-9._-]*$`
3. No duplicate repo IDs in the request
4. None of the requested repos already exist in the task's segment plan

If validation fails, the tool returns `accepted: false` with rejection details.
The request file is NOT written. The worker can adjust and retry.

### Behavior

On valid input, the tool:
1. Writes a request file to the agent's outbox directory
2. Returns `accepted: true` with a request ID
3. The worker continues executing its current segment normally
4. The request is processed by the engine **after the current segment completes**

The worker should NOT wait for or poll for approval. It should finish its
current segment work and note in STATUS.md that expansion was requested.

---

## 2. File IPC Contract

### Request file location

```
.pi/runtime/{batchId}/agents/{agentId}/outbox/segment-expansion-{requestId}.json
```

### Request file schema

```typescript
interface SegmentExpansionRequest {
  /** Unique request ID */
  requestId: string;

  /** Task ID making the request */
  taskId: string;

  /** Segment ID that was active when the request was made */
  fromSegmentId: string;

  /** Repo IDs to add */
  requestedRepoIds: string[];

  /** Rationale from the worker */
  rationale: string;

  /** Placement directive */
  placement: "after-current" | "end" | `after:${string}`;

  /** Optional inter-segment edges for new repos */
  edges: Array<{ from: string; to: string }>;

  /** Timestamp of request */
  timestamp: number;
}
```

### Polling

The engine does NOT actively poll the outbox during segment execution.
Instead, request files are consumed at a natural lifecycle boundary:

- **When a segment completes** (success or failure), the engine checks for
  pending expansion request files in the completing agent's outbox.
- This aligns with the existing segment-frontier advancement logic in
  `engine.ts` (the `nextSegmentIndex` advancement block).

---

## 3. Engine Validation and Graph Mutation

When the engine finds expansion request files after a segment completes:

### Validation (engine-level, authoritative)

1. **Repo existence:** Each requested repo ID must exist in `workspace.repos`.
2. **No duplicates:** Requested repos must not already be in the task's
   `orderedSegments`.
3. **No cycles:** Adding the new segments with the requested edges must not
   create a cycle in the segment DAG.
4. **Task not terminal:** The task must still be in an active (non-terminal)
   state.
5. **Placement target valid:** If placement is `after:<segmentId>`, that
   segment must exist in the plan.

### On validation failure

- Engine logs the rejection with reason.
- Engine emits supervisor alert: `segment-expansion-rejected` with request
  details and rejection reason.
- Request file is renamed to `.rejected` (preserved for debugging).
- Task execution continues with the original segment plan.

### On validation success

Engine performs the graph mutation:

1. **Create new `TaskSegmentNode`** entries for each approved repo.
2. **Create edges** from the placement anchor to the new segments.
3. **Insert into `orderedSegments`** at the correct position (respecting
   topological order of the updated DAG).
4. **Update `SegmentFrontierTaskState`:**
   - Add new segments to `statusBySegmentId` (status: `"pending"`)
   - Add new entries to `dependsOnBySegmentId`
   - Do NOT change `nextSegmentIndex` (it still points to the next segment
     to execute, which may now be a newly-inserted one)
5. **Persist to batch state:**
   - Update `segments[]` array with new `PersistedSegmentRecord` entries
   - Update task's `segmentIds[]`
   - Record expansion event in `resilience.repairHistory` with full audit
6. **Emit supervisor alert:** `segment-expansion-approved` with the resulting
   DAG change.
7. **Rename request file** to `.processed`.

### Supervisor role

The engine performs validation and graph mutation directly. The supervisor is
**notified** but does not gate approval in autonomous mode.

| Autonomy Level | Behavior |
|---------------|----------|
| Autonomous | Engine auto-approves if validation passes. Supervisor notified. |
| Supervised | Engine pauses task, emits alert. Supervisor approves/rejects via tool. |
| Interactive | Engine pauses task, emits alert. Operator must approve. |

For supervised/interactive modes, a new supervisor tool is needed:

```
orch_approve_expansion(requestId)
orch_reject_expansion(requestId, reason)
```

---

## 4. Worker Lifecycle During Expansion

**The worker is unaffected.** The expansion request is fire-and-forget from
the worker's perspective:

1. Worker calls `request_segment_expansion` tool → gets acknowledgment
2. Worker continues current segment work normally
3. Worker completes segment (creates commits, updates STATUS.md)
4. Segment completes → engine processes expansion requests
5. Engine adds new segments → next segment execution picks them up

### What if the current segment fails?

If the segment that requested expansion fails:
- Pending expansion requests for that task are **discarded** (not processed).
- Request files are renamed to `.discarded`.
- Rationale: if the originating segment failed, its assessment of what other
  repos need changes may be invalid.

### What if the worker requests expansion for a repo it already has access to?

The tool rejects immediately (repo already in segment plan). The worker should
use its existing segment for that repo.

---

## 5. Scheduling Policy

### Within the current wave

New segments execute within the same task's lane, in the same wave. No wave
boundary is crossed. The task's segment frontier simply has more segments to
process before the task reaches terminal status.

### Worktree provisioning

Each new segment needs a worktree in the target repo. The engine uses the
same worktree provisioning logic as initial segment setup:

1. Check if orch branch exists in target repo (create if needed)
2. Create worktree: `.worktrees/{opId}-{batchId}/lane-{N}/` in the target repo
3. Worker executes in the new worktree

**Important:** If the target repo hasn't been touched by any task in this
batch, the orch branch must be created from the repo's default branch. The
`resolveBaseBranch` logic (v0.24.10) already handles this.

### Merge implications

After all segments complete (including dynamically-added ones), the wave merge
handles each repo's lane branch independently. The merge agent already merges
per-repo — no change needed to merge flow.

If a new repo was added via expansion that wasn't in the original plan:
- Its lane branch exists (created during segment execution)
- Its orch branch exists (created during worktree provisioning)
- The merge agent merges it like any other repo branch

---

## 6. Persistence and Resume

### Batch state changes

New segments are persisted immediately after approval:

```typescript
// Added to segments[] array
{
  segmentId: "TP-005::web-client",
  taskId: "TP-005",
  repoId: "web-client",
  status: "pending",
  laneId: "",
  sessionName: "",
  worktreePath: "",
  branch: "",
  startedAt: null,
  endedAt: null,
  retries: 0,
  exitReason: "",
  dependsOnSegmentIds: ["TP-005::api-service"],  // depends on originating segment
  // New field for expansion tracking:
  expandedFrom: "TP-005::api-service",  // which segment requested this
  expansionRequestId: "req-abc123",      // links to request file
}
```

### New fields on PersistedSegmentRecord

```typescript
/** Segment ID that requested this expansion (null for original segments) */
expandedFrom?: string | null;

/** Expansion request ID (null for original segments) */
expansionRequestId?: string | null;
```

### Resume reconstruction

`resume.ts` already reconstructs segment frontier from persisted segments.
Dynamically-added segments are indistinguishable from original ones after
persistence — they have the same fields and follow the same status lifecycle.

The only addition: `buildSegmentFrontierWaves()` must handle segments with
`dependsOnSegmentIds` that reference segments not in the original plan (the
originating segment). This should work naturally since the dependency map is
built from persisted data, not from the original plan.

---

## 7. Observability

### Supervisor alerts

| Event | When | Content |
|-------|------|---------|
| `segment-expansion-requested` | Tool writes request file | taskId, requestedRepoIds, rationale |
| `segment-expansion-approved` | Engine approves and mutates graph | taskId, new segments, resulting DAG |
| `segment-expansion-rejected` | Engine rejects request | taskId, rejections with reasons |

### Dashboard

- Dynamically-added segments should be visually distinguished (e.g., dashed
  border or expansion icon) so the operator knows the plan changed at runtime.
- Expansion history shown in task detail view.

### Batch summary

Post-batch summary should note any expansions:
```
TP-005: 2 segments planned + 1 expanded (web-client, approved)
```

---

## 8. Test Plan

### Unit tests (engine)

1. **Valid expansion request → graph mutation:**
   Given task with segments [A], request for repo B after A.
   Expect: segments become [A, B], B depends on A.

2. **Expansion to existing repo → rejection:**
   Given task with segments [A, B], request for repo B.
   Expect: rejected, plan unchanged.

3. **Expansion to unknown repo → rejection:**
   Given workspace with repos [api, web], request for repo "unknown".
   Expect: rejected, plan unchanged.

4. **Cycle detection → rejection:**
   Given task with segments [A→B], request for repo C with edge C→A.
   Expect: rejected (would create cycle A→B, C→A with placement after B).

5. **Multiple expansions → all processed:**
   Given task with segments [A], two expansion requests for B and C.
   Expect: segments become [A, B, C] with correct dependencies.

6. **Failed segment → expansions discarded:**
   Given segment A fails after requesting expansion to B.
   Expect: expansion request discarded, not processed.

### Integration tests (polyrepo)

7. **End-to-end expansion in polyrepo workspace:**
   Task starts with 1 segment (api-service). Worker requests expansion to
   web-client. After api-service segment succeeds, web-client segment
   executes. Both repos merged successfully.

8. **Resume after expansion:**
   Task has 3 segments [A(done), B(expanded, pending), C(original, pending)].
   Interrupt and resume. B and C execute correctly with proper dependencies.

### Regression tests

9. **Existing polyrepo tests pass unchanged:**
   All 6 existing polyrepo test tasks (3 single-repo + 3 multi-repo) must
   continue to pass. No behavioral change for tasks without expansion.

10. **Single-repo tasks unaffected:**
    `request_segment_expansion` tool not registered for repo-mode tasks.
    Expansion only available in workspace mode.

---

## 9. Implementation Task Breakdown

| Task | Size | Depends On | Scope |
|------|------|------------|-------|
| **TP-142:** `request_segment_expansion` tool + file IPC | M | — | Bridge extension tool, outbox file schema, tool-level validation |
| **TP-143:** Engine graph mutation + supervisor integration | M | TP-142 | Engine-side request processing, DAG mutation, persistence, alerts |
| **TP-144:** Polyrepo expansion acceptance tests | S | TP-143 | E2E test in polyrepo workspace, regression suite, resume test |

**Total:** ~2 M + 1 S tasks, serial dependency chain.

TP-142 can be developed and tested in isolation (tool writes files, unit tests
validate schema/rejection). TP-143 is the critical path — engine changes must
be carefully tested against existing polyrepo behavior. TP-144 validates the
full flow end-to-end.

---

## 10. What This Spec Does NOT Cover

- **Parallel segment execution within a task** — deferred, requires lane-level
  concurrency changes
- **Worker-initiated repo creation** — new repos must pre-exist in workspace config
- **Cross-task segment sharing** — each task owns its own segments exclusively
- **Automatic expansion without worker request** — the engine never adds
  segments on its own; only workers can request expansion

---

## Risks

1. **Engine state complexity:** Graph mutation during execution adds a state
   transition that didn't exist before. Mitigation: process only at segment
   boundaries (not mid-execution), extensive unit tests.

2. **Regression to existing polyrepo:** The engine's segment frontier logic
   changes. Mitigation: all existing polyrepo tests must pass in TP-144;
   expansion code paths are isolated behind request-file detection.

3. **Worktree provisioning for new repos:** First-time orch branch creation
   in a repo that wasn't planned at batch start. Mitigation: `resolveBaseBranch`
   already handles this (v0.24.10); add specific test coverage.

4. **Resume after partial expansion:** If the batch is interrupted between
   expansion approval and segment execution, resume must reconstruct correctly.
   Mitigation: expansion is persisted to batch state immediately on approval;
   resume reads persisted segments without distinguishing original from expanded.
