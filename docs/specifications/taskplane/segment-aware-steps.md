# Specification: Segment-Aware Steps for Multi-Repo Tasks

**Status:** Draft v2
**Created:** 2026-04-12
**Updated:** 2026-04-12
**Author:** Supervisor + Operator
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
3. **Segments within a step run in parallel** — repo isolation enables this
4. **Step-boundary merges** — each step's work is merged before the next step starts,
   so later steps can see earlier steps' changes across repos
5. **Dynamic expansions carry step definitions** — the discovering worker defines
   what the next segment should do
6. **The create-taskplane-task skill pre-decomposes** — minimize dynamic expansion
   by predicting cross-repo work upfront
7. **Backward compatible** — single-segment tasks (the majority) work exactly as before

---

## Design

### 1. PROMPT.md Format: Segments Inside Steps

Steps remain the primary organizer — they describe **what** to accomplish.
Segments within steps describe **where** the work happens. This preserves the
existing step-level infrastructure (commits, reviews, hydration) while adding
repo-scoping.

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
- Segments within a step are **independent and can run in parallel** — if
  segment B depends on segment A's output, segment B belongs in a later step
- Steps without any `#### Segment:` markers belong to the task's primary repo
  (backward compatible with single-segment tasks)

### 2. Execution Model: Step-Boundary Merges

Each step is a **mini-wave** for the task. The execution flow for a
multi-segment step:

```
Step 1 starts
├── Provision worktrees for each segment's repo
├── Spawn parallel workers (one per segment)
│   ├── shared-libs worker: executes shared-libs checkboxes
│   └── web-client worker: executes web-client checkboxes
├── All segment workers complete
├── Merge all segment lane branches into orch branch  ← STEP-BOUNDARY MERGE
│   └── Run verification (tests) after merge
└── Step 1 complete

Step 2 starts
├── Provision worktrees (now based on merged orch branch)
│   └── web-client worktree can see shared-libs changes from Step 1
├── Spawn workers for Step 2 segments
└── ...
```

**Why step-boundary merges are necessary:** Without them, Step 2's web-client
segment cannot see Step 1's shared-libs changes — they would still be on a
lane branch. Step-boundary merges ensure cross-repo visibility between steps.

**Interaction with wave merges:** In a batch with multiple tasks, the wave
merge happens after ALL tasks' current steps complete. The step-boundary merge
is per-task, but it can be batched with other tasks in the same wave that are
also at a step boundary.

### 3. Parallel Segment Execution

Segments within a step run in parallel because they execute in isolated
repo worktrees. This is a precondition that task authors must respect:

**Parallel-safe (segments are independent):**
```markdown
### Step 1: Create consumers of shared utility

#### Segment: web-client
- [ ] Create src/api/client.js using string-utils

#### Segment: api-service
- [ ] Create src/middleware/logger.js using string-utils
```

Both consume shared-libs output (from a prior step), both write to different
repos. Safe to parallelize.

**NOT parallel-safe (segment B depends on segment A):**
```markdown
### Step 1: BAD — these cannot run in parallel

#### Segment: shared-libs
- [ ] Create src/string-utils.js     ← api-service needs this

#### Segment: api-service
- [ ] Import string-utils from shared-libs  ← can't see it until merge
```

The api-service segment cannot import from shared-libs until shared-libs
changes are merged. These belong in sequential steps:

```markdown
### Step 1: Create shared utility
#### Segment: shared-libs
- [ ] Create src/string-utils.js

### Step 2: Create consumer
#### Segment: api-service
- [ ] Import string-utils from shared-libs
```

### 4. STATUS.md Format

STATUS.md mirrors the segment structure within each step:

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

Each segment's worker only checks off its own segment's boxes. The lane-runner
presents only the relevant `#### Segment: <repoId>` block to each worker.
The step is "complete" when ALL segments' checkboxes within that step are checked.

### 5. Worker Experience

When a worker spawns for a specific segment, the lane-runner:

1. Identifies the active segment's repoId
2. Extracts only that segment's checkboxes from the current step
3. Injects segment context into the iteration prompt:

```
Active segment: TP-005::api-service (Step 2, segment 2 of 2)
Your repo: api-service
Your checkboxes for this step:
  - [ ] Create src/middleware/logger.js
  - [ ] Import formatLogEntry from shared-libs
  - [ ] Log request method, path, timing

Prior steps completed: Step 0 (preflight), Step 1 (shared-libs utility created)
When all YOUR checkboxes are checked, your segment is done — exit successfully.
Do NOT attempt work in other repos.
```

The worker sees only its checkboxes, knows what prior steps accomplished, and
has a clear exit condition.

### 6. Reviews Within Segments

Reviews happen **within each segment's worker flow**, not at the step boundary
across segments:

1. Each segment's worker independently calls `review_step` for its work
2. The reviewer sees that segment's plan and code changes in the repo worktree
3. APPROVE/REVISE cycle happens per-segment
4. The step-boundary merge agent provides the cross-repo quality gate
   (runs verification/tests after merging all segments)

This means a step with 3 segments could have 3 independent plan reviews and
3 independent code reviews running in parallel. The merge verification after
the step catches any cross-repo integration issues.

### 7. Progress Tracking

Progress is tracked at two levels:

**Segment-level (for dashboard lane view):**
```typescript
interface SegmentProgress {
  segmentId: string;
  repoId: string;
  stepNumber: number;
  checked: number;
  total: number;
  status: "pending" | "running" | "succeeded" | "failed";
}
```

**Step-level (aggregate):**
The step's progress is the sum of all its segments. The step is complete when
all segments report all checkboxes checked.

**Stall detection** only counts the current segment's checkboxes. A worker
in the shared-libs segment is not penalized for unchecked web-client boxes.

### 8. Dashboard Representation

Within a step that has multiple segments running in parallel:

```
Step 1: Create utilities and API client
├─ 🟢 shared-libs   👁  ● running  1m 22s  ━━━━━━━━  50% 2/4
├─ 🟢 api-service    👁  ● running  0m 45s  ━━━━━━━━  33% 1/3
└─ 🟢 web-client     👁  ● succeeded  2m 01s  ━━━━━━━━  100% 3/3
```

Clicking 👁 on a segment shows that segment's checkboxes from STATUS.md.

The step-level progress bar shows the aggregate (6/10 = 60%).

### 9. Dynamic Segment Expansion

When a worker discovers cross-repo work at runtime, it files an expansion
request with step definitions. Dynamic expansion **always creates a new step**
immediately after the current step.

```typescript
interface SegmentExpansionRequest {
  taskId: string;
  fromSegmentId: string;
  requestedRepoIds: string[];
  // Step definitions for the new step
  steps: ExpandedStepDefinition[];
  // Context from the discovering worker
  context?: string;
}

interface ExpandedStepDefinition {
  name: string;
  segments: {
    repoId: string;
    checkboxes: string[];
  }[];
}
```

**Example:** Worker on shared-libs Step 1 discovers api-service needs a config
change:

```json
{
  "taskId": "TP-007",
  "fromSegmentId": "TP-007::shared-libs",
  "requestedRepoIds": ["api-service"],
  "steps": [
    {
      "name": "Update api-service configuration",
      "segments": [
        {
          "repoId": "api-service",
          "checkboxes": [
            "Add shared-libs dependency to api-service/package.json",
            "Update api-service/src/config.js to import shared utility",
            "Run api-service tests to verify integration"
          ]
        }
      ]
    }
  ],
  "context": "shared-libs now exports formatLogEntry(level, message, meta). api-service needs to import and use it in the logger middleware."
}
```

**Expanded step naming:** `Step 1.1`, `Step 1.2`, etc. The engine inserts
the expanded step immediately after the step that triggered the expansion.
Ordering: `Step 1 < Step 1.1 < Step 1.2 < Step 2`.

**Why always immediately after?** The discovering worker has context about
what's needed *now*. It cannot predict needs 2-3 steps ahead. If cascading
discoveries occur, each step's worker expands for the next step — building
the chain incrementally.

**Prerequisite edge case:** If a worker discovers that a parallel segment
within the same step needed prerequisite work that wasn't done, it's too late —
that segment already ran (or is running). The correct response is to create
an expansion step (e.g., Step 1.1) to fix the issue. The engine does not
attempt to reorder or re-run segments within a completed step.

### 10. Discovery: Parse Segment-Step Mapping

`discovery.ts` parses `#### Segment: <repoId>` markers within each step and
builds a mapping:

```typescript
interface StepSegmentMapping {
  stepNumber: number;
  stepName: string;
  segments: {
    repoId: string;
    checkboxes: string[];  // raw checkbox text
  }[];
}

// Example for a 3-step task:
// [
//   { stepNumber: 0, stepName: "Preflight", segments: [
//     { repoId: "shared-libs", checkboxes: ["Verify repo"] },
//     { repoId: "web-client", checkboxes: ["Read spec"] },
//   ]},
//   { stepNumber: 1, stepName: "Create utils", segments: [
//     { repoId: "shared-libs", checkboxes: ["Create string-utils.js", "JSDoc"] },
//     { repoId: "web-client", checkboxes: ["Create client.js", "JSDoc"] },
//   ]},
//   ...
// ]
```

**Backward compatibility:** Steps without `#### Segment:` markers produce a
single segment entry with the task's primary repoId.

### 11. Create-Taskplane-Task Skill: Pre-Decomposition

The skill pre-decomposes steps into segments when creating multi-repo tasks.
This minimizes dynamic expansion.

**Skill workflow:**

1. Read workspace config to know available repos
2. Analyze task description and file scope per repo
3. Group work into steps by logical goal, with segments per repo
4. Order steps respecting cross-repo dependencies:
   - Shared libraries / common code → early steps
   - Per-repo implementation → middle steps (parallel where possible)
   - Integration testing / documentation → final steps
5. Write PROMPT.md with `#### Segment: <repoId>` markers within steps
6. Write STATUS.md with matching structure

**When pre-decomposition isn't possible:**

Include guidance in the primary segment: "If you discover cross-repo changes
are needed, use `request_segment_expansion` with step definitions."

### 12. Worker Prompt Changes

Add to task-worker.md:

```markdown
## Multi-Segment Tasks

You may be executing one segment of a multi-segment step. Your iteration
prompt tells you which segment is active and which checkboxes are yours.

**Rules:**
- Only work on checkboxes listed for your current segment
- When all your segment's checkboxes are checked, your work is done — exit
- Do NOT attempt to modify files in repos not in your worktree
- If you discover work needed in another repo, use `request_segment_expansion`
  with step definitions describing what the next step's worker should do
- Include a `context` field with knowledge the next worker will need

**Context from prior segments:**
If your prompt includes "Context from prior segment," this was written by
a worker who discovered the need for your work. Use it to understand what
was built and what you need to do.
```

---

## Migration & Backward Compatibility

| Scenario | Behavior |
|----------|----------|
| Single-segment tasks (no markers) | No change — all checkboxes shown to single worker |
| Multi-segment tasks without markers | Legacy mode — all checkboxes shown to every segment |
| Multi-segment tasks with markers | Segment-scoped filtering, parallel execution |
| Dynamic expansion without step defs | Legacy mode for expanded segment |
| Dynamic expansion with step defs | New step inserted with segment checkboxes |

---

## Implementation Plan

### Phase 1: Segment-scoped step filtering (highest impact)

- Parse `#### Segment: <repoId>` markers in discovery.ts
- Lane-runner filters checkboxes by active segment
- Segment-scoped progress counting and stall detection
- Worker exits cleanly when segment checkboxes are done
- Iteration prompt includes segment context

**Unblocks:** Workers stop trying to do cross-repo work

### Phase 2: Step-boundary merges

- After all segments within a step complete, merge lane branches into orch
- Provision new worktrees from merged orch branch for next step
- Verification (tests) run at step-boundary merge point
- Cross-repo visibility between steps

**Unblocks:** Later steps can see earlier steps' cross-repo changes

### Phase 3: Dynamic expansion with step definitions

- Extend `request_segment_expansion` with steps, segments, and context
- Engine stores step definitions in segment record
- Lane-runner injects expanded step definitions into worker prompt
- Expanded step naming: Step N.1, N.2, etc.

**Unblocks:** Runtime-discovered cross-repo work with proper guidance

### Phase 4: Skill pre-decomposition

- Update create-taskplane-task skill to detect multi-repo tasks
- Add segment grouping within steps
- Generate PROMPT.md with segment markers
- Generate STATUS.md with matching structure

**Unblocks:** Task authors get correct segment structure by default

### Phase 5: Dashboard segment progress

- Per-segment progress bars within step view
- Parallel segment display in lane view
- Segment-level 👁 STATUS.md viewer
- Step-level aggregate progress

**Unblocks:** Operator visibility into multi-segment progress

---

## Open Questions

1. **Should the final documentation/delivery step always run in the packet
   repo?** Documentation updates and STATUS.md finalization should happen
   where the task files live. A `#### Segment: packet` marker (or defaulting
   unmarked steps to the packet repo) could handle this.

2. **Should there be a `#### Segment: any` marker** for steps that can run
   in any repo context? Or should the lane-runner assign unmarked steps to
   the packet repo by default?

3. **Max segments per task guideline?** Tasks spanning 4+ repos may be better
   split into separate tasks. The skill could enforce or recommend this.

4. **Step-boundary merge granularity:** Should the merge happen per-task
   (each task merges its step independently) or per-wave (all tasks in the
   wave merge at the same step boundary)? Per-wave is simpler but slower;
   per-task enables more parallelism.

---

## References

- #492: Engine does not advance frontier after non-final segment
- #495: Worker prompt should indicate which steps belong to current segment
- #496: Multi-segment task format: steps must be organized by segment/repo
- TP-165: Segment boundary .DONE guard (shipped)
- TP-169: Segment expansion resume crash (shipped)
