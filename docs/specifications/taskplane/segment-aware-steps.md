# Specification: Segment-Aware Steps for Multi-Repo Tasks

**Status:** Draft v4
**Created:** 2026-04-12
**Updated:** 2026-04-12
**Author:** Supervisor + Operator
**Reviewed by:** Sage (v3 architectural review)
**Related issues:** #492, #495, #496

---

## Problem Statement

Multi-segment polyrepo tasks consistently fail or require supervisor intervention
because workers cannot distinguish which steps belong to their current segment.
A worker in the `shared-libs` worktree sees steps for `api-service` and either:

- Attempts cross-repo work it can't do (wrong worktree)
- Logs a blocker and exits
- Gets stuck in a no-progress loop with unchecked boxes for future segments

This happened on every multi-segment task in polyrepo testing (TP-004, TP-005).
The supervisor had to steer workers and send wrap-up signals to recover — defeating
the purpose of autonomous execution.

### Root Cause

The system was designed for single-segment tasks where one worker does all steps.
Multi-segment support was added at the engine level (worktrees, segment frontier,
expansion) but the worker-facing contract (PROMPT.md steps, STATUS.md checkboxes,
progress tracking) was never updated to be segment-aware.

---

## Design Goals

1. **Workers only see checkboxes for their current segment** — no cross-repo confusion
2. **Steps are the primary unit of work; segments describe where work happens**
3. **Segments within a step can eventually run in parallel** — repo isolation enables this
4. **Dynamic expansions carry step definitions** — the discovering worker defines
   what the next segment should do
5. **The create-taskplane-task skill pre-decomposes** — minimize dynamic expansion
   by predicting cross-repo work upfront
6. **Backward compatible** — single-segment tasks (the majority) work exactly as before
7. **Phased rollout** — immediate fix (visibility) ships first; parallelism and
   step-boundary merges require deeper architecture work

---

## Architecture Note: Phased Approach

Sage architectural review of v3 identified that the full vision (parallel segments,
step-boundary merges, per-repo merge queues) represents a **new scheduler**, not
an incremental change to the current segment-frontier DAG engine. Key conflicts:

- Parallel segment workers would race on shared artifacts (STATUS.md, review files)
- In-memory merge queue isn't crash-safe (violates resume contract)
- Step 1.1 naming breaks integer step parsers throughout the codebase
- Supervisor tools (force-merge, retry, skip) are wave-oriented

The specification is therefore split into:

- **Phase A (immediate):** Segment-scoped worker visibility. No parallelism,
  no new merge model. Uses the existing sequential segment execution. Solves
  the acute "worker sees wrong repo" problem.
- **Phases B–F (future):** Parallel segments, step-boundary merges, new state
  schema, artifact ownership redesign. Requires careful architecture work.
  Strategy is outlined but implementation details need further design.

---

## PROMPT.md Format: Segments Inside Steps

This format applies to ALL phases. Steps are the primary organizer — they
describe **what** to accomplish. Segments within steps describe **where** the
work happens.

**Single-segment task (unchanged):**

```markdown
## Steps

### Step 0: Preflight
- [ ] Verify project structure

### Step 1: Implement feature
- [ ] Create src/utils.js
- [ ] Add tests

### Step 2: Testing & Verification
- [ ] Run full test suite
```

No segment markers needed. Works exactly as today.

**Multi-segment task:**

```markdown
## Steps

### Step 0: Preflight

#### Segment: shared-libs
- [ ] Verify shared-libs repo and src/ directory

#### Segment: web-client
- [ ] Read brand guidelines spec

### Step 1: Create string utilities and API client

#### Segment: shared-libs
- [ ] Create src/string-utils.js with capitalize, slugify, truncate
- [ ] JSDoc comments on each function

#### Segment: web-client
- [ ] Create src/api/client.js importing from shared-libs
- [ ] Add JSDoc comments

### Step 2: Documentation & Delivery

#### Segment: shared-libs
- [ ] Update STATUS.md
- [ ] Verify cross-repo integration
```

**Key rules:**

- `#### Segment: <repoId>` is a checkbox group marker within a step
- Steps are numbered globally and sequentially (Step 0, 1, 2, ...)
- A repoId appears at most once within a step (all checkboxes for that
  step/repo combination are grouped together)
- Steps without any `#### Segment:` markers belong to the task's primary repo
  (backward compatible with single-segment tasks)
- The create-taskplane-task skill should always include explicit segment
  markers in multi-repo tasks (better for historical reference)
- Fallback when segment marker is missing: assign to the packet repo

**STATUS.md mirrors the structure:**

```markdown
### Step 1: Create utilities and API client
**Status:** 🟡 In Progress

#### Segment: shared-libs
- [x] Create src/string-utils.js
- [x] JSDoc comments

#### Segment: web-client
- [ ] Create src/api/client.js
- [ ] JSDoc comments
```

---

# Phase A: Segment-Scoped Worker Visibility (Immediate)

**Goal:** Workers only see and execute checkboxes for their current segment.
No changes to the execution model, merge model, or state schema. Uses the
existing sequential segment-frontier execution.

**Risk:** Low — additive changes to discovery parsing, lane-runner prompt
construction, and progress tracking. No changes to engine scheduling or
merge flow.

## A.1 Discovery: Parse Segment-Step Mapping

`discovery.ts` parses `#### Segment: <repoId>` markers within each step:

```typescript
interface SegmentCheckboxGroup {
  repoId: string;
  checkboxes: string[];  // raw checkbox text from PROMPT.md
}

interface StepSegmentMapping {
  stepNumber: number;
  stepName: string;
  segments: SegmentCheckboxGroup[];
}
```

The mapping is stored in `ParsedTask.stepSegmentMap` and made available to
the engine and lane-runner.

**Parsing rules:**

- Scan each `### Step N:` section for `#### Segment: <repoId>` sub-headers
- Checkboxes (`- [ ]`) after a segment header belong to that segment
- Checkboxes before any segment header (or in steps with no segment headers)
  belong to the task's primary repoId (packet repo fallback)
- Segment repoId must match a repo in the workspace config
- If repoId doesn't match: flag as a discovery warning (non-fatal). The
  worker will attempt inference at runtime or escalate to supervisor.

**Backward compatibility:** Tasks without segment markers produce a single
segment per step with the task's primary repoId. Identical to today.

**Validation at discovery time (not runtime):**

- Unknown repoId → discovery warning with suggested matches
- Duplicate repoId within same step → discovery error
- Empty segment (no checkboxes) → discovery warning

## A.2 Lane-Runner: Segment-Scoped Prompt

When spawning a worker for a segment, the lane-runner uses the step-segment
mapping to filter what the worker sees.

**Changes to iteration prompt construction (`lane-runner.ts`):**

1. Read `stepSegmentMap` from the task's parsed data (passed via config or
   re-parsed from PROMPT.md in the worktree)
2. Identify the current step and the active segment's repoId
3. Extract only the current segment's checkboxes for the current step
4. Inject segment context into the prompt:

```
Active segment: TP-005::api-service (Step 2, segment 2 of 2)
Your repo: api-service

Your checkboxes for this step:
  - [ ] Create src/middleware/logger.js
  - [ ] Import formatLogEntry from shared-libs
  - [ ] Log request method, path, timing

Other segments in this step (NOT yours — do not attempt):
  - shared-libs: 2 checkboxes (will run in a separate segment)

Prior steps completed: Step 0 (preflight), Step 1 (shared-libs utility created)

When all YOUR checkboxes are checked, your segment is done — exit successfully.
Do NOT attempt work in other repos.
```

5. The "remaining steps" list only includes steps that have a segment for the
   current repoId. Steps with no segment for this repo are omitted.

**What the worker sees vs. today:**

| | Today | Phase A |
|---|---|---|
| Checkboxes | All steps, all segments | Current step, current segment only |
| Step list | All steps | Only steps with segments for this repo |
| Exit condition | All steps complete | Current segment's checkboxes complete |
| Progress denominator | All checkboxes in task | Segment's checkboxes in current step |

## A.3 Segment-Scoped Progress Tracking

**Stall detection** only counts the current segment's checkboxes:

```typescript
// Before (today): count ALL checkboxes in STATUS.md
const afterTotalChecked = afterStatus.steps.reduce((sum, s) => sum + s.totalChecked, 0);

// After (Phase A): count only current segment's checkboxes
const segmentCheckboxes = getSegmentCheckboxes(statusContent, currentStepNumber, currentRepoId);
const afterSegmentChecked = segmentCheckboxes.filter(cb => cb.checked).length;
const progressDelta = afterSegmentChecked - prevSegmentChecked;
```

A worker in the shared-libs segment is not penalized for unchecked web-client
boxes. This eliminates the false-stall loop from polyrepo testing.

**Soft progress detection** (git diff check) continues to work as-is — it
checks the worktree for uncommitted changes regardless of segment scoping.

## A.4 Segment Exit Condition

The lane-runner detects segment completion by checking if all checkboxes in
the current segment's block are checked:

```typescript
function isSegmentComplete(statusContent: string, stepNumber: number, repoId: string): boolean {
  const segmentBlock = extractSegmentBlock(statusContent, stepNumber, repoId);
  if (!segmentBlock) return false;
  const unchecked = segmentBlock.match(/^- \[ \] /gm);
  return !unchecked || unchecked.length === 0;
}
```

When the segment is complete:
- If there are more steps with segments for this repoId → advance to next step
  (existing step-advancement logic)
- If no more steps for this repoId → segment is done, suppress .DONE if non-final
  (existing TP-165 logic)

**No changes to .DONE handling.** The existing .DONE suppression for non-final
segments (TP-165) works as-is. Phase A doesn't change when .DONE is created —
it only changes what the worker sees.

## A.5 Execution Model (Unchanged from Today)

Phase A uses the **existing sequential segment execution model**:

```
Wave N:
  Task TP-004:
    Segment TP-004::shared-libs → worker runs Steps 0,1 (shared-libs checkboxes only)
    → wave merge
  Next wave:
    Segment TP-004::web-client → worker runs Steps 1,2 (web-client checkboxes only)
    → wave merge
```

Segments still execute sequentially across waves. The only change is that each
segment's worker sees only its own checkboxes, not the full task.

**Limitation:** Step 1's web-client segment runs in a later wave than Step 1's
shared-libs segment. They are NOT parallel in Phase A. The web-client worker
CAN see shared-libs changes because the wave merge happened between segments.

This is suboptimal (no parallelism) but correct and safe. Parallelism is
Phase C.

## A.6 Worker Prompt Changes

Add to `templates/agents/task-worker.md`:

```markdown
## Multi-Segment Tasks

You may be executing one segment of a multi-segment task. Your iteration
prompt tells you which segment is active and which checkboxes are yours.

**Rules:**
- Only work on checkboxes listed for your current segment
- When all your segment's checkboxes are checked, your work is done — exit
  successfully
- Do NOT attempt to modify files in repos not available in your worktree
- If you discover work needed in another repo, use `request_segment_expansion`
  with step definitions describing what the next segment's worker should do
- Include a `context` field with knowledge the next worker will need

**Context from prior segments:**
If your prompt includes "Context from prior segment," this was written by
a worker who discovered the need for your work. Use it to understand what
was built and what you need to do.
```

## A.7 Create-Taskplane-Task Skill Updates

Update the skill to generate segment markers for multi-repo tasks:

1. Read workspace config to identify available repos
2. When file scope spans multiple repos, group checkboxes by repo within steps
3. Always write explicit `#### Segment: <repoId>` markers (never rely on fallback)
4. Order steps so that dependencies flow correctly:
   - Shared/common work → early steps
   - Per-repo implementation → middle steps
   - Integration/documentation → final steps (in packet repo)
5. The final documentation/delivery step always uses `#### Segment: <packet-repo>`

**Upper limit guideline:** Max 10 segments per task. Tasks spanning more repos
should be split into separate tasks with dependencies.

## A.8 Dashboard Changes (Minimal)

Phase A dashboard changes are minimal since execution is still sequential:

- The 👁 STATUS.md viewer should show the **segment-scoped view** when a
  multi-segment task is displayed (only the current segment's checkboxes,
  not the full STATUS.md)
- The progress bar should reflect segment-scoped progress (checked/total for
  current segment, not full task)

## A.9 Testing Plan

- **Unit tests:** discovery.ts segment-step parsing (markers, fallback, errors)
- **Unit tests:** lane-runner segment-scoped prompt construction
- **Unit tests:** segment-scoped progress counting and stall detection
- **Unit tests:** segment exit condition detection
- **Integration test:** polyrepo task with segment markers — worker only sees
  its segment's checkboxes, completes segment, exits cleanly
- **Regression test:** single-segment task — no behavior change
- **Regression test:** multi-segment task WITHOUT markers — legacy fallback

## A.10 Files Changed

| File | Change |
|------|--------|
| `extensions/taskplane/discovery.ts` | Parse `#### Segment:` markers, build StepSegmentMapping |
| `extensions/taskplane/lane-runner.ts` | Segment-scoped prompt, progress, stall detection, exit condition |
| `extensions/taskplane/types.ts` | Add StepSegmentMapping types to ParsedTask |
| `extensions/taskplane/sidecar-telemetry.ts` | Segment-scoped progress reporting |
| `templates/agents/task-worker.md` | Multi-segment rules section |
| `skills/create-taskplane-task/` | Segment marker generation for multi-repo tasks |
| `dashboard/public/app.js` | Segment-scoped 👁 viewer and progress bar |
| `extensions/tests/` | New test files for segment parsing, scoping, exit condition |

## A.11 Definition of Done

- [ ] Workers in polyrepo tasks only see their segment's checkboxes
- [ ] Workers exit cleanly when their segment's checkboxes are complete
- [ ] Stall detection uses segment-scoped checkbox count
- [ ] Single-segment tasks are completely unaffected
- [ ] Multi-segment tasks without markers fall back to packet repo (legacy)
- [ ] Polyrepo smoke test (tp-test-workspace) passes without supervisor intervention
- [ ] All existing tests pass (3300+)

---

# Phase B: Step-Segment State Model (Future)

**Goal:** Design the persisted state schema that supports step-level execution
tracking, per-segment artifact ownership, and durable merge queues. This is
the architecture foundation for Phases C–F.

**Status:** Strategy outlined. Requires detailed design before implementation.

## B.1 Key Design Decisions Needed

### New execution unit identity

Define `StepSegmentExecution = {taskId, stepOrdinal, repoId}` with stable
internal IDs. Do not use decimal step labels (1.1, 1.2) as identity — use
integer ordinals internally, display decimals in the UI.

**Open question:** Should the execution unit be a new concept alongside the
existing segment-frontier, or should it replace it? Running both models in
parallel creates confusion. Sage recommends picking one source of truth.

### State schema v5

The current batch-state.json (schema v4) tracks waves, tasks, and segments.
Phase B needs to add:

- Per-step-segment lifecycle (pending → running → succeeded → failed)
- Per-step merge intents and results
- Per-repo merge queue backlog (durable across crash/resume)
- Step completion tracking per task

**Open question:** Is batch-state.json the right place for this, or should
step-segment state live in a separate file to keep batch-state manageable?

### Artifact ownership redesign

Today, these artifacts are task-global and file-based:

| Artifact | Problem with parallel segments |
|----------|-------------------------------|
| `STATUS.md` | Two segment workers write simultaneously → lost updates |
| `.reviews/R001-step1.md` | Keyed by step number → two segments in Step 1 collide |
| `.reviewer-state.json` | Task-global → parallel reviewers corrupt state |
| Execution log in STATUS.md | Append-only but from multiple writers → interleaved |

**Required redesign:** Per-segment sidecars with a deterministic reducer to
produce the task-level STATUS.md view. Possible approaches:

- Segment-specific STATUS files: `STATUS.segment.shared-libs.md`
- Segment-namespaced review files: `R001-step1-shared-libs.md`
- Write-ahead log per segment, reducer merges into canonical STATUS.md

### Expanded step naming (internal vs. display)

Dynamic expansion creates sub-steps. Internally, use integer ordinals:

```
Step 0 → ordinal 0
Step 1 → ordinal 1
Step 1.1 (expanded) → ordinal 2
Step 2 → ordinal 3
```

Display as `Step 1.1` for human readability, but the engine and parsers
use ordinals. This avoids breaking the `Step (\d+)` regex throughout the
codebase.

## B.2 Failure Matrix

Must be explicitly defined before implementation:

| Failure | Behavior | Effect on dependents |
|---------|----------|---------------------|
| One segment fails within a step | Step fails. Other segments in step may continue or be killed (policy). | Next step does not start. |
| Step merge fails in one repo | Retry merge. If retry fails, pause task (supervisor decides). | Other repos' merges for same step may proceed or wait (policy). |
| Verification fails post-step merge | Rollback merge? Pause task? Retry step? | Needs explicit policy. |
| Task fails mid-step | Partial step work on orch branch from prior step merges. Retry/skip at task level. | Dependent tasks blocked. |
| Engine crash during merge queue processing | Resume must reconstruct queue from durable state. | Merges re-evaluated on resume. |

## B.3 Supervisor Tool Surface

Current tools are wave-oriented:

| Tool | Current | Needs for step-segment model |
|------|---------|------------------------------|
| `orch_retry_task` | Retries full task | Retry specific step or segment? |
| `orch_skip_task` | Skips full task | Skip specific segment? |
| `orch_force_merge` | Force-merges a wave | Force-merge a step? |
| `orch_status` | Shows wave progress | Show step-segment progress? |

These need design work to support step-level granularity without breaking
the existing wave-level commands.

---

# Phase C: Step-Boundary Merges and Parallel Segments (Future)

**Goal:** Enable parallel segment execution within a step and merge at step
boundaries instead of wave boundaries.

**Status:** Strategy defined. Depends on Phase B state model.

**Prerequisites:** Phase B (state schema, artifact ownership, failure matrix).

## C.1 Execution Model

Each step becomes a mini-wave for the task:

```
Step 1 starts
├── Provision worktrees for each segment's repo (from latest orch branch HEAD)
├── Spawn parallel workers (one per segment, up to maxSegmentConcurrency)
│   ├── shared-libs worker: executes shared-libs checkboxes
│   └── web-client worker: executes web-client checkboxes
│   └── (overflow segments queue until a slot opens)
├── All segment workers complete
├── Step-boundary merge: merge segment branches into orch branch
│   └── Per-repo serialized (see §C.3)
│   └── Run verification (tests) after merge
└── Step 1 complete → provision new worktrees from merged orch HEAD

Step 2 starts
├── web-client worktree can now see shared-libs changes from Step 1
└── ...
```

**Why step-boundary merges are necessary:** Without them, Step 2's web-client
segment cannot see Step 1's shared-libs changes — they'd still be on a lane
branch.

## C.2 Parallel Execution Rules

Segments within a step run in parallel because they execute in isolated
repo worktrees. Precondition: segments in the same step must be independent.

**Parallel-safe:**
```markdown
### Step 1: Create consumers of shared utility
#### Segment: web-client
- [ ] Create src/api/client.js using string-utils
#### Segment: api-service
- [ ] Create src/middleware/logger.js using string-utils
```

Both consume shared-libs output (from a prior step), both write to different
repos. Safe to parallelize.

**NOT parallel-safe:**
```markdown
### Step 1: BAD — segment B depends on segment A
#### Segment: shared-libs
- [ ] Create src/string-utils.js
#### Segment: api-service
- [ ] Import string-utils from shared-libs  ← can't see it until merge
```

These belong in sequential steps.

**Cross-repo visibility rule:** A segment can only see another repo's changes
if those changes were merged in a prior step's step-boundary merge. Within
a step, segments are completely isolated.

## C.3 Per-Repo Merge Serialization

Step-boundary merges target the orch branch. When two tasks merge into the
same repo simultaneously, the second `update-ref` could overwrite the first.

**Solution: per-repo merge queue in the engine.**

```
Engine maintains: activeMerges = Map<repoId, Promise>  (durable — Phase B)

When a step completes and needs to merge into repo X:
  1. Check activeMerges.get(repoX)
  2. If busy → queue behind it (await the promise)
  3. Set activeMerges.set(repoX, mergePromise)
  4. Spawn merge agent for repo X
  5. On completion → activeMerges.delete(repoX)
```

Different repos merge in parallel. Same-repo merges serialize. No file locks,
no deadlocks.

**Durability requirement (from Sage review):** The merge queue must be
persisted to survive engine crashes. On resume, the engine reconstructs the
queue from the durable state and re-evaluates pending merges.

## C.4 Multi-Task Waves

In a wave with multiple tasks, each task independently progresses through
steps and merges at its own pace:

```
Wave 1: Task A (3 steps) and Task B (2 steps) in parallel

  Task A Step 0 → step merge
  Task B Step 0 → step merge
  Task A Step 1 → step merge (queues if same repo as Task B)
  Task B Step 1 → step merge
  Task A Step 2 → step merge
  All done → wave safety sweep
```

Tasks don't synchronize at step boundaries. Task A can merge Step 0 while
Task B is still executing Step 0.

## C.5 Wave-Boundary Safety Sweep

At the wave boundary (all tasks done), a safety sweep runs:

1. Verify no unstaged/uncommitted files in any worktree across all repos
2. Run full test suite on the orch branch
3. Verify .DONE files for all completed tasks
4. Auto-commit any straggler artifacts (STATUS.md updates, review files)

This is a verification pass, not a merge — merges already happened at step
boundaries.

## C.6 Segment Concurrency

**Configuration:**

- `maxLanes` — max concurrent tasks in a wave (unchanged)
- `maxSegmentConcurrency` — max concurrent segments within a single step
  of a task (new setting, default = maxLanes)

**Overflow:** If a step has more segments than `maxSegmentConcurrency`:
- Launch up to the limit in parallel
- Queue remaining segments in declaration order
- As each finishes, launch next queued
- Step is complete only when ALL segments finish

---

# Phase D: Dynamic Expansion with Step Definitions (Future)

**Goal:** When a worker discovers cross-repo work, the expansion carries
step definitions and context for the next worker.

**Status:** Strategy defined. Can be implemented after Phase A (doesn't
require Phase B/C parallelism).

## D.1 Expansion Request Format

```typescript
interface SegmentExpansionRequest {
  taskId: string;
  fromSegmentId: string;
  requestedRepoIds: string[];
  steps: ExpandedStepDefinition[];
  context?: string;  // knowledge transfer to next worker
}

interface ExpandedStepDefinition {
  name: string;
  segments: {
    repoId: string;
    checkboxes: string[];
  }[];
}
```

## D.2 Expanded Step Placement

Dynamic expansion always creates a new step immediately after the current
step. The discovering worker has context about what's needed now; it cannot
predict needs 2-3 steps ahead.

**Display naming:** `Step 1.1`, `Step 1.2`
**Internal identity:** Integer ordinals (see Phase B)

If a worker in an expansion step discovers further needs, it creates
`Step 1.1.1` — building the chain incrementally.

## D.3 Context Transfer

The `context` field carries knowledge from the discovering worker to the
executing worker. Example:

```json
{
  "context": "shared-libs now exports formatLogEntry(level, message, meta).
  api-service needs to import and use it in the logger middleware.
  The function is in src/log-formatter.js."
}
```

The lane-runner injects this as "Context from prior segment" in the worker's
iteration prompt.

## D.4 Prerequisite Edge Case

If a worker discovers that a parallel segment within the same step (Phase C)
needed prerequisite work, it's too late — that segment already ran. The
correct response is to create an expansion step (Step N.1) to fix the issue
after the current step merges. The engine does not reorder or re-run.

---

# Phase E: Skill Pre-Decomposition (Future)

**Goal:** The create-taskplane-task skill automatically groups work by repo
within steps, minimizing dynamic expansion.

**Status:** Strategy defined. Can be implemented after Phase A.

## E.1 Skill Workflow

1. Read workspace config to identify repos and their roles
2. Analyze task description and file scope per repo
3. Group work into steps by logical goal, with segments per repo
4. Order steps respecting cross-repo dependencies:
   - Shared libraries / common code → early steps
   - Per-repo implementation → middle steps
   - Integration testing / documentation → final steps (packet repo)
5. Write PROMPT.md with `#### Segment: <repoId>` in every step (always explicit)
6. Write STATUS.md with matching structure

## E.2 Guidelines

- Max 10 segments per task (skill-level guideline, not engine limit)
- Final documentation/delivery step always uses `#### Segment: <packet-repo>`
- When pre-decomposition isn't possible, include guidance about dynamic expansion

---

# Phase F: Dashboard Segment Progress (Future)

**Goal:** Rich visualization of multi-segment execution.

**Status:** Strategy defined. Depends on Phase B state model for live data.

## F.1 Parallel Segment Display (Phase C+)

```
Step 1: Create utilities and API client          3/6 segments active
├─ 🟢 shared-libs   👁  ● running    1m 22s  ━━━━━━━━  50% 2/4
├─ 🟢 api-service   👁  ● running    0m 45s  ━━━━━━━━  33% 1/3
├─ 🟢 web-client    👁  ● succeeded  2m 01s  ━━━━━━━━  100% 3/3
├─ ⏳ auth-service        ○ queued
└─ Step progress: 60% (6/10)
```

## F.2 Segment-Level 👁 Viewer

Clicking 👁 on a segment shows only that segment's checkbox block from
STATUS.md — not the full file.

## F.3 Queued Segment Indicators

Segments waiting for a concurrency slot show as greyed out with a queue
indicator. Transition to running with live telemetry when a slot opens.

---

## Migration & Backward Compatibility

| Scenario | Phase A | Phase C+ |
|----------|---------|----------|
| Single-segment tasks (no markers) | No change | No change |
| Multi-segment without markers | Legacy: all checkboxes shown, packet repo fallback | Same |
| Multi-segment with markers | Segment-scoped filtering (sequential execution) | Parallel execution + step merges |
| Dynamic expansion without step defs | Legacy: no filtering for expanded segment | Same |
| Dynamic expansion with step defs | N/A (Phase D) | New step inserted with segment checkboxes |

---

## References

- #492: Engine does not advance frontier after non-final segment
- #495: Worker prompt should indicate which steps belong to current segment
- #496: Multi-segment task format: steps must be organized by segment/repo
- TP-165: Segment boundary .DONE guard (shipped)
- TP-169: Segment expansion resume crash (shipped)
- Sage v3 review: execution model mismatch, artifact race conditions,
  state schema durability, supervisor tool surface gaps
