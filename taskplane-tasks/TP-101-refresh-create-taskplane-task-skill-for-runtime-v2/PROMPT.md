# Task: TP-101 - Refresh create-taskplane-task Skill for Runtime V2

**Created:** 2026-03-30
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** Public skill and template refresh. Limited code risk, but the guidance is currently stale in several important ways (`/task`, YAML-first assumptions, `PROGRESS.md` requirement, and TMUX-era wording).
**Score:** 3/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-101-refresh-create-taskplane-task-skill-for-runtime-v2/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Update the bundled `create-taskplane-task` skill and its templates so task staging guidance matches Taskplane's Runtime V2 direction: JSON config precedence, `/orch` as the execution path, no TMUX dependency, and no hard `PROGRESS.md` requirement.

## Dependencies

- **Task:** TP-100 (Runtime V2 planning suite exists and defines the new architecture direction)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `skills/create-taskplane-task/SKILL.md` — current skill behavior and stale assumptions
- `skills/create-taskplane-task/references/prompt-template.md` — task packet template that still assumes the old execution model
- `docs/specifications/framework/taskplane-runtime-v2/01-architecture.md` — v2 direction for removing TMUX and `/task`
- `AGENTS.md` — project policy for JSON config precedence and current testing guidance

## Environment

- **Workspace:** `skills/`, `docs/`
- **Services required:** None

## File Scope

- `skills/create-taskplane-task/SKILL.md`
- `skills/create-taskplane-task/references/prompt-template.md`
- `docs/reference/commands.md`
- `README.md`

## Steps

### Step 0: Preflight

- [ ] Read the current skill, prompt template, and AGENTS/config guidance
- [ ] Identify every place the skill still assumes `/task`, TMUX, `PROGRESS.md`, or YAML-first config behavior

### Step 1: Update Skill Workflow and Guidance

- [ ] Switch the skill guidance to JSON config precedence while preserving fallback notes only where necessary
- [ ] Replace `/task` launch/reporting guidance with `/orch`-based execution guidance
- [ ] Remove TMUX-centric phrasing from the skill's architecture and workflow sections
- [ ] Remove `PROGRESS.md` as a required tracking artifact for this project/workflow

### Step 2: Update Templates and References

- [ ] Refresh the prompt/status template language so it does not imply `/task` is the canonical runtime path
- [ ] Align command references, task-creation checklists, and examples with Runtime V2 direction
- [ ] Review user-facing docs touched by the skill for consistency

### Step 3: Testing & Verification

- [ ] Verify markdown links and file references in the updated skill and templates
- [ ] Run CLI smoke checks: `node bin/taskplane.mjs help && node bin/taskplane.mjs doctor`
- [ ] If shipped docs/commands change beyond the skill itself, run the full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`

### Step 4: Documentation & Delivery

- [ ] Document any deliberate interim compatibility wording while Runtime V2 is still under construction
- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- `skills/create-taskplane-task/SKILL.md`
- `skills/create-taskplane-task/references/prompt-template.md`

**Check If Affected:**
- `README.md`
- `docs/reference/commands.md`
- `docs/README.md`

## Completion Criteria

- [ ] The bundled task-creation skill no longer points users at `/task` as the canonical execution path
- [ ] Skill guidance acknowledges JSON config precedence and the Runtime V2 direction
- [ ] `PROGRESS.md` is no longer treated as a hard requirement
- [ ] All updated references resolve cleanly

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-101): complete Step N — description`
- **Bug fixes:** `fix(TP-101): description`
- **Tests:** `test(TP-101): description`
- **Hydration:** `hydrate: TP-101 expand Step N checkboxes`

## Do NOT

- Leave stale `/task` launch commands in the skill
- Introduce Runtime V2 claims that the codebase cannot yet support
- Change task packet format semantics without updating reference docs

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
