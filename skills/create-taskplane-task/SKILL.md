---
name: create-taskplane-task
version: 1.2.0
description: Creates structured Taskplane task packets (PROMPT.md, STATUS.md) for autonomous agent execution via the task-orchestrator extension (/orch). Use when asked to "create a task", "create a taskplane task", "stage a task", "prepare a task for execution", "write a PROMPT.md", "set up work for the agent", "queue a task", or whenever the user wants to define work that will be executed autonomously by another agent instance.
---

# Create Taskplane Task

Creates structured task packets (PROMPT.md + STATUS.md) for autonomous execution
via the **task-orchestrator extension** (`/orch`). The orchestrator handles the
execution loop, fresh-context management, cross-model reviews, wave scheduling,
and live dashboard — so PROMPT.md stays focused on WHAT to do, not HOW to execute.

## Architecture

```
create-taskplane-task skill       → Creates PROMPT.md + STATUS.md
task-orchestrator extension      → Executes tasks (single or batch)
  ├─ task-worker.md agent        → Worker system prompt (checkpoint discipline, resume logic)
  ├─ task-reviewer.md agent      → Reviewer system prompt (review formats, criteria)
  └─ taskplane-config.json       → Project-specific settings, paths, standards
```

The skill only creates files. All execution behavior lives in the orchestrator
and the current execution engine (orchestrator + agent-host, direct process
hosting, no TMUX).

## Prerequisites

**If `.pi/taskplane-config.json` does not exist** (and `.pi/task-runner.yaml`
is also absent), the project has not been initialized. Tell the user to run
`taskplane init` first — the skill cannot create tasks without knowing where
task areas live.

## Configuration

**Read `.pi/taskplane-config.json` first** (JSON, canonical). Fall back to
`.pi/task-runner.yaml` only if the JSON config does not exist. Use canonical
JSON keys when documenting behavior; YAML keys are compatibility aliases.

Primary keys to read:
- `taskRunner.taskAreas` (legacy alias: `task_areas`) — folder paths, prefixes, CONTEXT.md locations per area
- `taskRunner.referenceDocs` (legacy alias: `reference_docs`) — available Tier 3 docs for "Context to Read First"
- `taskRunner.standards` — project coding rules and standards docs
- `taskRunner.testing.commands` — how to run tests
- `taskRunner.selfDocTargets` (legacy alias: `self_doc_targets`) — where agents log discoveries
- `taskRunner.protectedDocs` (legacy alias: `protected_docs`) — docs requiring user approval to modify
- `taskRunner.neverLoad` (legacy alias: `never_load`) — docs to exclude from task execution context

---

## Task Creation Workflow

### Step 1: Determine Location & Next ID

The user will rarely specify which area to use — **figure it out from context.**

**When there's only one area** (typical for new projects), use it directly.

**When there are multiple areas**, match the task to the right area:

1. Read the project config (`taskplane-config.json` or `task-runner.yaml`) → `taskRunner.taskAreas` (or `task_areas` in fallback YAML) to get all areas
2. Read each area's `CONTEXT.md` — the "Current State" section describes what
   that area owns (its domain, services, file scope)
3. Match the task description to the area whose scope best fits:
   - A task about PTO accrual → `time-off` area
   - A task about the orchestrator itself → `task-system` area
   - A task about login flows → `identity-access` area
4. If ambiguous (task spans multiple areas), prefer the area that owns the
   primary file being modified, or ask the user

**After selecting the area:**

1. Read that area's `CONTEXT.md` and find the `Next Task ID` counter
2. Use that ID for the new task
3. **Increment the counter** in the same CONTEXT.md edit

**Note:** Task area structures evolve over time. A new project starts with a
single `taskplane-tasks/` folder and one area. As the project grows, users add
domains and platform areas in the config. The skill adapts — it always
reads the config to discover what areas exist rather than assuming a layout.

### Step 2: Assess Complexity & Size

**You MUST explicitly score and assign review level before creating PROMPT.md.**

Quick reference (full rubric in [Complexity Assessment](#complexity-assessment)):
- Score each dimension 0-2: Blast radius, Pattern novelty, Security, Reversibility
- Sum → Level: 0-1→L0 (None), 2-3→L1 (Plan), 4-5→L2 (Plan+Code), 6-8→L3 (Full)
- Size: S (<2h), M (2-4h), L (4-8h), XL (8h+ → must split)

**Do not default to Review Level 0.** Level 0 is only appropriate for trivial changes (doc updates, config, boilerplate). Most M-sized tasks score ≥2 and require at least Level 1.

### Step 3: Create Task Folder

```
{area.path}/{PREFIX-###-slug}/
```

### Step 4: Create PROMPT.md

Use the template in [references/prompt-template.md](references/prompt-template.md).

### Step 5: Create STATUS.md

Use the STATUS.md template in [references/prompt-template.md](references/prompt-template.md).
(If omitted, the execution engine can auto-generate it from PROMPT.md.)

### Step 6: Update Tracking

- **CONTEXT.md** — Increment `Next Task ID` (done in Step 1)

### Step 7: Report Launch Command

```
/orch {area.path}/{PREFIX-###-slug}/PROMPT.md
```

For batch execution of multiple tasks: `/orch all`

---

## Complexity Assessment

Evaluate the task to determine cross-model review level.

### Review Levels

| Level | Label | Reviewer Calls |
|-------|-------|----------------|
| 0 | None | Zero — doc updates, config, boilerplate |
| 1 | Plan Only | Plan review before implementation |
| 2 | Plan + Code | Plan review + code review after implementation |
| 3 | Full | Plan + code + test review |

### Scoring (0-2 per dimension, sum for level)

| Dimension | 0 (Low) | 1 (Medium) | 2 (High) |
|-----------|---------|------------|----------|
| **Blast radius** | Single file | Single service | Multiple services |
| **Pattern novelty** | Existing patterns | Adapting patterns | New patterns |
| **Security** | No auth/data | Touches auth | Modifies auth/encryption |
| **Reversibility** | Easy revert | Needs migration | Data model change |

- Score 0-1 → Level 0 · Score 2-3 → Level 1 · Score 4-5 → Level 2 · Score 6-8 → Level 3

### Per-Step Override

Individual steps can override the task-level review:

```markdown
### Step 3: Add RBAC middleware
> **Review override: code review** — This step touches authorization.
```

---

## Task Sizing

| Size | Duration | Action |
|------|----------|--------|
| **S** | < 2 hours | Create as-is |
| **M** | 2-4 hours | Ideal size — create as-is |
| **L** | 4-8 hours | Split if possible |
| **XL** | 8+ hours | **Must split** into M/L tasks with dependencies |

**Rule of thumb:** More than ~3 major implementation steps → split it.

---

## Tiered Context Loading

PROMPT.md tells the worker what to load. Less is better.

| Tier | What | Loaded By |
|------|------|-----------|
| **1** | PROMPT.md + STATUS.md | Always (automatic) |
| **2** | Area CONTEXT.md | When referenced in "Context to Read First" |
| **3** | Specific reference docs | Only the docs this task needs |

Populate "Context to Read First" in PROMPT.md using docs from
the project config → `taskRunner.referenceDocs` (legacy YAML: `reference_docs`).
List only what the task actually needs.

Docs listed in config → `taskRunner.neverLoad` (legacy YAML: `never_load`)
must NOT appear in any task.

---

## STATUS.md Hydration

STATUS.md is the worker's ONLY memory between iterations. It needs enough
structure so progress survives when an iteration ends mid-step — but not so much
structure that it becomes a rigid script the worker follows mechanically.

### Philosophy: Adaptive Planning, Not Exhaustive Scripting

Hydration exists because workers discover things at runtime they couldn't know
upfront: the actual function signatures, the edge cases that emerge from reading
source, the reviewer feedback that reshapes approach. The goal is **adaptability
in the face of unknowns** — not granularity for its own sake.

**The right level of detail depends on predictability:**

| How predictable is the work? | Approach |
|------------------------------|----------|
| You know exactly what files/methods/tests are needed | List them as checkboxes |
| You know the general shape but details depend on source code | Write intent-level checkboxes; trust the worker to figure out implementation specifics |
| You genuinely don't know what's needed until a prior step runs | Use `⚠️ Hydrate` marker |

**Anti-pattern to avoid:** Creating 15+ micro-checkboxes that spell out every
function name, parameter, and assertion before the worker has even read the
source code. This wastes task-creation time, produces items that frequently need
revision anyway, and turns the worker into a checkbox-follower instead of a
problem-solver.

### Task Creator Responsibilities

**Match STATUS.md to PROMPT.md granularity — no more, no less.** PROMPT.md steps
should express *outcomes* the worker needs to achieve, not dictate *how* to
achieve them.

Good granularity examples:

| PROMPT.md says | STATUS.md should have |
|----------------|-----------------------|
| "Implement CRUD operations for Projects" | `- [ ] Implement Create, Read, Update, Delete for Projects` (one checkbox — the worker can figure out 4 methods) |
| "Add repo-aware fields to persistence schema" | `- [ ] Add repo fields to schema and update serialization` |
| "Test merge failure scenarios" | `- [ ] Add tests for merge failure paths` |
| "Update merge flow to work per-repo" | `- [ ] Refactor merge to partition by repo` and `- [ ] Aggregate per-repo results` (two checkboxes — these are genuinely distinct outcomes) |

Over-hydrated examples (avoid):

| ❌ Too granular | ✅ Better |
|----------------|-----------|
| 10 checkboxes naming every function, parameter, and import to change | 2-3 checkboxes describing the behavioral changes |
| Separate checkboxes for "create file", "add imports", "add function", "export function" | One checkbox: "Create helper module with X capability" |
| One checkbox per test assertion | One checkbox per test scenario or category |

**Use `⚠️ Hydrate` markers** for steps that genuinely depend on runtime
discoveries — where the task creator cannot know the items upfront:

```markdown
### Step 2: Handle migration
**Status:** ⬜ Not Started
> ⚠️ Hydrate: Expand based on schema gaps identified in Step 1

- [ ] Implement v1→v2 compatibility (details depend on Step 1 findings)
```

**When to use markers vs. pre-hydration:**

| Situation | Approach |
|-----------|----------|
| Outcomes are known at creation time | Pre-hydrate with outcome-level checkboxes |
| Details depend on analysis/discovery in a prior step | `⚠️ Hydrate` marker |
| Details depend on what exists on disk | `⚠️ Hydrate` marker |
| Reviewer feedback adds new items | Worker adds items (handled by worker agent) |

### Worker Hydration at Runtime

Workers may expand checkboxes when entering a step — but should apply the same
principle: **add checkboxes for distinct outcomes discovered during exploration,
not for every individual code change.** The worker agent has hydration rules
(commit-before-implement, REVISE-triggered expansion). The goal is a useful
resumability checkpoint, not a line-by-line implementation journal.

### Constraint: No New Steps at Runtime

**Workers MUST NOT add, remove, or renumber steps during execution.** The
execution engine parses the step list from PROMPT.md once at launch and
iterates that fixed list. Steps added to STATUS.md at runtime will appear in
the dashboard but **silently never execute**.

Hydration expands checkboxes *within* existing steps only. If a worker discovers
work that doesn't fit any step, it should add sub-checkboxes to the closest
existing step and log the overflow in the STATUS.md Discoveries table.

**Task creators:** ensure PROMPT.md has all necessary steps upfront. If a task's
scope might expand during execution, prefer fewer broad steps (the worker will
hydrate them) over many narrow steps that might need restructuring.

---

## PROMPT.md Amendment Policy

The template includes an `## Amendments` placeholder at the bottom of PROMPT.md.
Original content above the `---` divider is immutable — workers use that section
only for issues like missing prerequisites or contradictory instructions, not
scope expansion or style preferences.

---

## Dependencies Format

The orchestrator **machine-parses** this section using regex — stick to the exact
patterns below. Non-standard formatting (e.g., missing bold markers, inline prose
without a task ID pattern) may cause silent dependency misses or `PARSE_MALFORMED`
errors at batch time.

```markdown
## Dependencies

- **Task:** TO-014 (PTO policy engine must exist)
- **Task:** employee-management/EM-003 (area-qualified when ID may be ambiguous)
- **External:** All backend services running (ports 8080-8085)
- **None**
```

Notes:
- Use unqualified `TASK-ID` when globally unique
- Use `area-name/TASK-ID` for cross-area clarity or when orchestrator reports `DEP_AMBIGUOUS`

---

## Checklist (Definition of Ready)

Verify every task against this before reporting the launch command:

- [ ] `Next Task ID` read from CONTEXT.md and incremented
- [ ] Folder created at correct `taskRunner.taskAreas` path (or fallback YAML `task_areas`) with name `{PREFIX}-{###}-{slug}`
- [ ] Complexity assessed, review level assigned (0-3)
- [ ] Size assessed (S/M/L) — split if XL
- [ ] PROMPT.md created from template with all required sections:
  - [ ] `## Mission` with what AND why
  - [ ] `## Dependencies` section
  - [ ] `## Context to Read First` lists only needed Tier 3 docs
  - [ ] `## File Scope` lists files/dirs the task will touch
  - [ ] Each step has checkboxes with verifiable outcomes
  - [ ] Explicit testing step with full-suite command (per-step targeted tests are in the worker prompt)
  - [ ] `## Do NOT` guardrails
  - [ ] "Must Update" and "Check If Affected" doc lists
  - [ ] `## Git Commit Convention` section (from template)
  - [ ] `## Amendments` placeholder at bottom
- [ ] STATUS.md created with matching step structure
  - [ ] Checkboxes match PROMPT.md granularity (1:1 where items are known)
  - [ ] `⚠️ Hydrate` markers for discovery-dependent steps
- [ ] Launch command reported: `/orch {path}/PROMPT.md`

---

## Git Commit Convention

The prompt template includes a `## Git Commit Convention` section. Workers
commit at **step boundaries** (not after every checkbox) to keep git history
meaningful. Hydration commits are the exception — STATUS.md expansions are
committed immediately to preserve the plan for crash recovery. Always include
the task ID prefix — without it, there's no way to trace commits back to the
task that produced them (`git log --grep="PM-004"` only works if the prefix
is there).

---

## Orchestrator Awareness

Tasks are often executed in parallel batches by the task-orchestrator extension,
not just as one-off single-task runs. Two fields in PROMPT.md become load-bearing
in batch mode:

- **`## Dependencies`** — determines wave ordering. Tasks with unmet deps are
  deferred to later waves. Incorrect or missing deps cause parallel execution of
  tasks that should be serial, leading to merge conflicts or stale reads.
- **`## File Scope`** — determines lane affinity. Tasks with overlapping file
  scope are assigned to the same lane (serial) to avoid merge conflicts. Without
  file scope, the orchestrator distributes tasks randomly across lanes.

When creating multiple tasks for a batch, think about which tasks touch the same
files and make sure their file scopes reflect that.

---

## Multi-Repo Segment Markers

When a task spans multiple repos (e.g., shared-libs + web-client), the skill
must generate **segment markers** inside each step so the orchestrator can
route checkboxes to the correct repo's worker.

### Workflow

1. Read workspace config to identify available repos and their roles
2. Analyze the task description and file scope — determine which repos are involved
3. Group work into steps by logical goal, with segments per repo within each step
4. Write PROMPT.md with `#### Segment: <repoId>` markers in every step
5. Write STATUS.md with matching structure

### Marker Format

Within each step, use level-4 headings to separate work by repo:

```markdown
### Step 1: Create utilities and API client

#### Segment: shared-libs

- [ ] Create string utility module
- [ ] Export from package index

#### Segment: web-client

- [ ] Add API client wrapper
- [ ] Wire into app initialization
```

### Ordering Rules

Order steps so that dependencies flow correctly:

1. **Shared/common work** → early steps (e.g., shared libraries, schemas)
2. **Per-repo implementation** → middle steps (consumers of shared work)
3. **Integration/documentation** → final steps (always in the packet repo)

The final documentation/delivery step always uses `#### Segment: <packet-repo>`
where `<packet-repo>` is the repo that contains the task's PROMPT.md.

### Guidelines

- **Always write explicit markers.** Never rely on the engine's single-segment
  fallback for multi-repo tasks. Every step must have at least one
  `#### Segment: <repoId>` marker.
- **Max 10 segments per task.** Tasks spanning more repos should be split into
  separate tasks with dependencies.
- **Single-repo tasks do not need segment markers.** The engine's fallback
  handles them correctly. Only add markers when file scope spans multiple repos.
- **When pre-decomposition isn't possible** (e.g., the worker must discover
  which repos are affected), include guidance about using
  `request_segment_expansion` for dynamic expansion at runtime.

---

## Preventing Empty Completions

Workers can shortcut tasks by observing that existing code "already satisfies"
requirements and checking off items without implementing anything. This is the
most dangerous failure mode — it produces false completions that waste the entire
pipeline.

**Defense: Make deliverables concrete and verifiable.**

| ❌ Vague (shortcuttable) | ✅ Concrete (verifiable) |
|--------------------------|------------------------|
| "Add taskPacketRepo support" | "Add `taskPacketRepo` field to `WorkspaceRoutingConfig` in types.ts" |
| "Enforce mode selection" | "Add `validateWorkspaceMode()` function in workspace.ts that throws on invalid state" |
| "Update config loading" | "Modify `loadWorkspaceConfig()` to parse and validate `taskPacketRepo` from JSON config" |
| "Add tests" | "Create `tests/packet-home-contract.test.ts` with tests for: valid config, missing field error, invariant violation" |

**Rules for task creators:**
- Every implementation step MUST name specific files to create or modify
- "Add X" means "write new code that doesn't exist yet" — if it might already exist, say "verify X exists and add tests, or implement if missing"
- Include at least one NEW test file per task — workers can't shortcut test creation
- Each step's artifacts list must include at least one source file (not just STATUS.md)

---

## Key Principles

- **Documentation in every task.** Without "Must Update" and "Check If Affected"
  lists, docs drift from reality and future tasks work from stale context.
- **Testing step required.** Workers can't distinguish pre-existing failures from
  regressions they caused — every task needs a clean test pass to stay unblocked.
  The Testing & Verification step runs the **full** test suite as a quality gate.
  Implementation steps should use **targeted tests** (e.g., `--changed` or
  specific test files) for fast feedback — the worker prompt handles this.
- **Self-contained PROMPT.md.** The worker starts with a fresh context and no
  memory of the conversation that created the task. Everything it needs to begin
  must be in PROMPT.md and the referenced docs.
