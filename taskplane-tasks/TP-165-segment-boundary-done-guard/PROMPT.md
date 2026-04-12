# Task: TP-165 - Segment Boundary .DONE Guard and Expansion Consumption

**Created:** 2026-04-12
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** High-risk changes to engine segment lifecycle — .DONE authority and expansion consumption are core orchestrator correctness invariants. Multiple services affected (engine, worker, persistence).
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-165-segment-boundary-done-guard/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Fix two related segment lifecycle bugs: (1) `.DONE` is created after the first segment completes, which short-circuits remaining segments (#457), and (2) the engine does not consume segment expansion requests at segment boundaries (#452). Both bugs break multi-segment polyrepo task execution — segments after the first are either skipped or never expanded.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/explanation/architecture.md` — orchestrator architecture overview
- `docs/reference/status-format.md` — STATUS.md conventions

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/engine.ts`
- `extensions/taskplane/task-executor-core.ts`
- `extensions/taskplane/lane-runner.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/engine*.test.ts`
- `extensions/tests/segment*.test.ts`

## Steps

### Step 0: Preflight and Root Cause Analysis

- [ ] Read engine.ts segment lifecycle: how `.DONE` is created after task completion
- [ ] Read task-executor-core.ts / lane-runner.ts: where `.DONE` is written
- [ ] Read engine.ts `processSegmentExpansionRequestAtBoundary` (line ~381) and its call site (line ~2606)
- [ ] Identify the exact condition that causes `.DONE` after first segment
- [ ] Identify why expansion requests are not consumed at segment boundaries
- [ ] Document findings in STATUS.md

### Step 1: Fix Premature .DONE Creation

- [ ] Ensure `.DONE` is only created when ALL segments for a task are complete, not after each segment
- [ ] Add segment-awareness to the `.DONE` creation path — check if remaining segments exist before writing
- [ ] Verify the existing premature-.DONE removal code (engine.ts line ~2666) is correct as a safety net
- [ ] Run targeted tests: segment and engine tests

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)
- `extensions/taskplane/task-executor-core.ts` or `extensions/taskplane/lane-runner.ts` (modified — whichever creates .DONE)

### Step 2: Fix Segment Expansion Consumption

- [ ] Trace the `processSegmentExpansionRequestAtBoundary` call path to find why requests are orphaned
- [ ] Fix the gating condition that prevents consumption at segment boundaries
- [ ] Ensure consumed requests are renamed to `.processed` (not left orphaned in outbox)
- [ ] Add or fix test coverage for expansion request consumption
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)

### Step 3: Testing & Verification

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures
- [ ] Add regression tests: multi-segment task where first segment completes — verify .DONE not created until all segments done
- [ ] Add regression test: expansion request filed by worker — verify engine consumes it at boundary

### Step 4: Documentation & Delivery

- [ ] Update docs if segment lifecycle behavior is documented
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- None expected (internal engine behavior)

**Check If Affected:**
- `docs/explanation/architecture.md` — if segment lifecycle is described

## Completion Criteria

- [ ] All steps complete
- [ ] Multi-segment tasks no longer short-circuit after first segment
- [ ] Segment expansion requests are consumed at boundaries
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `fix(TP-165): complete Step N — description`
- **Bug fixes:** `fix(TP-165): description`
- **Tests:** `test(TP-165): description`
- **Hydration:** `hydrate: TP-165 expand Step N checkboxes`

## Do NOT

- Change single-segment task behavior — .DONE must still work for simple tasks
- Modify the expansion request format or mailbox protocol
- Expand task scope — add tech debt to CONTEXT.md instead
- Skip tests
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

