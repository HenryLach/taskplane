# Task: TP-033 — Transactional Merge Envelope & Retry Matrix

**Created:** 2026-03-19
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** Adds rollback semantics to merge flow. Persists retry counters. Must not corrupt merge state. High reversibility risk.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 3 (capped)

## Canonical Task Folder

```
taskplane-tasks/TP-033-transactional-merge-and-retry/
├── PROMPT.md ├── STATUS.md ├── .reviews/ └── .DONE
```

## Mission

Wrap each lane merge in a transactional envelope: capture pre/post refs, run
verification, rollback on failure, safe-stop if rollback fails. Implement the
retry policy matrix with persisted counters scoped by `(repoId, wave, lane)`.
Add wave gate: `cleanup_post_merge_failed` blocks next wave.

## Dependencies

- **Task:** TP-030 (v3 state schema for retry counters and repair history)
- **Task:** TP-032 (verification baseline for post-merge comparison)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md` — Phase 4 sections 4b, 4c
- `extensions/taskplane/merge.ts` — Current merge flow
- `extensions/taskplane/engine.ts` — Wave lifecycle
- `extensions/taskplane/types.ts` — v3 state schema

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/merge.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/transactional-merge.test.ts` (new)
- `extensions/tests/retry-matrix.test.ts` (new)

## Steps

### Step 0: Preflight

- [ ] Read merge flow end-to-end (engine → merge.ts)
- [ ] Read v3 state schema retry fields
- [ ] Read roadmap Phase 4 sections 4b, 4c

### Step 1: Transaction Envelope

- [ ] Before merge: capture `baseHEAD` and `laneHEAD` refs
- [ ] After merge: capture `mergedHEAD`
- [ ] If verification passes: finalize (update-ref, continue)
- [ ] If verification fails: rollback to `baseHEAD` via `git reset --hard` in merge worktree
- [ ] If rollback fails: safe-stop — force `paused`, preserve all branches/worktrees, emit exact recovery commands
- [ ] Persist transaction record: `.pi/verification/{opId}/txn-b{batchId}-repo-{repoId}-wave-{n}-lane-{k}.json`

**Artifacts:**
- `extensions/taskplane/merge.ts` (modified)

### Step 2: Retry Policy Matrix

- [ ] Implement retry logic keyed by failure classification
- [ ] Persist retry counters in v3 state: `resilience.retryCountByScope` keyed by `{repoId}:w{N}:l{K}`
- [ ] Enforce max attempts per classification (see roadmap table)
- [ ] Enforce cooldown delays between retries
- [ ] On exhaustion: enter `paused` with diagnostic
- [ ] Retries must be idempotent-aware (no duplicate destructive ops)

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)
- `extensions/taskplane/persistence.ts` (modified)
- `extensions/taskplane/types.ts` (modified if adding classifications)

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: successful merge captures pre/post refs in transaction record
- [ ] Test: verification failure triggers rollback to baseHEAD
- [ ] Test: rollback failure enters safe-stop with preserved state
- [ ] Test: retry counter persists and increments correctly
- [ ] Test: max attempts exhaustion enters paused
- [ ] Test: cooldown delay enforced between retries
- [ ] Test: retry counters scoped by repoId in workspace mode
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Document retry policy in `docs/reference/configuration/task-orchestrator.yaml.md`
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `docs/reference/configuration/task-orchestrator.yaml.md` — retry config section

**Check If Affected:**
- `docs/reference/commands.md` — if merge output changes

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Merge failures rollback cleanly
- [ ] Retry matrix enforced with persisted counters
- [ ] Safe-stop preserves all state when rollback fails
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-033): complete Step N — description`
- **Bug fixes:** `fix(TP-033): description`
- **Tests:** `test(TP-033): description`
- **Hydration:** `hydrate: TP-033 expand Step N checkboxes`

## Do NOT

- Delete merged commits during rollback (only reset merge worktree, not orch branch)
- Silently skip tasks during retry
- Allow retries without retry counter persistence

---

## Amendments (Added During Execution)
