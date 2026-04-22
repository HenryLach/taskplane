# Task: TP-175 - Worker Prompt and Skill Segment Markers

**Created:** 2026-04-12
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** Template and skill documentation changes. Low blast radius — no runtime code changes. Primarily content authoring.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-175-worker-prompt-and-skill-segment-markers/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Update the worker agent prompt template (`task-worker.md`) with multi-segment task rules, and update the create-taskplane-task skill to generate `#### Segment: <repoId>` markers when creating multi-repo tasks. These are the authoring-side changes that complement the runtime changes in TP-173/TP-174.

**Reference specification:** `docs/specifications/taskplane/segment-aware-steps.md` (sections A.6, A.7)

## Dependencies

- **None** (can run in parallel with TP-173/TP-174 — these are template/doc changes)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/segment-aware-steps.md` — sections A.6, A.7
- `templates/agents/task-worker.md` — current worker prompt
- `skills/create-taskplane-task/SKILL.md` — current skill definition
- `skills/create-taskplane-task/references/prompt-template.md` — PROMPT.md template

## Environment

- **Workspace:** `templates/`, `skills/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `templates/agents/task-worker.md`
- `skills/create-taskplane-task/SKILL.md`
- `skills/create-taskplane-task/references/prompt-template.md`

## Steps

### Step 0: Preflight

- [ ] Read current task-worker.md — understand existing sections and where multi-segment rules fit
- [ ] Read create-taskplane-task SKILL.md — understand current multi-repo handling
- [ ] Read prompt-template.md — understand current PROMPT.md template format

### Step 1: Update Worker Prompt

- [ ] Add "Multi-Segment Tasks" section to task-worker.md with rules from spec section A.6:
  - Only work on checkboxes for your current segment
  - Exit when your segment's checkboxes are complete
  - Do not modify files in other repos
  - Use `request_segment_expansion` for discovered cross-repo needs
  - Include context field for knowledge transfer
- [ ] Ensure the section integrates naturally with existing prompt structure (after Scope Rules, before Completion Integrity)
- [ ] Run targeted tests (if any prompt-related tests exist)

**Artifacts:**
- `templates/agents/task-worker.md` (modified)

### Step 2: Update Skill for Segment Markers

- [ ] Update SKILL.md to describe segment marker generation for multi-repo tasks
- [ ] Update prompt-template.md to include the `#### Segment: <repoId>` format in multi-segment examples
- [ ] Add guidance for step ordering: shared/common → per-repo impl → integration/docs
- [ ] Add guidance: always explicit segment markers in multi-repo tasks (never rely on fallback)
- [ ] Add guidance: final documentation/delivery step uses `#### Segment: <packet-repo>`
- [ ] Add max-10-segments-per-task guideline
- [ ] Run targeted tests (if any skill-related tests exist)

**Artifacts:**
- `skills/create-taskplane-task/SKILL.md` (modified)
- `skills/create-taskplane-task/references/prompt-template.md` (modified)

### Step 3: Testing & Verification

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Verify no test regressions (template changes shouldn't break runtime tests)
- [ ] Manual review: read the updated templates end-to-end for coherence

### Step 4: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `templates/agents/task-worker.md` — multi-segment section
- `skills/create-taskplane-task/SKILL.md` — segment marker guidance
- `skills/create-taskplane-task/references/prompt-template.md` — segment format example

**Check If Affected:**
- `docs/reference/task-format.md` — segment marker format documentation

## Completion Criteria

- [ ] Worker prompt includes multi-segment rules
- [ ] Skill generates segment markers for multi-repo tasks
- [ ] Prompt template shows the segment format
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `feat(TP-175): complete Step N — description`
- **Hydration:** `hydrate: TP-175 expand Step N checkboxes`

## Do NOT

- Modify runtime code (lane-runner, discovery, engine)
- Change existing single-segment task behavior or templates
- Skip tests
- Commit without the task ID prefix

---

## Amendments (Added During Execution)

