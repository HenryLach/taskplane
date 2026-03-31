# Task: TP-112 - Runtime V2 Resume and Monitor De-TMUX Parity

**Created:** 2026-03-31
**Size:** L

## Review Level: 3 (Full)

**Assessment:** This is the remaining Runtime V2 correctness cut: remove TMUX dependence from resume/monitor critical paths so Runtime V2 can be honestly operated as process/registry-owned for execution correctness.
**Score:** 7/8 — Blast radius: 3, Pattern novelty: 2, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-112-runtime-v2-resume-and-monitor-detmux/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Complete the Runtime V2 de-TMUX migration for **resume and monitoring** paths.

After TP-108/109 remediation, merge-host liveness is backend-aware, but resumed execution and per-wave monitoring still rely on TMUX session checks and TMUX lane spawn/poll flows in key paths.

TP-112 must ensure Runtime V2 execution correctness does not depend on TMUX for:

- resumed lane/task continuation and re-execution behavior
- lane liveness/progress monitoring and terminal outcome detection

## Dependencies

- **Task:** TP-108 (batch + merge Runtime V2 migration)
- **Task:** TP-109 (workspace packet-path/resume follow-up)
- **Task:** TP-104 (process registry and normalized runtime events)
- **Task:** TP-105 (lane-runner Runtime V2 foundation)

## Explicit Non-Goals

- Do not remove TMUX from legacy backend paths in this task
- Do not scope-creep into conversation fidelity work (TP-111)
- Do not claim full product-wide TMUX removal outside Runtime V2 correctness paths

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/framework/taskplane-runtime-v2/02-runtime-process-model.md`
- `docs/specifications/framework/taskplane-runtime-v2/06-migration-and-rollout.md`
- `extensions/taskplane/execution.ts` (`monitorLanes`, `resolveTaskMonitorState`)
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/lane-runner.ts`
- `extensions/taskplane/process-registry.ts`
- `extensions/taskplane/engine.ts`

## Environment

- **Workspace:** `extensions/taskplane/`, `docs/`
- **Services required:** None

## File Scope

- `extensions/taskplane/resume.ts`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/engine.ts` (only if wiring adjustments are required)
- `extensions/taskplane/process-registry.ts` (if liveness helper additions are needed)
- `extensions/taskplane/types.ts` (only additive type changes)
- `extensions/tests/*resume*.test.ts`
- `extensions/tests/*routing*.test.ts`
- `extensions/tests/*merge*.test.ts` (only if merge-monitor interactions are touched)

## Steps

### Step 0: Preflight mapping

- [ ] Enumerate every TMUX dependency in Runtime V2 execution/resume/monitor paths
- [ ] Categorize each as: legacy-only (keep) vs V2-critical (replace)
- [ ] Record a before/after contract in STATUS.md

### Step 1: Resume path de-TMUX for V2

- [ ] Replace V2 reconnect/re-exec logic that depends on `tmuxHasSession`/`spawnLaneSession`/`pollUntilTaskComplete`
- [ ] Ensure resumed V2 tasks use lane-runner/agent-host/process-registry-owned semantics
- [ ] Preserve legacy behavior when backend is explicitly legacy

### Step 2: Monitor path de-TMUX for V2

- [ ] Make `monitorLanes` / `resolveTaskMonitorState` backend-aware
- [ ] For V2 lanes, determine liveness/progress from registry/snapshots/events (not TMUX session presence)
- [ ] Preserve existing monitoring semantics and status transitions (`running`/`stalled`/`failed`/`succeeded`)

### Step 3: Recovery and policy parity

- [ ] Ensure stop-wave/skip-dependents/stop-all policies remain behaviorally consistent on V2 path
- [ ] Keep retry/escalation semantics and persistence checkpoints equivalent
- [ ] Validate pause/abort/resume interactions after de-TMUX changes

### Step 4: Testing & verification

- [ ] Add behavioral tests proving V2 resume/monitor correctness with no TMUX liveness dependency
- [ ] Add negative/regression tests for delayed event/snapshot timing and interrupted resume cases
- [ ] Run targeted tests
- [ ] Run full suite
- [ ] Fix all failures

### Step 5: Documentation & delivery

- [ ] Update Runtime V2 rollout/process docs to match actual implementation
- [ ] Log discoveries, tradeoffs, and remaining TMUX legacy boundaries in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/specifications/framework/taskplane-runtime-v2/06-migration-and-rollout.md`
- `docs/specifications/framework/taskplane-runtime-v2/02-runtime-process-model.md`

**Check If Affected:**
- `docs/explanation/architecture.md`
- `docs/reference/commands.md`

## Completion Criteria

- [ ] Runtime V2 resume flow no longer relies on TMUX session checks for correctness
- [ ] Runtime V2 lane monitoring/liveness no longer relies on TMUX session checks for correctness
- [ ] Legacy backend still works as fallback where expected
- [ ] Full suite passes
- [ ] TP-112 status/docs accurately describe what TMUX dependencies remain (if any)

## Git Commit Convention

- `feat(TP-112): complete Step N — ...`
- `fix(TP-112): ...`
- `test(TP-112): ...`
- `hydrate: TP-112 expand Step N checkboxes`

## Do NOT

- Rewire legacy TMUX backend behavior without explicit reason
- Convert source-shape assertions into false confidence; prefer behavioral tests
- Declare “TMUX removed” globally unless legacy paths are also retired

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
