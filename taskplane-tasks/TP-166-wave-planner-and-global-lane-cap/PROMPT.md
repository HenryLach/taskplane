# Task: TP-166 - Wave Planner Excessive Waves and Global Lane Cap

**Created:** 2026-04-12
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Wave planner and lane allocation are core scheduling correctness — incorrect waves confuse operators and incorrect lane caps waste resources or cause contention.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-166-wave-planner-and-global-lane-cap/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Fix two wave planner issues: (1) the planner creates excessive phantom waves for small task graphs (#454) — e.g., 6 waves for an 8-task graph that should produce 3 — and (2) `maxLanes` is enforced per-repo in workspace mode instead of globally (#451), so with maxLanes=4 across 3 repos the actual lane count can reach 12. `enforceGlobalLaneCap` exists but may not be wired correctly.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/explanation/architecture.md` — wave scheduling overview

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/waves.ts`
- `extensions/taskplane/engine.ts`
- `extensions/tests/waves*.test.ts`
- `extensions/tests/workspace*.test.ts`

## Steps

### Step 0: Preflight and Analysis

- [ ] Read waves.ts wave planning logic — how waves are generated for multi-segment tasks
- [ ] Reproduce the excessive-waves scenario: 8 tasks, 3 dependency levels → should be 3 waves
- [ ] Read `enforceGlobalLaneCap` (waves.ts line ~998) and trace where it's called
- [ ] Identify why phantom waves are generated (segment expansion placeholders?)
- [ ] Identify where per-repo maxLanes is applied vs global cap
- [ ] Document findings in STATUS.md

### Step 1: Fix Excessive Wave Generation

- [ ] Eliminate phantom/duplicate waves in the wave planner output
- [ ] Ensure wave count matches the actual dependency graph depth
- [ ] Handle segment continuations without inflating wave count
- [ ] Run targeted tests: `tests/waves*.test.ts`

**Artifacts:**
- `extensions/taskplane/waves.ts` (modified)

### Step 2: Fix Global Lane Cap Enforcement

- [ ] Ensure `enforceGlobalLaneCap` is called in the workspace execution path
- [ ] Verify the cap is applied as a global maximum, not per-repo
- [ ] If `enforceGlobalLaneCap` is already called, find why it's not effective
- [ ] Add test: workspace with 3 repos, maxLanes=4 → total lanes ≤ 4

**Artifacts:**
- `extensions/taskplane/waves.ts` (modified)
- `extensions/taskplane/engine.ts` (modified if cap wiring is here)

### Step 3: Testing & Verification

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures
- [ ] Add regression test: 8-task graph with 3 dep levels → exactly 3 waves
- [ ] Add regression test: workspace maxLanes global enforcement

### Step 4: Documentation & Delivery

- [ ] Update `docs/how-to/configure-task-orchestrator.md` if maxLanes behavior changes
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/how-to/configure-task-orchestrator.md` — clarify maxLanes is global, not per-repo

**Check If Affected:**
- `docs/explanation/architecture.md` — wave planning description

## Completion Criteria

- [ ] All steps complete
- [ ] Wave count matches dependency graph depth (no phantom waves)
- [ ] maxLanes enforced globally in workspace mode
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `fix(TP-166): complete Step N — description`
- **Bug fixes:** `fix(TP-166): description`
- **Tests:** `test(TP-166): description`
- **Hydration:** `hydrate: TP-166 expand Step N checkboxes`

## Do NOT

- Change single-repo wave planning behavior
- Modify dependency resolution logic (that's discovery.ts, not waves.ts)
- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

