# Task: TP-060 - Targeted Test Execution

**Created:** 2026-03-25
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Changes worker behavior during test execution — affects how every task runs tests. Touches worker template, PROMPT template conventions, and potentially the task-runner's test execution logic. Medium blast radius since it changes the worker's core test strategy.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-060-targeted-test-execution/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Tasks spend 5-10+ minutes running the full test suite (~2600 tests, ~170s) multiple times — after each implementation step and again in the final Testing & Verification step. Most of these runs are redundant: a task touching `formatting.ts` doesn't need to run polyrepo or quality-gate tests.

Implement a targeted test execution strategy:
- **During implementation steps:** Run only tests related to changed files (fast feedback)
- **Testing & Verification step:** Run the full suite once as a quality gate
- **Merge agent:** Runs full suite again (unchanged — this is the final safety net)

This gives workers fast feedback loops without sacrificing the full-suite safety net.

### Design Rationale: Why This Balance Is Right

**The risk of skipping tests during implementation is low because:**
1. The full suite still runs in the Testing step (before .DONE)
2. The merge agent runs the full suite again (before merging to orch branch)
3. CI runs on the PR (before merging to main)
4. That's **three** full-suite checkpoints even if intermediate steps run targeted tests

**The cost of running full suite every step is high because:**
1. ~170s per run × 4-5 steps = 10-14 minutes of pure test time per task
2. Most test files are unrelated to the files being changed
3. Workers already get fast feedback from targeted tests — if they broke something, they'll know
4. The worker's time is better spent implementing than waiting for unrelated tests

**The right signal for targeted tests is `--changed`:**
- Vitest's `--changed` flag uses git to find files modified since the last commit
- Workers commit at step boundaries, so between commits the changed set is exactly "what this step modified"
- This naturally targets the right tests without needing explicit file lists
- Falls back to full suite if `--changed` finds nothing (fresh worktree, no changes)

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `templates/agents/task-worker.md` — worker system prompt, test execution instructions
- `skills/create-taskplane-task/SKILL.md` — PROMPT.md template conventions
- `skills/create-taskplane-task/references/prompt-template.md` — the actual PROMPT template

## Environment

- **Workspace:** `templates/`, `skills/`
- **Services required:** None

## File Scope

- `templates/agents/task-worker.md`
- `templates/agents/local/task-worker.md`
- `skills/create-taskplane-task/SKILL.md`
- `skills/create-taskplane-task/references/prompt-template.md`

## Steps

### Step 0: Preflight

- [ ] Read worker template (`templates/agents/task-worker.md`) — find current test execution instructions
- [ ] Read PROMPT template (`skills/create-taskplane-task/references/prompt-template.md`) — find Testing step template
- [ ] Read create-taskplane-task skill — find test command conventions
- [ ] Verify `npx vitest run --changed` works in the repo: `cd extensions && npx vitest run --changed`

### Step 1: Update Worker Template — Test Strategy

Update `templates/agents/task-worker.md` to instruct workers on targeted test execution:

**Add a "Test Execution Strategy" section that says:**

1. **After implementing each step:** Run targeted tests related to your changes. Use the project's test command with `--changed` flag if available (e.g., `npx vitest run --changed`). Alternatively, run specific test files that cover the code you modified.
2. **In the Testing & Verification step:** Run the FULL test suite (e.g., `npx vitest run` without flags). This is the quality gate — ALL tests must pass.
3. **If targeted tests fail:** Fix the failure before proceeding. Don't accumulate failures across steps.
4. **If `--changed` returns no tests:** That's fine — it means your changes don't have directly related test files. The full suite in the Testing step will catch any indirect regressions.

**Key principle:** Fast feedback during implementation, full verification at the gate. The merge agent and CI run the full suite again — you have safety nets.

**Artifacts:**
- `templates/agents/task-worker.md` (modified)
- `templates/agents/local/task-worker.md` (modified — update comments about base prompt capabilities)

### Step 2: Update PROMPT Template — Testing Step

Update the PROMPT template in `skills/create-taskplane-task/references/prompt-template.md`:

**Change the Testing & Verification step template from:**
```markdown
### Step [N-1]: Testing & Verification
> ZERO test failures allowed.
- [ ] Run unit tests: `[test command from task-runner.yaml]`
```

**To:**
```markdown
### Step [N-1]: Testing & Verification
> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.
> (Earlier steps should use targeted tests for fast feedback.)
- [ ] Run FULL test suite: `[test command from task-runner.yaml]`
```

Also update the per-step template to suggest targeted tests:
```markdown
### Step N: [Name]
- [ ] [Implementation items]
- [ ] Run targeted tests: `[test command] --changed` or specific test files
```

**Artifacts:**
- `skills/create-taskplane-task/references/prompt-template.md` (modified)

### Step 3: Update Skill Documentation

Update `skills/create-taskplane-task/SKILL.md` to reflect the targeted test strategy in its guidance for task creators:

- In the testing/verification section, note that per-step tests should be targeted
- The Testing & Verification step is the only step that requires the full suite
- Task creators can specify relevant test files in each step's artifacts section for extra clarity

**Artifacts:**
- `skills/create-taskplane-task/SKILL.md` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed. This step runs the FULL test suite as a quality gate.

- [ ] Verify `npx vitest run --changed` works correctly in the repo
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Build passes: `node bin/taskplane.mjs help`
- [ ] Review the updated worker template for clarity and correctness

### Step 5: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None beyond the template/skill changes above

**Check If Affected:**
- `docs/explanation/execution-model.md` — mentions checkpoint discipline, may want to note targeted tests

## Completion Criteria

- [ ] Worker template instructs targeted test execution during implementation steps
- [ ] Worker template instructs full suite in Testing & Verification step
- [ ] PROMPT template reflects targeted vs full-suite distinction
- [ ] Skill documentation updated
- [ ] All tests passing
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-060): complete Step N — description`
- **Bug fixes:** `fix(TP-060): description`
- **Hydration:** `hydrate: TP-060 expand Step N checkboxes`

## Do NOT

- Change the task-runner's test execution logic — this is a template/convention change only
- Make targeted tests mandatory — workers should use judgment on what to test
- Remove the full suite from the Testing step — that's the safety net
- Change the merge agent's test behavior — it always runs the full suite
- Add config options — hardcode the strategy in templates, config comes later if needed

---

## Amendments (Added During Execution)

