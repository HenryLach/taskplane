# Task: TP-152 - Remove /task commands from commands reference

**Created:** 2026-04-07
**Size:** S

## Review Level: 0 (None)

**Assessment:** Documentation-only removal of a section from one markdown file. No code, no config.
**Score:** 0/8 — Blast radius: 0, Pattern novelty: 0, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-152-docs-commands-reference/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Remove the entire "Task Runner Commands" section from `docs/reference/commands.md`. The `/task`, `/task-status`, `/task-pause`, and `/task-resume` commands no longer exist in Taskplane. The commands reference should document only what exists today: the `/orch*` family, `/taskplane-settings`, and CLI commands. No deprecation notices, no historical context.

Also clean up any remaining `/task` references in other parts of the file (e.g., the intro paragraph, Related section links to `task-runner.yaml`).

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `README.md` — current command table for ground truth

## Environment

- **Workspace:** `docs/reference/`
- **Services required:** None

## File Scope

- `docs/reference/commands.md`

## Steps

### Step 0: Preflight

- [ ] Read `docs/reference/commands.md` and identify all `/task`-related content
- [ ] Read root `README.md` command table for ground truth

### Step 1: Update docs/reference/commands.md

- [ ] Remove the entire "Task Runner Commands" section (everything from the `## Task Runner Commands` heading through the `/task-resume` documentation, including the deprecation banner)
- [ ] Update the intro paragraph: change `1. pi session slash commands (\`/task\`, \`/orch*\`, \`/taskplane-settings\`)` to remove the `/task` reference — it should just mention `/orch*` and `/taskplane-settings`
- [ ] In the "Related" section at the bottom, remove the link to "Task Runner Config Reference" (`task-runner.yaml.md`) — this is a legacy config doc. Keep the Task Orchestrator Config Reference link and the Task Format Reference link
- [ ] Scan for any remaining `/task` mentions in the `/orch` documentation sections. For example, the `/orch` description may say "Each lane runs task-runner (`/task`) semantics" — reword to describe lane execution without referencing `/task`
- [ ] Ensure the table of contents / section numbering flows cleanly after the removal

### Step 2: Documentation & Delivery

- [ ] Verify all internal doc links resolve correctly
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/reference/commands.md` — remove Task Runner Commands section and all `/task` references

**Check If Affected:**
- None

## Completion Criteria

- [ ] All steps complete
- [ ] Zero references to `/task`, `/task-status`, `/task-pause`, or `/task-resume` in the file
- [ ] No deprecation banners or historical context remain
- [ ] Document reads cleanly with the section removed
- [ ] All markdown links resolve

## Git Commit Convention

- **Step completion:** `docs(TP-152): complete Step N — description`
- **Bug fixes:** `fix(TP-152): description`
- **Hydration:** `hydrate: TP-152 expand Step N checkboxes`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Mention `/task` in any context
- Modify any files outside `docs/reference/commands.md`
- Rewrite the `/orch*` command docs — only remove `/task*` content and fix references
- Skip tests
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)
