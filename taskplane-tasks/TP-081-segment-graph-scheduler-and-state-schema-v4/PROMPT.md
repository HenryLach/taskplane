# Task: TP-081 - State Schema v4 for Segment Execution

**Created:** 2026-03-28
**Size:** M

## Review Level: 3 (Full)

**Assessment:** Introduces new persisted-state contracts and migration behavior for segment execution. High correctness/recoverability impact but intentionally scoped to schema+persistence only.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 1, Security: 1, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-081-segment-graph-scheduler-and-state-schema-v4/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Implement **schema v4** persisted-state contracts for segment execution and migrations from older versions. This task is intentionally limited to `types.ts` + `persistence.ts` + tests so downstream runtime work can build on stable persistence primitives without context overload.

## Dependencies

- **Task:** TP-080 (segment model + parsing/inference contracts)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — persistence schema v4 requirements
- `extensions/taskplane/persistence.ts` — serialization/validation/version guards
- `extensions/taskplane/types.ts` — runtime and persisted contracts
- `extensions/tests/orch-state-persistence.test.ts` — migration regression coverage

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/types.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/tests/orch-state-persistence.test.ts`
- `extensions/tests/fixtures/*` (only if schema fixtures are needed)

## Steps

### Step 0: Preflight

- [ ] Read current persisted state schema/versioning and migration flow
- [ ] Define explicit v3→v4 migration strategy (fields/defaults/guards)
- [ ] Identify invariants required by resume and dashboard consumers

### Step 1: Add schema v4 contracts

- [ ] Add v4 type contracts for task-level and segment-level persisted fields
- [ ] Add/adjust runtime state contracts needed for v4 serialization
- [ ] Document optional vs required fields for migration safety

**Artifacts:**
- `extensions/taskplane/types.ts` (modified)

### Step 2: Implement persistence + migration

- [ ] Implement v4 serialize/load/validate paths
- [ ] Add compatibility for prior versions (at least v2/v3 load paths)
- [ ] Keep unsupported-version errors explicit and actionable

**Artifacts:**
- `extensions/taskplane/persistence.ts` (modified)

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Add/adjust migration fixtures and regression tests
- [ ] Verify round-trip serialization for v4 fields
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Update spec notes if implementation details differ from planned shape
- [ ] Log discoveries in STATUS.md
- [ ] Create `.DONE`

## Documentation Requirements

**Must Update:**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — if schema shape/field names changed during implementation

**Check If Affected:**
- `docs/reference/status-format.md`
- `docs/explanation/persistence-and-resume.md`

## Completion Criteria

- [ ] Schema v4 persisted state is implemented and validated
- [ ] Backward-compatible load paths are intentional and tested
- [ ] No runtime scheduler behavior changes are introduced in this task
- [ ] All tests pass

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-081): complete Step N — description`
- **Bug fixes:** `fix(TP-081): description`
- **Tests:** `test(TP-081): description`
- **Hydration:** `hydrate: TP-081 expand Step N checkboxes`

## Do NOT

- Implement scheduler/frontier logic here (moved to TP-085)
- Implement dual-context packet-path execution (TP-082)
- Modify supervisor policy behavior (TP-083/TP-086)
- Skip full-suite tests

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
