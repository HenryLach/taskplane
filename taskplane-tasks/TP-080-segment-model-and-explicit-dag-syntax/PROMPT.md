# Task: TP-080 - Segment Model and Optional Explicit DAG Syntax

**Created:** 2026-03-28
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Introduces new planning primitives (segments + edges) and prompt metadata parsing with inference fallback. Medium-high impact across discovery/planning paths.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-080-segment-model-and-explicit-dag-syntax/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Introduce the v1 segment planning model for multi-repo task execution. Each task should produce deterministic repo-scoped segments, with optional explicit segment DAG metadata in `PROMPT.md` supported now and deterministic inference used when metadata is absent.

## Dependencies

- **Task:** TP-079 (workspace packet-home contract and deterministic mode enforcement)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — segment model + ordering decisions
- `extensions/taskplane/discovery.ts` — task parsing and routing inputs
- `extensions/taskplane/waves.ts` — planning pipeline hooks
- `extensions/taskplane/types.ts` — contracts for planning/runtime state

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/types.ts`
- `extensions/taskplane/discovery.ts`
- `extensions/taskplane/waves.ts`
- `extensions/taskplane/formatting.ts` (if plan output includes segment visibility)
- `extensions/tests/discovery-routing.test.ts`
- `extensions/tests/waves-repo-scoped.test.ts`
- `extensions/tests/polyrepo-regression.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read current task parsing and routing flow from discovery to waves
- [ ] Identify where file-scope/repo attribution can seed segment inference
- [ ] Confirm existing parser behavior for unknown metadata blocks in `PROMPT.md`

### Step 1: Add segment contracts

- [ ] Define segment planning types (segment id, repo id, dependency edges)
- [ ] Define task-to-segment mapping contract with stable IDs (`<taskId>::<repoId>`)
- [ ] Add explicit typing for inferred vs explicit edges (for observability)

**Artifacts:**
- `extensions/taskplane/types.ts` (modified)

### Step 2: Support optional explicit segment DAG metadata

- [ ] Add parser support for optional segment DAG metadata in `PROMPT.md`
- [ ] Ensure metadata is optional and non-breaking for existing tasks
- [ ] Validate explicit edges for unknown repo IDs and obvious cycles (fail fast)

**Artifacts:**
- `extensions/taskplane/discovery.ts` (modified)
- `extensions/tests/discovery-routing.test.ts` (modified)

### Step 3: Deterministic inference fallback

- [ ] Build deterministic segment inference when explicit metadata is absent
- [ ] Use stable ordering inputs (repo touches, first appearance, task dependencies)
- [ ] Ensure one active segment per task policy is representable in planner output

**Artifacts:**
- `extensions/taskplane/waves.ts` (modified)
- `extensions/tests/waves-repo-scoped.test.ts` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Add/adjust tests for explicit segment metadata parsing
- [ ] Add/adjust tests for deterministic inference fallback
- [ ] Add/adjust regression tests for backward compatibility (no metadata)
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Update spec wording if implementation reveals syntax or validation constraints
- [ ] Log discoveries in STATUS.md
- [ ] Create `.DONE`

## Documentation Requirements

**Must Update:**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — if syntax details or examples are finalized here

**Check If Affected:**
- `docs/reference/task-format.md`
- `README.md`

## Completion Criteria

- [ ] Segment contracts exist and are typed
- [ ] Optional explicit DAG syntax is supported
- [ ] Deterministic inference fallback is implemented
- [ ] Backward compatibility for existing tasks is preserved
- [ ] All tests pass

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-080): complete Step N — description`
- **Bug fixes:** `fix(TP-080): description`
- **Tests:** `test(TP-080): description`
- **Hydration:** `hydrate: TP-080 expand Step N checkboxes`

## Do NOT

- Implement segment execution runtime yet (TP-082)
- Modify persisted state schema in this task (TP-081)
- Introduce ambiguous/non-deterministic edge inference
- Skip full-suite tests

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
