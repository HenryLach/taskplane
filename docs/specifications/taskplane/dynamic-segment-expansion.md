# Dynamic Segment Expansion — Implementation Specification

**Status:** Draft (Sage-reviewed, hardened)
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

## 0. SegmentId Grammar and Parsing

The current `SegmentId` type is `${taskId}::${repoId}`. Dynamic expansion
introduces repeat-repo segments with a sequence suffix: `taskId::repoId::N`.

### Canonical grammar

```
SegmentId := <taskId> "::" <repoId> [ "::" <sequenceNumber> ]

taskId        := [A-Z]+-[0-9]+        (e.g., "TP-005")
repoId        := [a-z0-9][a-z0-9._-]*  (e.g., "api-service")
sequenceNumber := [2-9][0-9]*          (omitted for first segment, starts at 2)
```

Examples:
- `TP-005::api-service` — original segment
- `TP-005::api-service::2` — first expansion (second pass)
- `TP-005::web-client` — original segment in different repo

### Parsing rule

**`SegmentId` is opaque.** Code must NEVER infer `repoId` by string-splitting
a segment ID. The `repoId` field is always available on the structured
`TaskSegmentNode` and `PersistedSegmentRecord` objects. Use those.

`buildSegmentId()` in `types.ts` is extended to accept an optional sequence:

```typescript
export function buildSegmentId(
  taskId: string,
  repoId: string,
  sequence?: number,
): SegmentId {
  if (sequence && sequence >= 2) {
    return `${taskId}::${repoId}::${sequence}` as SegmentId;
  }
  return `${taskId}::${repoId}` as SegmentId;
}
```

All existing callers pass no sequence and behave identically.

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
   *  "after-current" (default): inserted after the completing segment,
   *    before its existing successors.
   *  "end": appended after all existing segments (no successor rewiring). */
  placement?: "after-current" | "end";

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
3. No duplicate repo IDs within the same request

Note: requesting a repo that already has a segment is **allowed**. This creates
a second-pass segment for that repo (see "Repeat-repo segments" below).

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
.pi/mailbox/{batchId}/{agentId}/outbox/segment-expansion-{requestId}.json
```

This aligns with the existing mailbox layout used by agent replies and
steering messages. The `outbox/` directory is already created by the
engine when spawning agents with mailbox support.

### Request file schema

```typescript
interface SegmentExpansionRequest {
  /** Unique request ID — format: `exp-{timestamp}-{random5}` (lexicographically sortable) */
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
  placement: "after-current" | "end";

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
2. **No cycles:** Adding the new segments with the requested edges must not
   create a cycle in the segment DAG.
3. **Task not terminal:** The task must still be in an active (non-terminal)
   state.
4. **Placement valid:** Must be `"after-current"` or `"end"`.
5. **Request idempotency:** If a request with the same `requestId` was already
   processed, skip it (replay-safe on resume).

Repeat-repo requests (repo already in plan) are valid — the engine creates a
second-pass segment with a disambiguated ID. See "Repeat-repo segments" below.

### On validation failure

- Engine logs the rejection with reason.
- Engine emits supervisor alert: `segment-expansion-rejected` with request
  details and rejection reason.
- Request file is renamed to `.rejected` (preserved for debugging).
- Task execution continues with the original segment plan.

### On validation success

Engine performs the graph mutation:

1. **Create new `TaskSegmentNode`** entries for each approved repo.

2. **Create edges with successor rewiring (formal algorithm):**

   Let `anchor` = the completing segment, `N` = set of new segment nodes,
   `S_old` = existing successor set of `anchor` (segments that depend on it).

   ```
   roots(N)  = nodes in N with no incoming edges from other N nodes
   sinks(N)  = nodes in N with no outgoing edges to other N nodes

   if placement == "after-current":
     for each r in roots(N): add edge anchor → r
     for each s in S_old:
       remove edge anchor → s
       for each k in sinks(N): add edge k → s

   if placement == "end":
     terminals = segments with no successors in the current DAG
     for each t in terminals: add edge t → roots(N)[0]
     (no successor rewiring needed)
   ```

   Examples:
   - Linear: `A → B → C`, expand `X` after `B`.
     roots={X}, sinks={X}, S_old={C}.
     Result: `A → B → X → C` ✓

   - Multi-insert: `A → B → C`, expand `X → Y` after `B`.
     roots={X}, sinks={Y}, S_old={C}.
     Result: `A → B → X → Y → C` ✓

   - Fan-out anchor: `A → {B, C}`, expand `X` after `A`.
     roots={X}, sinks={X}, S_old={B, C}.
     Result: `A → X → {B, C}` ✓

   - End placement: `A → B → C`, expand `X` at end.
     terminals={C}. Result: `A → B → C → X` ✓

3. **Re-topologize `orderedSegments`** from the updated DAG. The array is
   rebuilt via topological sort (not spliced), ensuring deterministic ordering.

4. **Update `SegmentFrontierTaskState`:**
   - Add new segments to `statusBySegmentId` (status: `"pending"`)
   - Add new entries to `dependsOnBySegmentId`
   - Recalculate `nextSegmentIndex` to point to the first pending segment
     in the re-topologized array (may be a newly-inserted one)

5. **Persist to batch state (atomic):**
   - Update `segments[]` array with new `PersistedSegmentRecord` entries
   - Update task's `segmentIds[]`
   - Record processed `requestId` in expansion audit (idempotency guard)
   - Record expansion event in `resilience.repairHistory` with full audit
   - Note: `wavePlan` and `totalWaves` are NOT modified — segment expansion
     is intra-task, within the existing wave. The wave contains the task ID;
     the task's segment frontier handles the expanded segment set internally.

6. **Emit supervisor alert:** `segment-expansion-approved` with the resulting
   DAG change (before/after segment lists, new edges).

7. **Rename request file** to `.processed`.

### Multiple requests at the same boundary

If a segment completes with multiple pending expansion requests, they are
processed in `requestId` order (lexicographic, which is timestamp-based).
Each request's successor rewiring operates on the already-mutated graph
from prior requests. This is deterministic and replay-safe.

### Request lifecycle states

Request files transition through states via file extension:

| State | File suffix | Meaning |
|-------|------------|--------|
| Pending | `.json` | Written by tool, awaiting processing |
| Processed | `.processed` | Engine approved and applied |
| Rejected | `.rejected` | Engine validation failed |
| Discarded | `.discarded` | Originating segment failed |
| Invalid | `.invalid` | File unparseable or schema violation |

**Malformed request files** (JSON parse error, missing required fields,
unknown schema) are renamed to `.invalid` with a log entry. They do not
block processing of other valid requests at the same boundary.

### Supervisor role

The engine performs validation and graph mutation directly. The supervisor is
**notified** but does not gate approval in autonomous mode.

| Autonomy Level | Behavior |
|---------------|----------|
| Autonomous | Engine auto-approves if validation passes. Supervisor notified after. |
| Supervised | Engine queues request, emits alert. Supervisor approves/rejects. Other tasks/lanes continue. |
| Interactive | Engine queues request, emits alert. Operator must approve. Other tasks/lanes continue. |

**Pause semantics (supervised/interactive):** Only the requesting task's
segment frontier is paused — it will not advance to the next segment until
the expansion is approved or rejected. Other tasks in the same wave and other
lanes continue unaffected. This is NOT a batch pause or lane pause.

Implementation: the engine sets a `pendingExpansion` flag on the task's
`SegmentFrontierTaskState`. The segment advancement check skips this task
until the flag is cleared (by approval or rejection).

For supervised/interactive modes, new supervisor tools are needed:

```
orch_approve_expansion(requestId)
orch_reject_expansion(requestId, reason)
```

**V1 simplification:** For the initial implementation, only autonomous mode
is supported. Supervised/interactive gating is deferred to a follow-up.
This avoids the complexity of task-level pause without blocking the feature.

**Non-autonomous guard (V1):** In supervised/interactive mode, the
`request_segment_expansion` tool returns `accepted: false` with message
"Segment expansion requires autonomous supervisor mode." The tool is
registered but hard-disabled — not silently auto-approved.

---

## 3a. Repeat-Repo Segments

A worker may discover during segment execution that a previously-completed
repo needs additional changes. For example:

- Task plan: `Seg1(repoA) → Seg2(repoB) → Seg3(repoC)`
- During Seg2, worker realizes repoA needs further modifications
- Worker requests expansion for repoA

This is **allowed**. The engine creates a second-pass segment for the same
repo with a disambiguated segment ID.

### Segment ID for repeat repos

The standard segment ID format `taskId::repoId` would collide with the
existing segment. Repeat-repo segments use a sequence suffix:

```
TP-005::api-service      ← original (Seg1)
TP-005::api-service::2   ← second pass (expansion)
TP-005::api-service::3   ← third pass (if needed)
```

The suffix is assigned by the engine at approval time as
`max(existing sequences for this task+repo) + 1`. This is resume-safe —
the sequence is derived from persisted segment records, not runtime state.

`buildSegmentId()` is extended to accept an optional sequence number.

### Default placement: run next

When a worker requests a repeat-repo segment, the default placement is
**immediately after the current segment** (not at the end of the chain).
Rationale: if the worker discovered that a previously-visited repo needs
more work, those changes are likely prerequisites for downstream segments.

Using the example above:
- Original plan: `Seg1(repoA) → Seg2(repoB) → Seg3(repoC)`
- After Seg2 requests repoA expansion: `Seg1(repoA) → Seg2(repoB) → Seg2a(repoA::2) → Seg3(repoC)`

The worker can override this with the `placement` field if different ordering
is needed, but "after-current" is the default and the common case.

### Worktree for repeat-repo segments

The repeat segment gets a **fresh worktree** branched from the current orch
branch state (which includes the original segment's merged work). This ensures
the second-pass worker sees all prior changes.

The original segment's worktree may have been cleaned up after its wave's
merge. The repeat segment provisions a new one, same as any other segment.

### STATUS.md continuity

The worker in the repeat segment reads STATUS.md (packet home repo) and sees
all notes from prior segments, including the original repo A segment and the
repo B segment that triggered the expansion. This preserves full task context.

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

### What if the worker requests expansion for a repo that already has a segment?

This is allowed — the engine creates a repeat-repo segment with a
disambiguated ID (e.g., `TP-005::api-service::2`). See section 3a.

The worker's current segment can only write to the active segment repo.
If it needs a *second pass* at a previously-completed repo, expansion is
the correct mechanism.

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
// Added to segments[] array (new repo)
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

2. **Repeat-repo expansion → second-pass segment created:**
   Given task with segments [A, B], worker in B requests repo A.
   Expect: segments become [A, B, A::2], A::2 depends on B, uses
   disambiguated segment ID.

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

### Mutation safety tests

7. **"after-current" rewires successors correctly:**
   Given plan `A → B → C`, expansion adds X after B.
   Expect: result is `A → B → X → C` (C now depends on X, not B).

8. **Duplicate request ID is idempotent:**
   Process same requestId twice. Expect: second processing is a no-op.

9. **Multiple requests at same boundary, conflicting placements:**
   Segment B completes with two requests: add X after-current, add Y at end.
   Expect: X inserted after B (with successor rewiring), Y appended at end.

10. **Resume after approved-but-unexecuted expansion:**
    Expansion approved, new segment persisted as pending, batch interrupted.
    Resume reconstructs frontier with expanded segments, executes them.

### Regression tests

11. **Existing polyrepo tests pass unchanged:**
    All 6 existing polyrepo test tasks (3 single-repo + 3 multi-repo) must
    continue to pass. No behavioral change for tasks without expansion.

12. **Single-repo tasks unaffected:**
    `request_segment_expansion` tool not registered for repo-mode tasks.
    Expansion only available in workspace mode.

13. **Failure discard produces audit trail:**
    Segment fails after requesting expansion. Request file renamed to
    `.discarded`. Supervisor alert emitted with discard reason.

14. **Fan-out anchor rewiring:**
    Plan `A → {B, C}`, expand X after A.
    Expect: `A → X → {B, C}` (both B and C depend on X).

15. **"end" placement with multiple terminals:**
    Plan has terminals {B, C} (no successors). Expand X at end.
    Expect: both B and C gain edge to X.

16. **Non-autonomous mode rejects tool call:**
    Supervisor autonomy is "supervised". Worker calls tool.
    Expect: `accepted: false`, message explains autonomous required.

17. **Malformed request file handled gracefully:**
    Invalid JSON in outbox. Expect: renamed to `.invalid`, no crash,
    other valid requests still processed.

18. **Repeat-repo sequence assignment after resume:**
    Task has `api::1` (done) and `api::2` (done, from expansion).
    New expansion for api. Expect: sequence = 3.

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
