# Task: TP-155 - Update dev setup and orchestration tutorial

**Created:** 2026-04-07
**Size:** S

## Review Level: 0 (None)

**Assessment:** Documentation-only changes to two markdown files. Straightforward find-and-replace style updates.
**Score:** 0/8 — Blast radius: 0, Pattern novelty: 0, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-155-docs-dev-setup-and-orch-tutorial/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Update `docs/maintainers/development-setup.md` and `docs/tutorials/run-your-first-orchestration.md` to remove `/task` references and update config format references. These files have moderate staleness — a few specific lines need fixing rather than full rewrites.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `README.md` — for current dev workflow and command reference

## Environment

- **Workspace:** `docs/`
- **Services required:** None

## File Scope

- `docs/maintainers/development-setup.md`
- `docs/tutorials/run-your-first-orchestration.md`

## Steps

### Step 0: Preflight

- [ ] Read both files and catalog all stale references

### Step 1: Update docs/maintainers/development-setup.md

- [ ] **"Run extensions locally" section:** The "Load task-runner only" subsection shows `pi -e extensions/task-runner.ts` and `just task`. Since `task-runner.ts` is now an internal module (not a standalone user command surface), remove or rephrase this subsection. The recommended local dev command is loading the orchestrator which includes the task runner internally. Keep `just orch` / `pi -e extensions/task-orchestrator.ts -e extensions/task-runner.ts` as the primary workflow
- [ ] **"Recommended local dev loop" section:** Step 4 lists `/task ...` as a manual smoke flow — remove it. Keep `/orch-plan all`, `/orch all`, and `taskplane doctor`
- [ ] **"Suggested scratch-repo smoke test" section:** The pi session commands include `/task taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md` — remove it. Keep `/orch-plan all` and `/orch all`. Optionally add `/orch taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md` to show single-task execution
- [ ] **"File map" section:** The entry for `extensions/task-runner.ts` says "single-task engine" — update to something like "single-task execution engine (used internally by orchestrator lanes)" to clarify it's not a user-facing command

### Step 2: Update docs/tutorials/run-your-first-orchestration.md

- [ ] **"Before You Start" section:** References `.pi/task-runner.yaml` and `.pi/task-orchestrator.yaml` as files you should have — update to reference `.pi/taskplane-config.json` as the primary config
- [ ] **"Step 1: Understand Task Areas" section:** Shows a YAML snippet from `.pi/task-runner.yaml` — convert to a JSON snippet from `taskplane-config.json` showing the `taskRunner.taskAreas` structure
- [ ] **"Step 4: Start the Batch" section:** Line says "Each lane runs task-runner (`/task`) semantics" — reword to describe lane execution without referencing `/task` (e.g., "Each lane executes its assigned task in an isolated worktree with the worker/reviewer pipeline")
- [ ] **"Related guides" links at bottom:** Keep as-is unless they reference stale file names

### Step 3: Documentation & Delivery

- [ ] Verify all internal doc links resolve correctly
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/maintainers/development-setup.md` — remove `/task` from dev workflows
- `docs/tutorials/run-your-first-orchestration.md` — update config refs and `/task` mention

**Check If Affected:**
- None

## Completion Criteria

- [ ] All steps complete
- [ ] Zero user-facing references to `/task` in either file
- [ ] Config references updated to `taskplane-config.json` where applicable
- [ ] All markdown links resolve

## Git Commit Convention

- **Step completion:** `docs(TP-155): complete Step N — description`
- **Bug fixes:** `fix(TP-155): description`
- **Hydration:** `hydrate: TP-155 expand Step N checkboxes`

## Do NOT

- Expand task scope — add tech debt to CONTEXT.md instead
- Mention `/task` as a user-facing command
- Modify files outside the two specified files
- Rewrite entire documents — make targeted fixes only
- Skip tests
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)
