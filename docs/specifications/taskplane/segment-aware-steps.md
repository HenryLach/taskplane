# Specification: Segment-Aware Steps for Multi-Repo Tasks

**Status:** Draft
**Created:** 2026-04-12
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

1. **Workers only see steps for their current segment** — no cross-repo confusion
2. **Pre-planned segments have steps defined in PROMPT.md** — task authors map steps to repos
3. **Dynamic expansions carry step definitions** — the discovering worker defines what the next segment should do
4. **Progress tracking is segment-scoped** — stall detection only counts current segment's checkboxes
5. **Backward compatible** — single-segment tasks (the majority) work exactly as before
6. **The create-taskplane-task skill pre-decomposes** — minimize dynamic expansion by predicting cross-repo work upfront

---

## Design

### 1. PROMPT.md Format: Segment Markers

Steps in multi-repo tasks are grouped under `## Segment: <repoId>` markers.
The repoId matches the workspace configuration (`taskplane-workspace.yaml`).

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

**Multi-segment task (new):**

```markdown
## Steps

### Segment: shared-libs

#### Step 0: Preflight
- [ ] Verify shared-libs repo and src/ directory

#### Step 1: Create string utilities
- [ ] Create src/string-utils.js with capitalize, slugify, truncate
- [ ] JSDoc comments on each function

### Segment: web-client

#### Step 2: Create API client
- [ ] Create src/api/client.js importing from shared-libs
- [ ] Add JSDoc comments

### Segment: shared-libs

#### Step 3: Documentation & Delivery
- [ ] Update STATUS.md
- [ ] Verify cross-repo integration
```

**Key rules:**

- `### Segment: <repoId>` is a step-group marker, not a step itself
- Steps are still numbered globally and sequentially
- A repo can appear in multiple segment groups (e.g., shared-libs for setup and
  documentation)
- The segment marker determines which worktree the steps execute in
- Steps without a preceding segment marker belong to the task's primary repo
  (the `resolvedRepoId` from discovery)

### 2. STATUS.md Format: Segment Headers

STATUS.md mirrors the segment structure. Each segment group has its own section:

```markdown
### Segment: shared-libs

#### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Verify shared-libs repo and src/ directory

#### Step 1: Create string utilities
**Status:** ⬜ Not Started
- [ ] Create src/string-utils.js
- [ ] JSDoc comments

### Segment: web-client

#### Step 2: Create API client
**Status:** ⬜ Not Started
- [ ] Create src/api/client.js
- [ ] JSDoc comments

### Segment: shared-libs

#### Step 3: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update STATUS.md
```

### 3. Discovery: Parse Segment-Step Mapping

`discovery.ts` parses the `### Segment: <repoId>` markers from PROMPT.md and
builds a mapping:

```typescript
interface SegmentStepMapping {
  repoId: string;
  stepNumbers: number[];
}

// Example for TP-004:
// [
//   { repoId: "shared-libs", stepNumbers: [0, 1] },
//   { repoId: "web-client", stepNumbers: [2] },
//   { repoId: "shared-libs", stepNumbers: [3] },
// ]
```

This mapping is stored in the `ParsedTask` and made available to the engine
and lane-runner.

**Backward compatibility:** Tasks without segment markers produce a single
mapping entry with the task's primary repoId containing all step numbers.

### 4. Lane-Runner: Segment-Scoped Step Filtering

When spawning a worker for a segment, the lane-runner:

1. Looks up the segment's `repoId` from the segment plan
2. Filters `remainingSteps` to only include steps mapped to that repoId
3. Injects segment context into the iteration prompt:

```
Active segment: TP-005::api-service (segment 2 of 3)
This segment covers: Step 2 (api-service work)
Steps 0-1 were completed in segment TP-005::shared-libs.
Step 3 will execute in segment TP-005::shared-libs (later wave).
Focus ONLY on Step 2 checkboxes. When they are all checked, your segment is done.
```

4. Progress tracking only counts checkboxes in the current segment's steps
5. Stall detection only considers segment-scoped checkboxes
6. When all segment-scoped checkboxes are checked, the lane-runner treats the
   segment as complete (returns segment-succeeded, suppresses .DONE if non-final)

### 5. Dynamic Segment Expansion: Step Definitions

When a worker discovers cross-repo work at runtime, it files an expansion
request that includes step definitions:

```typescript
interface SegmentExpansionRequest {
  taskId: string;
  fromSegmentId: string;
  requestedRepoIds: string[];
  placement: "after-current" | "before-next";
  // NEW: step definitions for the expanded segment
  steps: ExpandedStepDefinition[];
  // NEW: context for the expanded segment worker
  context?: string;
}

interface ExpandedStepDefinition {
  name: string;
  checkboxes: string[];
}
```

**Example:** Worker on shared-libs discovers api-service needs a config change:

```json
{
  "taskId": "TP-007",
  "fromSegmentId": "TP-007::shared-libs",
  "requestedRepoIds": ["api-service"],
  "placement": "after-current",
  "steps": [
    {
      "name": "Update api-service configuration",
      "checkboxes": [
        "Add shared-libs dependency to api-service/package.json",
        "Update api-service/src/config.js to import shared utility",
        "Run api-service tests to verify integration"
      ]
    }
  ],
  "context": "shared-libs now exports a new formatLogEntry() function that api-service needs for its logger middleware. The function signature is formatLogEntry(level, message, meta) returning a formatted string."
}
```

**Engine handling:**

When the engine processes an approved expansion:

1. Store the `steps` and `context` in the `PersistedSegmentRecord`
2. When the expanded segment launches, the lane-runner reads the step
   definitions from the segment record
3. The lane-runner injects them into the worker's prompt (and optionally
   appends them to STATUS.md for checkpoint tracking)
4. The `context` field is included in the worker prompt as background —
   it carries knowledge from the discovering worker to the executing worker

**Fallback:** If an expansion request has no `steps` field (backward
compatibility), the lane-runner presents the full remaining STATUS.md steps
as today — the worker will need to figure out what to do. This preserves
backward compatibility but is suboptimal.

### 6. Create-Taskplane-Task Skill: Pre-Decomposition

The skill should pre-decompose steps into segments when creating multi-repo
tasks. This minimizes dynamic expansion by predicting cross-repo work upfront.

**Skill workflow for multi-repo tasks:**

1. Read workspace config (`taskplane-workspace.yaml`) to know available repos
2. Analyze the task description and file scope to determine which repos are
   involved
3. Group the work by repo, determining natural segment boundaries:
   - Setup/infrastructure → primary repo first
   - Per-repo implementation → one segment group per repo
   - Integration/documentation → primary repo last
4. Write PROMPT.md with `### Segment: <repoId>` markers
5. Write STATUS.md with matching segment structure
6. Set `segmentIds` in the task metadata based on the repo ordering

**Heuristics for segment ordering:**

- Shared libraries / common code → first (other repos depend on it)
- Backend services → middle (may depend on shared, depended on by frontend)
- Frontend / clients → after backend (depends on API contracts)
- Documentation / integration tests → last (needs all repos ready)

**When pre-decomposition is impossible:**

Some tasks genuinely can't predict cross-repo needs. The skill should:
- Note in PROMPT.md that dynamic expansion may be needed
- Include guidance in the primary segment's steps: "If you discover cross-repo
  changes are needed, use `request_segment_expansion` with step definitions"

### 7. Worker Prompt Changes

The task-worker.md template needs a new section:

```markdown
## Multi-Segment Tasks

You may be executing one segment of a multi-segment task. Your iteration
prompt tells you which segment is active and which steps are yours.

**Rules:**
- Only work on steps listed for your current segment
- When all your segment's checkboxes are checked, your work is done — exit
- Do NOT attempt to modify files in repos not available in your worktree
- If you discover work needed in another repo, use `request_segment_expansion`
  with step definitions describing what the next worker should do

**Context from prior segments:**
If your prompt includes "Context from prior segment," this was written by the
worker who discovered the need for your segment. Use it to understand what was
built and what you need to do.
```

### 8. Segment-Scoped Progress Tracking

The sidecar telemetry and dashboard need to track progress per-segment:

```typescript
interface SegmentProgress {
  segmentId: string;
  repoId: string;
  stepNumbers: number[];
  checked: number;
  total: number;
  status: "pending" | "running" | "succeeded" | "failed";
}
```

The dashboard shows:
- Per-segment progress bars when viewing a multi-segment task
- Overall task progress as the sum across all segments
- Clear labels: "Segment 1/3: shared-libs — 4/4 ✅" vs "Segment 2/3: web-client — 0/3 ⏳"

---

## Migration & Backward Compatibility

| Scenario | Behavior |
|----------|----------|
| Existing single-segment tasks | No change — no segment markers, full steps shown |
| Existing multi-segment tasks without markers | Legacy mode — all steps shown to every segment (today's behavior) |
| New multi-segment tasks with markers | Segment-scoped filtering active |
| Dynamic expansion without step defs | Legacy mode for expanded segment |
| Dynamic expansion with step defs | Expanded steps injected into worker prompt |

The discovery parser treats absence of `### Segment:` markers as "all steps
belong to primary repo" — identical to today's behavior.

---

## Implementation Plan

### Phase 1: Lane-runner segment filtering (highest impact, lowest risk)

- Parse segment-step mapping from PROMPT.md in discovery.ts
- Lane-runner filters steps and injects segment context in prompt
- Segment-scoped progress counting and stall detection
- Worker exits cleanly when segment steps are done

**Unblocks:** Autonomous multi-segment execution without supervisor intervention

### Phase 2: Dynamic expansion with step definitions

- Extend `request_segment_expansion` with steps and context fields
- Engine stores step definitions in segment record
- Lane-runner reads and injects expanded step definitions
- Context field passed through to executing worker

**Unblocks:** Runtime-discovered cross-repo work with proper worker guidance

### Phase 3: Skill pre-decomposition

- Update create-taskplane-task skill to detect multi-repo tasks
- Add segment grouping logic with repo-ordering heuristics
- Generate PROMPT.md with segment markers
- Generate STATUS.md with matching structure

**Unblocks:** Task authors get correct segment structure by default

### Phase 4: Dashboard segment progress

- Per-segment progress bars
- Segment status indicators
- Clear segment labels in lane view

**Unblocks:** Operator visibility into multi-segment task progress

---

## Open Questions

1. **Should the final documentation/delivery step always run in the packet repo
   (where STATUS.md lives)?** This seems like a sensible default — documentation
   updates and STATUS.md finalization should happen where the task files are.

2. **Should dynamic expansion allow inserting steps into an existing segment
   group?** E.g., worker on shared-libs discovers it needs an additional step
   in shared-libs. Currently expansion only adds new repo segments. Intra-repo
   expansion could be handled by STATUS.md hydration (adding checkboxes to the
   current step) rather than segment expansion.

3. **How should the skill handle tasks that span many repos (4+)?** Very wide
   tasks may need to be split into separate tasks rather than one task with
   many segments. The skill could enforce a max-segments-per-task guideline.

4. **Should there be a `### Segment: any` marker for steps that can run in
   any repo context?** Documentation and delivery steps often don't care which
   repo they're in. An `any` marker would let the lane-runner assign them to
   whatever segment is most convenient (typically the last one).

---

## References

- #492: Engine does not advance frontier after non-final segment
- #495: Worker prompt should indicate which steps belong to current segment
- #496: Multi-segment task format: steps must be organized by segment/repo
- TP-165: Segment boundary .DONE guard (shipped)
- TP-169: Segment expansion resume crash (shipped)
