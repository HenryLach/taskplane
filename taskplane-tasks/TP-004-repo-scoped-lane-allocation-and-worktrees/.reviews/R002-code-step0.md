# R002 — Code Review (Step 0: Refactor lane allocation model)

## Verdict
**Changes requested**

## Scope reviewed
- `extensions/taskplane/waves.ts`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/resume.ts`
- Neighbor consistency checks:
  - `extensions/taskplane/extension.ts`
  - `extensions/taskplane/abort.ts`
  - `extensions/taskplane/engine.ts`

## Findings

### 1) `/orch-plan` still uses non-repo-scoped lane assignment (behavior drift)
**Severity:** High

`allocateLanes()` was correctly refactored to repo-grouped allocation, but `computeWaveAssignments()` (used by `/orch-plan`) still assigns lanes with the old single-pass call:

- `extensions/taskplane/waves.ts:1024` (`assignTasksToLanes(waveTasks, ...)`)

This means plan output can diverge from runtime allocation in workspace mode (lane count/order/parallelism estimate), which hurts operator visibility and determinism.

**Suggested fix:** Reuse the same repo-grouping + global lane numbering model in `computeWaveAssignments()` (or extract shared allocation logic so plan/runtime cannot drift).

---

### 2) `LaneAssignment.repoId` was added but never populated
**Severity:** Medium

`LaneAssignment` now includes optional `repoId` in `types.ts`, but assignment objects are still created without it:

- `extensions/taskplane/waves.ts:561`

As implemented, `repoId` is always `undefined` in `WaveAssignment.tasks`, so the contract extension is incomplete for planning/reporting paths.

**Suggested fix:** Populate `repoId` at assignment creation (`task.resolvedRepoId`), or remove/defer this field until consumers are wired.

---

### 3) Missing tests for the new repo-grouped allocation behavior
**Severity:** High

No test files were updated in this step, despite substantial behavior changes in lane allocation semantics.

At minimum, add targeted tests for:
- deterministic `groupTasksByRepo()` ordering
- per-repo `max_lanes` budgeting
- global lane number sequencing across repo groups
- repo-aware `laneId`/`tmuxSessionName` formatting
- repo-mode backward compatibility (`lane-{N}`, `{prefix}-lane-{N}`)

Without these, regressions in core scheduling behavior are likely.

---

## Notes (neighbor consistency risk)
- `extensions/taskplane/abort.ts:42` currently filters only `suffix.startsWith("lane-")`; repo-aware sessions like `orch-api-lane-1` will not match.
- `extensions/taskplane/engine.ts:559` parses lane number from session name (`/lane-(\d+)/`), which becomes lane-local in workspace mode.

These may be intentionally deferred to later steps, but they should be tracked explicitly as follow-up compatibility work.
