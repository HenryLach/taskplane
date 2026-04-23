# Task: TP-102 - Runtime V2 ExecutionUnit and Packet-Path Contracts

**Created:** 2026-03-30
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Establishes the shared contract the rest of Runtime V2 will build on. This touches core orchestrator types and runtime interfaces, but remains mostly deterministic and reversible if kept contract-first.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-102-runtime-v2-execution-unit-and-packet-path-contracts/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Define the foundational Runtime V2 contracts in code: execution units, packet-path authority, runtime artifact locations, registry manifests, and helper validation utilities. This task should lift the packet-home work from the old TP-082 / TP-088 path into a first-class Runtime V2 foundation.

## Dependencies

- **Task:** TP-100 (planning suite and crosswalk are the authoritative v2 design source)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/framework/taskplane-runtime-v2/01-architecture.md` — target Runtime V2 component and invariants
- `docs/specifications/framework/taskplane-runtime-v2/02-runtime-process-model.md` — required process ownership and registry contracts
- `docs/specifications/framework/taskplane-runtime-v2/05-polyrepo-and-segment-compatibility.md` — packet-home and execution-unit compatibility rules
- `docs/specifications/taskplane/multi-repo-task-execution.md` — existing packet-home and segment requirements to absorb

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/types.ts`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/tests/*packet*`
- `extensions/tests/*runtime*`

## Steps

### Step 0: Preflight

- [ ] Trace the current task/lane runtime contracts through engine, execution, and resume
- [ ] Identify where packet paths, runtime identity, and live artifacts are currently implicit or TMUX-derived

### Step 1: Define Runtime V2 Contracts

- [ ] Add ExecutionUnit, packet-path, registry manifest, and normalized event type contracts to `types.ts`
- [ ] Add validation helpers and naming rules that preserve repo/workspace correctness
- [ ] Document compatibility shims where legacy task/lane records still need to coexist during migration

### Step 2: Thread Contracts into Orchestrator Interfaces

- [ ] Update engine/execution/resume signatures to accept explicit packet-path and runtime identity data where needed
- [ ] Add helper functions for resolving runtime artifact roots without TMUX/session assumptions
- [ ] Ensure new contracts are additive and do not yet force the full backend cutover

### Step 3: Testing & Verification

- [ ] Add or update behavioral tests covering ExecutionUnit shape, packet-path authority precedence, and runtime artifact naming
- [ ] Run the full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Update the Runtime V2 docs if implementation naming diverges from the spec suite
- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- `extensions/taskplane/types.ts`
- `docs/specifications/framework/taskplane-runtime-v2/05-polyrepo-and-segment-compatibility.md`

**Check If Affected:**
- `docs/explanation/persistence-and-resume.md`
- `docs/explanation/execution-model.md`

## Completion Criteria

- [ ] ExecutionUnit and packet-path authority are explicit code contracts
- [ ] Runtime identity no longer depends on TMUX naming assumptions at the type layer
- [ ] Regression tests cover the new contract surface

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-102): complete Step N — description`
- **Bug fixes:** `fix(TP-102): description`
- **Tests:** `test(TP-102): description`
- **Hydration:** `hydrate: TP-102 expand Step N checkboxes`

## Do NOT

- Implement the full Runtime V2 backend in this task
- Hide packet-path ambiguity behind silent fallbacks
- Reframe packet-home authority as an optional workspace feature

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
