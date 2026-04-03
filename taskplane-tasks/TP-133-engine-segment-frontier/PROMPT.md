# Task: TP-133 - Engine Segment Frontier MVP

**Created:** 2026-04-03
**Size:** M

## Review Level: 2 (Plan + Code)

**Assessment:** Core engine change — decomposing task-level execution into segment-level frontier. High correctness impact. Touches engine.ts wave loop.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-133-engine-segment-frontier/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Make the engine consume segment plans from `computeWaveAssignments()` and execute at segment granularity instead of task granularity. The engine currently treats each task as a single execution unit. In workspace mode, a task may span multiple repos (segments), and the engine must execute each segment sequentially per-task while preserving cross-task parallelism across lanes.

### What already exists

- `waves.ts`: `buildSegmentPlanForTask()` and `buildTaskSegmentPlans()` produce `TaskSegmentPlan` with segments and edges
- `computeWaveAssignments()` returns `segmentPlans` alongside wave assignments
- `types.ts`: `ExecutionUnit`, `PacketPaths`, `SegmentId`, `TaskSegmentPlan`, `TaskSegmentNode`, `TaskSegmentEdge`
- `execution.ts`: `buildExecutionUnit()` creates `ExecutionUnit` with `segmentId` and `packetHomeRepoId`
- `ParsedTask` has `segmentIds[]` and `activeSegmentId` fields (schema v4)

### What's missing

- Engine doesn't consume `segmentPlans` — it sends whole tasks to lanes
- No segment frontier tracking in the engine loop
- Completion detection checks `.DONE` in the execution repo, not the packet home repo
- No segment lifecycle state transitions during execution

## Dependencies

- **Task:** TP-132 (spec V2 alignment)

## Context to Read First

- `extensions/taskplane/engine.ts` — wave loop, task execution dispatch
- `extensions/taskplane/execution.ts` — `buildExecutionUnit()`, `executeLaneV2()`
- `extensions/taskplane/waves.ts` — `computeWaveAssignments()`, segment plan builders
- `extensions/taskplane/types.ts` — ExecutionUnit, TaskSegmentPlan, ParsedTask

## File Scope

- `extensions/taskplane/engine.ts`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/types.ts` (minor, if needed)
- `extensions/tests/*.test.ts`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Trace the engine's current wave loop task execution flow
- [ ] Trace how `computeWaveAssignments()` produces `segmentPlans`
- [ ] Identify the task dispatch point where segment decomposition should occur

### Step 1: Segment frontier in engine
- [ ] After wave planning, decompose multi-segment tasks into segment execution units
- [ ] For repo-singleton tasks (single repo), behavior is unchanged (one segment = one task)
- [ ] For multi-segment tasks, execute segments sequentially per-task, respecting segment DAG edges
- [ ] Track active segment per task in `ParsedTask.activeSegmentId`
- [ ] Update `ParsedTask.segmentIds` during execution

### Step 2: Packet-home completion authority
- [ ] Ensure `.DONE` check uses `ExecutionUnit.packet.donePath` (packet home repo path)
- [ ] Ensure `STATUS.md` reads use `ExecutionUnit.packet.statusPath`
- [ ] Preserve backward compat for repo-mode (packet home = execution repo)

### Step 3: Segment lifecycle transitions
- [ ] Track segment status transitions: pending → running → succeeded/failed
- [ ] On segment completion, advance to next segment in task's segment plan
- [ ] On all segments complete, mark task complete
- [ ] On segment failure, apply task failure policy (skip dependents, etc.)

### Step 4: Tests
- [ ] Test: repo-singleton tasks execute unchanged (no regression)
- [ ] Test: multi-segment task executes segments sequentially
- [ ] Test: segment DAG edges are respected (B waits for A)
- [ ] Test: completion detected via packet home path, not execution repo
- [ ] Run full suite, fix failures

### Step 5: Documentation & Delivery
- [ ] Update STATUS.md

## Do NOT

- Implement dynamic segment expansion (deferred)
- Change wave planning logic (segments are already planned by waves.ts)
- Break single-repo execution behavior
- Modify lane-runner.ts in this task (TP-134 handles that)

## Git Commit Convention

- `feat(TP-133): complete Step N — ...`
