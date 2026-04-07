# Task: TP-150 - Update docs README and rewrite single-task tutorial

**Created:** 2026-04-07
**Size:** M

## Review Level: 0 (None)

**Assessment:** Documentation-only changes to two markdown files. No code, no config, no security surface.
**Score:** 0/8 — Blast radius: 0, Pattern novelty: 0, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-150-docs-readme-and-single-task-tutorial/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Update `docs/README.md` and rewrite `docs/tutorials/run-your-first-task.md` to remove all references to the removed `/task` command. The `/task` command no longer exists in Taskplane — the only way to run tasks is via `/orch`. The docs should be written from the perspective of what exists today with no deprecation notices, no historical context, and no mention of `/task` at all.

`docs/tutorials/run-your-first-task.md` should be rewritten as a tutorial for running a single task using `/orch <path/to/PROMPT.md>`, which gives full worktree isolation, dashboard visibility, and inline reviews. The tutorial title and filename can stay as-is since "run your first task" is still a valid concept — it just uses `/orch` now.

`docs/README.md` should update the tutorial listing order and descriptions to reflect that `/orch` is the only execution path. The "Run Your First Task" tutorial should be reframed as showing how to use `/orch` for a single task (after the orchestration tutorial, which shows batch mode).

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `README.md` — the root README has the current accurate description of how single-task execution works with `/orch`
- `docs/reference/commands.md` — for accurate `/orch` command syntax (note: this file still has stale `/task` content that another task will clean up; use only the `/orch` sections as reference)

## Environment

- **Workspace:** `docs/`
- **Services required:** None

## File Scope

- `docs/README.md`
- `docs/tutorials/run-your-first-task.md`

## Steps

### Step 0: Preflight

- [ ] Read `docs/README.md` and identify all `/task` references and stale content
- [ ] Read `docs/tutorials/run-your-first-task.md` and understand current structure
- [ ] Read root `README.md` sections on single-task execution via `/orch` for ground truth

### Step 1: Update docs/README.md

- [ ] In the "New Users" section, reorder/rewrite tutorial links. Keep "Run Your First Task" but update its description to indicate it covers single-task execution via `/orch` (no mention of "Single-Task Mode" or `/task`)
- [ ] In the "Operators" section, remove "Configure Task Runner" link or relabel it (another task handles the actual how-to file — just fix the link text here). If the link target `how-to/configure-task-runner.md` still makes sense as a concept (configuring worker/reviewer/context settings), keep it with updated description
- [ ] Remove any other `/task` references throughout the file
- [ ] Ensure all links still resolve to valid files

### Step 2: Rewrite docs/tutorials/run-your-first-task.md

Rewrite the tutorial from scratch as "Run Your First Task" using `/orch`. Key changes:

- [ ] Remove all `/task`, `/task-status`, `/task-pause`, `/task-resume` references
- [ ] The tutorial should show: running `/orch taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md` to execute a single task with full orchestrator infrastructure (worktree isolation, dashboard, reviews)
- [ ] Explain PROMPT.md and STATUS.md file structure (this existing content is still valid)
- [ ] Show monitoring via `/orch-status` and the dashboard
- [ ] Show pause/resume via `/orch-pause` and `/orch-resume`
- [ ] Show completion verification (`.DONE` file, STATUS.md checkboxes)
- [ ] Explain the worker loop briefly (persistent-context model, STATUS.md as memory)
- [ ] Update troubleshooting section for `/orch`-based errors
- [ ] Update "Next Step" links at the bottom
- [ ] Do NOT mention `/task` anywhere — not even as "previously" or "deprecated"

### Step 3: Documentation & Delivery

- [ ] Verify all internal doc links in both files resolve correctly
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/README.md` — remove `/task` references, update tutorial descriptions
- `docs/tutorials/run-your-first-task.md` — full rewrite for `/orch`-based single task execution

**Check If Affected:**
- `docs/tutorials/install.md` — if any cross-links reference "run your first task" (another task handles the main install.md update)

## Completion Criteria

- [ ] All steps complete
- [ ] Zero references to `/task`, `/task-status`, `/task-pause`, or `/task-resume` in either file
- [ ] Tutorial accurately describes running a single task via `/orch`
- [ ] All markdown links resolve

## Git Commit Convention

- **Step completion:** `docs(TP-150): complete Step N — description`
- **Bug fixes:** `fix(TP-150): description`
- **Hydration:** `hydrate: TP-150 expand Step N checkboxes`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Mention `/task` in any context (no deprecation, no history, no "previously")
- Modify any files outside `docs/README.md` and `docs/tutorials/run-your-first-task.md`
- Reference tmux as a dependency (Runtime V2 uses subprocess backend)
- Skip tests
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)
