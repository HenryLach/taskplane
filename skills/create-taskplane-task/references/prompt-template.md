# PROMPT.md Template

Copy this template when creating a new task. Replace all `[bracketed]` fields.

---

````markdown
# Task: [PREFIX-###] - [Name]

**Created:** [YYYY-MM-DD]
**Size:** [S | M | L]

## Review Level: [0-3] ([None | Plan Only | Plan and Code | Full])

**Assessment:** [1-2 sentences explaining the score]
**Score:** [N]/8 — Blast radius: [N], Pattern novelty: [N], Security: [N], Reversibility: [N]

## Canonical Task Folder

```
[FULL_PATH_TO_TASK_FOLDER]/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

[One paragraph: what you're building and why it matters]

## Dependencies

[Choose one:]

- **None**

[OR:]

- **Task:** [PREFIX-###] ([what must be complete])
- **Task:** [area-name/PREFIX-###] ([use area-qualified form if cross-area ID may be ambiguous])
- **External:** [what must be true]

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `[path/to/CONTEXT.md]`

**Tier 3 (load only if needed):**
- `[path/to/specific-doc.md]` — [why needed]

## Environment

- **Workspace:** [primary folder/service being modified]
- **Services required:** [list, or "None"]

## File Scope

> The orchestrator uses this to avoid merge conflicts: tasks with overlapping
> file scope run on the same lane (serial), not in parallel. List the files and
> directories this task will create or modify. Use wildcards for directories.

- `[path/to/file.ext]`
- `[path/to/directory/*]`

## Steps

> **Hydration:** STATUS.md tracks outcomes, not individual code changes. Workers
> expand steps when runtime discoveries warrant it. See task-worker agent for rules.

### Step 0: Preflight

- [ ] Required files and paths exist
- [ ] Dependencies satisfied

### Step 1: [Name]

- [ ] [Specific, verifiable task]
- [ ] [Specific, verifiable task]
- [ ] [Specific, verifiable task]

**Artifacts:**
- `path/to/file` (new | modified)

### Step [N-1]: Testing & Verification

> ZERO test failures allowed.

- [ ] Run unit tests: `[test command from task-runner.yaml]`
- [ ] Run integration tests (if applicable)
- [ ] Fix all failures
- [ ] Build passes: `[build command]`

### Step [N]: Documentation & Delivery

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `[path/to/doc.md]` — [what to add/change]

**Check If Affected:**
- `[path/to/doc.md]` — [update if relevant]

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] `.DONE` created

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat([PREFIX-###]): complete Step N — description`
- **Bug fixes:** `fix([PREFIX-###]): description`
- **Tests:** `test([PREFIX-###]): description`
- **Hydration:** `hydrate: [PREFIX-###] expand Step N checkboxes`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Modify framework/standards docs without explicit user approval
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution.
     Format:
     ### Amendment N — YYYY-MM-DD HH:MM
     **Issue:** [what was wrong]
     **Resolution:** [what was changed] -->
````

---

# STATUS.md Template

Create alongside PROMPT.md. If omitted, the task-runner extension auto-generates
this from PROMPT.md.

````markdown
# [PREFIX-###]: [Name] — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** [YYYY-MM-DD]
**Review Level:** [0-3]
**Review Counter:** 0
**Iteration:** 0
**Size:** [S | M | L]

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Required files and paths exist
- [ ] Dependencies satisfied

---

### Step 1: [Name]
**Status:** ⬜ Not Started

[If items are known at creation time, list each one:]
- [ ] [Specific item from PROMPT.md]
- [ ] [Specific item from PROMPT.md]

[If items depend on runtime discovery:]
> ⚠️ Hydrate: Expand checkboxes when entering this step based on [what]

- [ ] [High-level placeholder — worker will expand]

---

### Step [N-1]: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Unit tests passing
- [ ] Integration tests (if applicable)
- [ ] All failures fixed
- [ ] Build passes

---

### Step [N]: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| [YYYY-MM-DD] | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
````
