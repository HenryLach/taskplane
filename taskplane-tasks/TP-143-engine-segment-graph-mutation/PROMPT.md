# Task: TP-143 - Engine Segment Graph Mutation

**Created:** 2026-04-05
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Core engine mutation logic — modifies segment frontier, DAG rewiring, persistence. High-risk changes to scheduling internals.
**Score:** 6/8 — Blast radius: 2 (engine, persistence, resume), Pattern novelty: 2 (graph mutation at runtime), Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-143-engine-segment-graph-mutation/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Implement the engine-side processing of segment expansion requests: outbox consumption, validation, DAG mutation with successor rewiring, persistence, and supervisor alerts.

This is the critical path of dynamic segment expansion. The engine must mutate a running task's segment frontier without corrupting state or breaking existing polyrepo behavior.

**Implementation spec:** `docs/specifications/taskplane/dynamic-segment-expansion.md` (sections 3, 3a, 5, 6, 7)

## Dependencies

- **Task:** TP-142 (expansion tool and IPC — provides request file schema and SegmentId extensions)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `docs/specifications/taskplane/dynamic-segment-expansion.md` — full spec (sections 3, 3a, 4, 5, 6, 7)
- `extensions/taskplane/engine.ts` — `SegmentFrontierTaskState`, `buildSegmentFrontierWaves()`, segment advancement block (~line 1820), segment lifecycle transitions
- `extensions/taskplane/types.ts` — `SegmentExpansionRequest`, `TaskSegmentNode`, `TaskSegmentPlan`, `PersistedSegmentRecord`
- `extensions/taskplane/resume.ts` — segment frontier reconstruction from persisted state
- `extensions/taskplane/persistence.ts` — batch state serialization

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/tests/segment-expansion-engine.test.ts` (new)

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read spec sections 3, 3a, 4, 5, 6, 7 thoroughly
- [ ] Read engine.ts segment frontier logic: `SegmentFrontierTaskState`, `buildSegmentFrontierWaves()`, segment advancement (~line 1820+)
- [ ] Read resume.ts segment frontier reconstruction
- [ ] Understand the existing segment lifecycle: pending → running → succeeded/failed

### Step 1: Outbox consumption at segment boundaries
- [ ] In engine.ts, after a segment completes (success or failure), check for pending expansion request files in the completing agent's mailbox outbox
- [ ] Path: `.pi/mailbox/{batchId}/{agentId}/outbox/segment-expansion-*.json`
- [ ] Parse each file as `SegmentExpansionRequest`
- [ ] Malformed files → rename to `.invalid`, log warning, continue
- [ ] If originating segment failed → rename all request files to `.discarded`, emit alert, skip processing
- [ ] Process valid requests in requestId lexicographic order (deterministic)
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)

### Step 2: Engine validation
- [ ] For each valid request, validate:
  - Each repo ID exists in workspace config (`workspace.repos`)
  - Adding new segments with edges does not create a cycle
  - Task is not in terminal state
  - Placement is `"after-current"` or `"end"`
  - Request ID not already processed (idempotency guard)
- [ ] On validation failure: rename to `.rejected`, emit `segment-expansion-rejected` supervisor alert
- [ ] On validation success: proceed to graph mutation
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)

### Step 3: DAG mutation with successor rewiring
- [ ] Implement the formal rewiring algorithm from spec section 3:
  - Compute roots(N) and sinks(N) of the new segment subgraph
  - For `after-current`: add edges anchor→roots(N), rewire S_old from anchor to sinks(N)
  - For `end`: add edges from current terminals to roots(N)
- [ ] Create new `TaskSegmentNode` entries with disambiguated IDs (repeat-repo: `task::repo::N` where N = max existing + 1)
- [ ] Re-topologize `orderedSegments` via topological sort of the updated DAG
- [ ] Update `SegmentFrontierTaskState`: add to statusBySegmentId (pending), dependsOnBySegmentId, recalculate nextSegmentIndex
- [ ] Run targeted tests — verify all rewiring examples from spec

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)

### Step 4: Persistence and supervisor alerts
- [ ] Persist new segments to batch state: add to `segments[]` array as `PersistedSegmentRecord`
- [ ] Update task's `segmentIds[]`
- [ ] Record processed requestId for idempotency (in `resilience.repairHistory` or dedicated field)
- [ ] Emit `segment-expansion-approved` supervisor alert with before/after segment lists
- [ ] Rename request file to `.processed`
- [ ] Worktree provisioning for new segment repos: ensure orch branch exists, create worktree
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)
- `extensions/taskplane/persistence.ts` (modified if needed)
- `extensions/taskplane/types.ts` (modified — `expandedFrom`, `expansionRequestId` on PersistedSegmentRecord)

### Step 5: Resume compatibility
- [ ] Verify resume.ts reconstructs expanded segments from persisted state
- [ ] Expanded segments are indistinguishable from original after persistence (same fields, same lifecycle)
- [ ] Resume with approved-but-unexecuted expansion: segment is pending, frontier picks it up
- [ ] Resume with processed request files: idempotency guard prevents re-processing
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/resume.ts` (modified if needed)

### Step 6: Testing & Verification

> ZERO test failures allowed. Full suite quality gate.

- [ ] Create `extensions/tests/segment-expansion-engine.test.ts`
- [ ] Test: valid expansion → graph mutation correct (linear A→B→C + X after B = A→B→X→C)
- [ ] Test: repeat-repo → second-pass segment created with ::2 suffix
- [ ] Test: unknown repo → rejection
- [ ] Test: cycle detection → rejection
- [ ] Test: multiple requests same boundary → deterministic ordering
- [ ] Test: failed segment → requests discarded
- [ ] Test: duplicate requestId → idempotent skip
- [ ] Test: fan-out anchor rewiring (A→{B,C} + X after A = A→X→{B,C})
- [ ] Test: end placement (A→B→C + X at end = A→B→C→X)
- [ ] Test: end placement with multiple terminals
- [ ] Test: malformed request file → .invalid, no crash
- [ ] Test: resume after expansion preserves frontier
- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] **Regression:** All existing polyrepo-related tests pass unchanged
- [ ] Fix all failures

### Step 7: Documentation & Delivery
- [ ] JSDoc on new functions
- [ ] Update STATUS.md

## Documentation Requirements

**Must Update:**
- JSDoc on mutation functions in engine.ts

**Check If Affected:**
- `docs/specifications/taskplane/dynamic-segment-expansion.md` — update if implementation diverges
- `docs/explanation/waves-lanes-and-worktrees.md` — may need segment expansion mention

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing (including all existing polyrepo tests)
- [ ] Engine consumes expansion requests at segment boundaries
- [ ] DAG mutation with successor rewiring works for linear, fan-out, and end placement
- [ ] Repeat-repo segments created with disambiguated IDs
- [ ] Resume reconstructs expanded frontiers correctly
- [ ] No regressions to existing segment/polyrepo behavior

## Git Commit Convention

- `feat(TP-143): complete Step N — description`
- `fix(TP-143): description`
- `test(TP-143): description`

## Do NOT

- Modify the `request_segment_expansion` tool (that's TP-142)
- Change wave-level scheduling (wavePlan, totalWaves) — expansion is intra-task
- Modify existing segment planning logic (inference, DAG parsing)
- Break existing polyrepo tests
- Support `after:<segmentId>` placement (V1 is after-current + end only)

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
