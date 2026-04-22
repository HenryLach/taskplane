# Task: TP-030 — State Schema v3 & Migration

**Created:** 2026-03-19
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Schema evolution for persisted state. Must preserve resumability across versions. Breaking change if done wrong.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-030-state-schema-v3-migration/
├── PROMPT.md ├── STATUS.md ├── .reviews/ └── .DONE
```

## Mission

Extend `.pi/batch-state.json` to schema v3 with resilience fields (retry
counters, repair history, failure classification) and diagnostics fields
(per-task exit diagnostics, batch cost). Implement migration from v1/v2 → v3
with conservative defaults. Ensure old runtimes fail gracefully on v3 state.
Ensure new runtime resumes v1/v2 states. Handle corrupt state by entering
`paused` with diagnostic.

## Dependencies

- **Task:** TP-025 (TaskExitDiagnostic type must exist)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md` — Phase 3 section 3a
- `extensions/taskplane/persistence.ts` — Current state read/write
- `extensions/taskplane/resume.ts` — Current resume logic
- `extensions/taskplane/types.ts` — Current state schema

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
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/resume.ts`
- `extensions/tests/state-migration.test.ts` (new)
- `extensions/tests/orch-state-persistence.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read current state schema (v2) in types.ts
- [ ] Read persistence.ts read/write flow
- [ ] Read resume.ts state validation
- [ ] Read roadmap Phase 3 section 3a

### Step 1: Define v3 Schema

- [ ] Add `resilience` section: `resumeForced`, `retryCountByScope`, `lastFailureClass`, `repairHistory[]`
- [ ] Add `diagnostics` section: `taskExits` (per-task classification + cost), `batchCost`
- [ ] Promote `exitDiagnostic` as canonical alongside legacy `exitReason` in task records
- [ ] Preserve all existing v2 fields unchanged
- [ ] Unknown fields: preserve on read/write roundtrip (no stripping)

**Artifacts:**
- `extensions/taskplane/types.ts` (modified)

### Step 2: Implement Migration

- [ ] Auto-detect schema version on read (v1/v2/v3)
- [ ] v1/v2 → v3: default missing resilience fields conservatively (retryCount=0, no diagnostics, no repair history)
- [ ] v3 read: validate required fields, use defaults for optional
- [ ] Corrupt/unparseable state: enter `paused` phase with diagnostic message, never auto-delete
- [ ] Old runtime reading v3: write explicit version mismatch error with upgrade guidance

**Artifacts:**
- `extensions/taskplane/persistence.ts` (modified)
- `extensions/taskplane/resume.ts` (modified)

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: v1 state migrates to v3 with correct defaults
- [ ] Test: v2 state migrates to v3 preserving all existing fields
- [ ] Test: v3 state reads cleanly
- [ ] Test: unknown fields preserved through read/write roundtrip
- [ ] Test: corrupt state enters paused with diagnostic
- [ ] Test: existing persistence tests still pass
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Document v3 schema in inline JSDoc
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (internal schema, not user-facing config)

**Check If Affected:**
- `docs/reference/configuration/task-orchestrator.yaml.md` — if schema version mentioned

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] v1/v2 states resume correctly on new runtime
- [ ] v3 state preserves resilience + diagnostics fields
- [ ] Corrupt state handled safely
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-030): complete Step N — description`
- **Bug fixes:** `fix(TP-030): description`
- **Tests:** `test(TP-030): description`
- **Hydration:** `hydrate: TP-030 expand Step N checkboxes`

## Do NOT

- Delete or restructure existing v2 fields
- Auto-delete corrupt state files
- Change the batch-state.json file path or location

---

## Amendments (Added During Execution)
