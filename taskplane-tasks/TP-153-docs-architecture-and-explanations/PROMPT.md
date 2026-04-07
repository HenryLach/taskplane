# Task: TP-153 - Update architecture and explanation docs

**Created:** 2026-04-07
**Size:** M

## Review Level: 0 (None)

**Assessment:** Documentation-only changes to explanation markdown files. No code, no config, no security surface.
**Score:** 0/8 — Blast radius: 0, Pattern novelty: 0, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-153-docs-architecture-and-explanations/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Update the explanation docs in `docs/explanation/` to remove all references to the `/task` command and present the current architecture accurately. The `/task` command no longer exists — the orchestrator (`/orch`) is the only execution path. `task-runner.ts` still exists as an internal module used by the orchestrator for lane execution, but it is not a user-facing command surface. Runtime V2 uses subprocess execution (no tmux). Write from the perspective of what exists today.

The primary file needing significant changes is `docs/explanation/architecture.md`. The other explanation docs need a scan-and-fix pass for any stale `/task` references.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `README.md` — ground truth for architecture description and "How It Works" section

## Environment

- **Workspace:** `docs/explanation/`
- **Services required:** None

## File Scope

- `docs/explanation/architecture.md`
- `docs/explanation/execution-model.md`
- `docs/explanation/review-loop.md`
- `docs/explanation/waves-lanes-and-worktrees.md`
- `docs/explanation/persistence-and-resume.md`
- `docs/explanation/package-and-template-model.md`

## Steps

### Step 0: Preflight

- [ ] Read all files in `docs/explanation/` and catalog every `/task` or stale reference
- [ ] Read root `README.md` "How It Works" section for ground truth

### Step 1: Update docs/explanation/architecture.md

This file has the most significant staleness:

- [ ] **Update ASCII diagram:** The current diagram shows `/task /task-status` in the pi session box. Replace with just `/orch* commands` (or `/orch /orch-plan /orch-status ...`). Remove the `(task-runner extension)` label. The diagram should show one extension surface, not two
- [ ] **Update "Major modules" section:** Rewrite "1) Task Runner extension" — it should be described as an internal module used by the orchestrator for lane execution, NOT as a user-facing command surface. Remove `/task`, `/task-status`, `/task-pause`, `/task-resume` from its listed commands. Describe it as: "Owns single-task execution within a lane — parsing PROMPT.md, managing STATUS.md, running the worker/reviewer loop, enforcing checkpoint discipline"
- [ ] **Update "2) Task Orchestrator extension":** This is now the sole user-facing command surface. Make sure the description doesn't reference `/task` as a separate user concern
- [ ] **Update "Data and control flow" section:** Step 1 says "User invokes command in pi (`/task` or `/orch*`)" — change to just `/orch*`
- [ ] **Update any other `/task` references** throughout the file
- [ ] Remove tmux references if any remain (Runtime V2 section already looks correct)

### Step 2: Scan and fix other explanation docs

Read each file and fix stale references:

- [ ] `docs/explanation/execution-model.md` — already mostly `/orch`-centric but scan for any remaining `/task` references in the lifecycle, pause/resume, or completion sections. Update if found
- [ ] `docs/explanation/review-loop.md` — scan for `/task` references and update
- [ ] `docs/explanation/waves-lanes-and-worktrees.md` — scan for `/task` references and update
- [ ] `docs/explanation/persistence-and-resume.md` — scan for `/task` references and update
- [ ] `docs/explanation/package-and-template-model.md` — scan for `/task` references and update

### Step 3: Documentation & Delivery

- [ ] Verify all internal doc links resolve correctly
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/explanation/architecture.md` — major rewrite of diagram and module descriptions
- `docs/explanation/*.md` — scan-and-fix pass on all explanation docs

**Check If Affected:**
- None

## Completion Criteria

- [ ] All steps complete
- [ ] Zero user-facing references to `/task`, `/task-status`, `/task-pause`, or `/task-resume` in any explanation doc
- [ ] `task-runner.ts` is described as an internal orchestrator module, not a user command
- [ ] Architecture diagram accurately reflects current system
- [ ] All markdown links resolve

## Git Commit Convention

- **Step completion:** `docs(TP-153): complete Step N — description`
- **Bug fixes:** `fix(TP-153): description`
- **Hydration:** `hydrate: TP-153 expand Step N checkboxes`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Mention `/task` as a user-facing command
- Modify files outside `docs/explanation/`
- Rewrite the entire content of explanation docs — only fix stale references
- Skip tests
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)
