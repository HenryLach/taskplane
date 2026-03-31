# Task: TP-108 - Batch and Merge Runtime V2 Migration

**Created:** 2026-03-30
**Size:** L

## Review Level: 3 (Full)

**Assessment:** This is the full-wave orchestration cutover: engine, lane execution, merge hosting, and recovery all stop depending on TMUX-backed infrastructure. Highest-risk runtime task after the foundational extraction.
**Score:** 7/8 — Blast radius: 3, Pattern novelty: 2, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-108-batch-and-merge-runtime-v2-migration/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Migrate full batch execution and merge hosting onto Runtime V2. The engine should launch lane-runners for waves, merge agents should run through the direct agent host, and batch correctness/recovery should no longer depend on TMUX sessions anywhere in the critical path.

## Dependencies

- **Task:** TP-104 (direct agent host and registry exist)
- **Task:** TP-105 (lane-runner and single-task Runtime V2 path exist)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/framework/taskplane-runtime-v2/01-architecture.md` — full target architecture
- `docs/specifications/framework/taskplane-runtime-v2/02-runtime-process-model.md` — required ownership and cleanup semantics
- `docs/specifications/framework/taskplane-runtime-v2/06-migration-and-rollout.md` — batch migration and rollout plan
- `extensions/taskplane/engine.ts` — current wave execution control flow
- `extensions/taskplane/merge.ts` — current merge host path still built around TMUX

## Environment

- **Workspace:** `extensions/taskplane/`, `bin/`
- **Services required:** None

## File Scope

- `extensions/taskplane/engine.ts`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/sessions.ts`
- `extensions/taskplane/cleanup.ts`
- `extensions/tests/*merge*`
- `extensions/tests/*resume*`

## Steps

### Step 0: Preflight

- [ ] Trace current wave execution, lane provisioning, merge hosting, and cleanup/recovery logic from the perspective of TMUX dependency
- [ ] Define exactly which runtime responsibilities shift to engine, lane-runner, and agent-host in the batch path

### Step 1: Lane-Runner Batch Integration

- [ ] Update engine/execution flow to launch lane-runners for batch waves
- [ ] Replace lane-session/TMUX liveness assumptions with registry-backed lifecycle handling
- [ ] Preserve worktree and orch-branch semantics during the cutover

### Step 2: Merge Host Migration

- [ ] Move merge agent execution onto the direct agent host/backend
- [ ] Preserve structured merge telemetry, verification behavior, and failure classification on the new path
- [ ] Ensure merge recovery and pause behavior still works without TMUX

### Step 3: Recovery, Cleanup, and Tooling

- [ ] Replace TMUX-centric active-session discovery and orphan cleanup with registry/process-based behavior
- [ ] Keep pause/resume/abort semantics recoverable under the new ownership model
- [ ] Review operator tooling affected by the backend cutover

### Step 4: Testing & Verification

- [ ] Add or update behavioral tests for full-wave Runtime V2 execution and merge lifecycle
- [ ] Run the full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Run CLI smoke checks: `node bin/taskplane.mjs help && node bin/taskplane.mjs doctor`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Update rollout docs, architecture docs, and any operator guidance changed by the batch cutover
- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/specifications/framework/taskplane-runtime-v2/06-migration-and-rollout.md`
- `docs/explanation/architecture.md`

**Check If Affected:**
- `README.md`
- `docs/reference/commands.md`
- `docs/explanation/persistence-and-resume.md`

## Completion Criteria

- [ ] Full batch execution runs on Runtime V2 without TMUX in the correctness path
- [ ] Merge hosting and recovery also use the Runtime V2 backend
- [ ] Registry/process-owned cleanup replaces TMUX-based batch liveness assumptions

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-108): complete Step N — description`
- **Bug fixes:** `fix(TP-108): description`
- **Tests:** `test(TP-108): description`
- **Hydration:** `hydrate: TP-108 expand Step N checkboxes`

## Do NOT

- Leave merge execution on TMUX while claiming the batch backend is migrated
- Break orch-branch/worktree invariants during the runtime cutover
- Ship the cutover without full-suite validation

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
