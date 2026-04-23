# Task: TP-145 - Multi-Segment .DONE Timing and Expansion Edge Validation Fix

**Created:** 2026-04-07
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Two critical fixes in the segment execution path. High blast radius — touches lane-runner .DONE creation and engine expansion validation. Must not regress existing single-repo or static multi-repo behavior.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-145-multi-segment-done-and-expansion-edge-fix/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Fix two critical bugs discovered during polyrepo e2e testing:

### Bug 1: .DONE created after first segment short-circuits remaining segments (#457)

In a multi-segment task (e.g., TP-006 with segments shared-libs → api-service → web-client), the worker writes `.DONE` after the first segment completes because it sees all STATUS.md steps as checked. When the engine later provisions the third segment (wave 5), it sees `.DONE` already exists and marks the task succeeded in 3ms without executing. The web-client deliverable is never created.

**Fix:** `.DONE` must not exist until ALL segments of a multi-segment task are complete. Options:
- **(A) Lane-runner suppresses .DONE:** When the task has more pending segments, lane-runner does not create `.DONE` even if the worker signals completion. Requires lane-runner to know the segment plan.
- **(B) Engine ignores .DONE for tasks with pending segments:** Monitor checks `.DONE` but engine only marks task succeeded when all segments are terminal. Requires engine to override the .DONE signal.
- **(C) Worker doesn't mark all steps complete:** Inform the worker that only segment-scoped steps should be checked, deferring downstream steps. Fragile — depends on worker discipline.

**Recommended: Option A** — lane-runner has access to segment context and can gate `.DONE` creation.

### Bug 2: Expansion edge validation rejects anchor-repo references (#452 follow-up)

Workers file expansion requests with edges like `{ from: "shared-libs", to: "web-client" }` where `from` is the current segment's repo (not a new repo). Validation rejects because `from` is not in `requestedRepoIds`.

**Fix:** In `validateSegmentExpansionRequestAtBoundary`, allow edge endpoints that reference the anchor segment's repo ID. The edge is redundant (after-current placement already implies that dependency) — accept it silently or strip it before graph mutation.

## Environment

- **Workspace:** `extensions/taskplane/`, `dashboard/`, `bin/`
- **Services required:** None
- **Submodule workspace:** `.pi/git/github.com/loopyd/taskplane` (absolute: `/mnt/PROJECTS/repos/bof3-decomp/.pi/git/github.com/loopyd/taskplane`)


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## Dependencies

- None

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `extensions/taskplane/lane-runner.ts` — .DONE creation logic, segment context
- `extensions/taskplane/engine.ts` — monitor .DONE check, segment frontier, `validateSegmentExpansionRequestAtBoundary`
- `extensions/taskplane/types.ts` — ExecutionUnit, segment fields
- `docs/specifications/taskplane/dynamic-segment-expansion.md` — edge validation spec

## File Scope

- `extensions/taskplane/lane-runner.ts`
- `extensions/taskplane/engine.ts`
- `extensions/tests/lane-runner-v2.test.ts`
- `extensions/tests/segment-expansion-engine.test.ts`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read lane-runner.ts .DONE creation path
- [ ] Read engine.ts monitor .DONE check and segment frontier advancement
- [ ] Read validateSegmentExpansionRequestAtBoundary edge validation
- [ ] Understand how lane-runner knows about segment context (ExecutionUnit fields)

### Step 1: Fix .DONE timing for multi-segment tasks
- [ ] Determine how lane-runner knows if more segments remain (check ExecutionUnit or env vars)
- [ ] Gate .DONE creation: if task has more pending segments, do NOT write .DONE
- [ ] Ensure .DONE IS written when the LAST segment completes
- [ ] Ensure single-segment tasks (repo mode, single-repo workspace) are unaffected
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/lane-runner.ts` (modified)
- `extensions/taskplane/engine.ts` (modified if needed for segment context propagation)

### Step 2: Fix expansion edge validation
- [ ] In `validateSegmentExpansionRequestAtBoundary`, allow edge `from` to be the anchor segment's repo ID
- [ ] Also allow edge `from` to be any already-completed segment's repo ID (not just requestedRepoIds)
- [ ] Strip redundant edges (from anchor to new repo when placement is after-current) before passing to mutation
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)
- `extensions/tests/segment-expansion-engine.test.ts` (modified)

### Step 3: Testing & Verification

> ZERO test failures allowed. Full suite quality gate.

- [ ] Test: 3-segment task — .DONE not created after segment 1 or 2, created after segment 3
- [ ] Test: single-segment task — .DONE created normally (no regression)
- [ ] Test: expansion with edge from anchor repo — accepted, not rejected
- [ ] Test: expansion with edge between two new repos — accepted (existing behavior)
- [ ] Test: expansion with edge to unknown repo — still rejected
- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 4: Documentation & Delivery
- [ ] Update dynamic-segment-expansion.md if edge validation rules changed
- [ ] Update STATUS.md

## Git Commit Convention

- `feat(TP-145): complete Step N — description`

## Do NOT

- Break single-repo .DONE behavior
- Remove the expansion edge validation entirely (it should still reject truly invalid edges)
- Change the .DONE file format or location

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
