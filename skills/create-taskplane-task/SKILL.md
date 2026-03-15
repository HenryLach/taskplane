---
name: create-taskplane-task
version: 1.1.0
description: Creates structured Taskplane task packets (PROMPT.md, STATUS.md) for autonomous agent execution via the task-runner and task-orchestrator extensions. Use when asked to "create a task", "create a taskplane task", "stage a task", "prepare a task for execution", "write a PROMPT.md", "set up work for the agent", "queue a task", or whenever the user wants to define work that will be executed autonomously by another agent instance.
---

# Create Taskplane Task

Creates structured task packets (PROMPT.md + STATUS.md) for autonomous execution
via the **task-runner extension** and parallel batch execution via the
**task-orchestrator extension**. The extensions handle the execution loop,
fresh-context management, cross-model reviews, wave scheduling, and live
dashboard — so PROMPT.md stays focused on WHAT to do, not HOW to execute.

## Architecture

```
create-taskplane-task skill       → Creates PROMPT.md + STATUS.md
task-runner extension            → Executes the task autonomously
  ├─ task-worker.md agent        → Worker system prompt (checkpoint discipline, resume logic)
  ├─ task-reviewer.md agent      → Reviewer system prompt (review formats, criteria)
  └─ task-runner.yaml config     → Project-specific settings, paths, standards
```

The skill only creates files. All execution behavior lives in the extension and agents.

## Prerequisites

**If `.pi/task-runner.yaml` does not exist**, the project has not been initialized.
Tell the user to run `taskplane init` first — the skill cannot create tasks
without knowing where task areas live.

## Configuration

**Read `.pi/task-runner.yaml` before creating any task.** It contains:
- `task_areas` — folder paths, prefixes, CONTEXT.md locations per area
- `reference_docs` — available Tier 3 docs for "Context to Read First"
- `standards` — project coding rules and standards docs
- `testing.commands` — how to run tests
- `self_doc_targets` — where agents log discoveries
- `protected_docs` — docs requiring user approval to modify
- `never_load` — docs to exclude from task execution context

---

## Task Creation Workflow

### Step 1: Determine Location & Next ID

The user will rarely specify which area to use — **figure it out from context.**

**When there's only one area** (typical for new projects), use it directly.

**When there are multiple areas**, match the task to the right area:

1. Read `.pi/task-runner.yaml` → `task_areas` to get all areas
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
domains and platform areas in `task-runner.yaml`. The skill adapts — it always
reads the config to discover what areas exist rather than assuming a layout.

### Step 2: Assess Complexity & Size

See [Complexity Assessment](#complexity-assessment) and [Task Sizing](#task-sizing).

### Step 3: Create Task Folder

```
{area.path}/{PREFIX-###-slug}/
```

### Step 4: Create PROMPT.md

Use the template in [references/prompt-template.md](references/prompt-template.md).

### Step 5: Create STATUS.md

Use the STATUS.md template in [references/prompt-template.md](references/prompt-template.md).
(If omitted, the task-runner extension auto-generates it from PROMPT.md.)

### Step 6: Update Tracking

- **CONTEXT.md** — Increment `Next Task ID` (done in Step 1)
- **PROGRESS.md** — Add row to "Active Tasks" table

### Step 7: Report Launch Command

```
/task {area.path}/{PREFIX-###-slug}/PROMPT.md
```

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
`task-runner.yaml → reference_docs`. List only what the task actually needs.

Docs in `task-runner.yaml → never_load` must NOT appear in any task.

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
task-runner extension parses the step list from PROMPT.md once at `/task` launch
and iterates that fixed list. Steps added to STATUS.md at runtime will appear in
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
- [ ] Folder created at correct `task_areas` path with name `{PREFIX}-{###}-{slug}`
- [ ] Complexity assessed, review level assigned (0-3)
- [ ] Size assessed (S/M/L) — split if XL
- [ ] PROMPT.md created from template with all required sections:
  - [ ] `## Mission` with what AND why
  - [ ] `## Dependencies` section
  - [ ] `## Context to Read First` lists only needed Tier 3 docs
  - [ ] `## File Scope` lists files/dirs the task will touch
  - [ ] Each step has checkboxes with verifiable outcomes
  - [ ] Explicit testing step with commands
  - [ ] `## Do NOT` guardrails
  - [ ] "Must Update" and "Check If Affected" doc lists
  - [ ] `## Git Commit Convention` section (from template)
  - [ ] `## Amendments` placeholder at bottom
- [ ] STATUS.md created with matching step structure
  - [ ] Checkboxes match PROMPT.md granularity (1:1 where items are known)
  - [ ] `⚠️ Hydrate` markers for discovery-dependent steps
- [ ] PROGRESS.md updated (add to "Active Tasks")
- [ ] Launch command reported: `/task {path}/PROMPT.md`

---

## Git Commit Convention

The prompt template includes a `## Git Commit Convention` section with the full
format table (`feat(TASK-ID):`, `fix(TASK-ID):`, `checkpoint: TASK-ID`, etc.).
Always include it — without task ID prefixes, there's no way to trace commits
back to the task that produced them (`git log --grep="PM-004"` only works if
the prefix is there).

---

## Orchestrator Awareness

Tasks are often executed in parallel batches by the task-orchestrator extension,
not just individually via task-runner. Two fields in PROMPT.md become load-bearing
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

## Key Principles

- **Documentation in every task.** Without "Must Update" and "Check If Affected"
  lists, docs drift from reality and future tasks work from stale context.
- **Testing step required.** Workers can't distinguish pre-existing failures from
  regressions they caused — every task needs a clean test pass to stay unblocked.
- **Self-contained PROMPT.md.** The worker starts with a fresh context and no
  memory of the conversation that created the task. Everything it needs to begin
  must be in PROMPT.md and the referenced docs.
