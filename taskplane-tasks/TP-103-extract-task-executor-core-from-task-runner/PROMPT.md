# Task: TP-103 - Extract Task Executor Core from task-runner

**Created:** 2026-03-30
**Size:** L

## Review Level: 3 (Full)

**Assessment:** Moves critical execution semantics out of the deprecated `/task` extension host. High blast radius across worker, reviewer, status, and completion logic; must preserve behavior while changing ownership.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 2, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-103-extract-task-executor-core-from-task-runner/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Extract the headless task execution state machine from `extensions/task-runner.ts` into a reusable Runtime V2 core library, leaving the extension as a thin compatibility wrapper only for as long as needed. After this task, no mission-critical execution logic should live exclusively inside the deprecated `/task` path.

## Dependencies

- **Task:** TP-100 (Runtime V2 foundation and task graph staged)
- **Task:** TP-102 (ExecutionUnit and packet-path contracts defined)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/framework/taskplane-runtime-v2/02-runtime-process-model.md` — lane-runner and executor-core target ownership
- `docs/specifications/framework/taskplane-runtime-v2/08-implementation-workpackages.md` — expected extraction work package
- `extensions/task-runner.ts` — current execution logic to extract
- `docs/explanation/execution-model.md` — behavioral contract that must remain intact

## Environment

- **Workspace:** `extensions/`
- **Services required:** None

## File Scope

- `extensions/task-runner.ts`
- `extensions/taskplane/task-executor-core.ts`
- `extensions/taskplane/*review*`
- `extensions/tests/persistent-worker-context.test.ts`
- `extensions/tests/task-runner-orchestration.test.ts`

## Steps

### Step 0: Preflight

- [ ] Map the current task-runner execution path: parsing, status mutation, worker loop, reviewer integration, quality gate, and `.DONE` semantics
- [ ] Identify which helpers can move unchanged and which need new runtime-facing interfaces

### Step 1: Extract Headless Executor Core

- [ ] Create a new headless executor module that owns task execution semantics without Pi UI/session assumptions
- [ ] Move STATUS parsing/mutation, worker iteration bookkeeping, and completion checks behind explicit interfaces
- [ ] Move review orchestration and quality-gate helpers behind explicit runtime-facing interfaces where practical

### Step 2: Thin task-runner Wrapper

- [ ] Refactor `task-runner.ts` to delegate to the shared core instead of owning the logic directly
- [ ] Keep the deprecated `/task` surface as a wrapper only if needed for interim compatibility, not as the architectural owner
- [ ] Ensure Runtime V2 callers can invoke the shared core without `TASK_AUTOSTART` or session-start coupling

### Step 3: Testing & Verification

- [ ] Add or update behavioral tests proving execution semantics are preserved after extraction
- [ ] Run the full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Update execution architecture docs if extracted module boundaries differ from the spec
- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- `extensions/taskplane/task-executor-core.ts`
- `extensions/task-runner.ts`

**Check If Affected:**
- `docs/explanation/execution-model.md`
- `docs/explanation/architecture.md`
- `README.md`

## Completion Criteria

- [ ] A headless executor core exists and owns task execution semantics
- [ ] `task-runner.ts` is no longer the only place where mission-critical execution logic lives
- [ ] Regression tests prove behavior parity

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-103): complete Step N — description`
- **Bug fixes:** `fix(TP-103): description`
- **Tests:** `test(TP-103): description`
- **Hydration:** `hydrate: TP-103 expand Step N checkboxes`

## Do NOT

- Preserve `/task` as the long-term authoritative execution path
- Couple the extracted core to Pi UI widgets or session lifecycle
- Change `.DONE` or STATUS semantics casually

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
