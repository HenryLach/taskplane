# Task: TP-156 - Update root README.md to remove /task and tmux references

**Created:** 2026-04-07
**Size:** S

## Review Level: 0 (None)

**Assessment:** Documentation-only changes to one markdown file. Removing stale content.
**Score:** 0/8 — Blast radius: 0, Pattern novelty: 0, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-156-docs-root-readme/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Update the root `README.md` to remove all remaining references to the `/task` command and tmux. The README already marks `/task` as deprecated, but since we're not tracking deprecation history, those notices should be removed entirely. The command table should only show `/orch*` and `/taskplane-settings` commands. The prerequisites table should not list tmux. Write from the perspective of what exists today.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

## Environment

- **Workspace:** project root
- **Services required:** None

## File Scope

- `README.md`

## Steps

### Step 0: Preflight

- [ ] Read `README.md` and catalog all `/task` and tmux references

### Step 1: Update README.md

- [ ] **Prerequisites table:** Remove the tmux row entirely. Remove the paragraph below the table that says tmux is needed for `/orch` and describes `taskplane install-tmux`. The required dependencies are just: Node.js ≥ 22, pi, Git
- [ ] **Quickstart "Run your first orchestration" section:** Already uses `/orch` — verify no `/task` references. The comment about `/orch` with no args should be kept as-is
- [ ] **Quickstart "Run a single task" section:** Currently says to use `/orch <path>` but has a blockquote saying `/task` is deprecated — remove that entire blockquote. The section should present `/orch <path>` as the natural way to run a single task, with no mention of `/task`
- [ ] **Commands table:** Remove all `/task*` rows (`/task`, `/task-status`, `/task-pause`, `/task-resume`) and their deprecated notices. Only `/orch*` and `/taskplane-settings` should remain
- [ ] **"How It Works" diagram:** The ASCII art shows `/task` inside each lane box. Update the lane boxes to show `Worker` instead of `/task Worker`. The inner labels should be something like `Worker` and `Review` (no `/task`)
- [ ] **"How it works" paragraph below the diagram:** If it references `/task`, update to describe lanes executing tasks directly
- [ ] **Any other stale references:** Scan the entire file for remaining `/task` or tmux mentions and remove them

### Step 2: Documentation & Delivery

- [ ] Re-read the full README to verify it reads cleanly with no stale references
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `README.md` — remove all `/task` and tmux references

**Check If Affected:**
- None

## Completion Criteria

- [ ] All steps complete
- [ ] Zero references to `/task`, `/task-status`, `/task-pause`, or `/task-resume`
- [ ] Zero references to tmux as a prerequisite or dependency
- [ ] No deprecation notices or historical context remain
- [ ] README reads as a clean, current document
- [ ] All markdown links resolve

## Git Commit Convention

- **Step completion:** `docs(TP-156): complete Step N — description`
- **Bug fixes:** `fix(TP-156): description`
- **Hydration:** `hydrate: TP-156 expand Step N checkboxes`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Mention `/task` in any context
- Mention tmux as a prerequisite, dependency, or optional install
- Modify any files outside `README.md`
- Rewrite content that is already accurate — make targeted removals/edits
- Skip tests
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)
