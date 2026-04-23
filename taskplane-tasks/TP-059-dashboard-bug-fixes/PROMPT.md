# Task: TP-059 - Dashboard Bug Fixes

**Created:** 2026-03-25
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Three small, isolated fixes in dashboard and formatting code. No new patterns, no security, easily reversible.
**Score:** 1/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-059-dashboard-bug-fixes/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Fix three small dashboard/formatting bugs discovered during the v0.12.0–v0.14.0 development cycle:

1. **#201 — Merge message says "into develop"** — `formatting.ts:687` has a hardcoded "develop" string. Should display the actual orch branch name.
2. **#202 — Merge agents section empty during merge** — `app.js:631` filters for `orch-merge` prefix but actual session names include the operator ID (e.g., `orch-henrylach-merge-1`). The filter and telemetry lookups need to match the actual naming pattern.
3. **#193 — Two pre-existing test failures in supervisor-merge-monitoring.test.ts** — Tests 9.3 and 10.5 fail on main. These are source-based tests that drifted from implementation during the TP-056 merge.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `extensions/taskplane/formatting.ts` — line 687, merge phase display message
- `dashboard/public/app.js` — line 631+, merge agent session filtering and telemetry lookup
- `extensions/tests/supervisor-merge-monitoring.test.ts` — failing tests 9.3 and 10.5

## Environment

- **Workspace:** `extensions/`, `dashboard/`
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/formatting.ts`
- `dashboard/public/app.js`
- `extensions/tests/supervisor-merge-monitoring.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read `formatting.ts:687` — find the hardcoded "develop" string
- [ ] Read `app.js:631` — understand the merge session filter and telemetry lookups (lines 631, 657, 661, 721)
- [ ] Run the two failing tests to confirm they fail: `cd extensions && npx vitest run tests/supervisor-merge-monitoring.test.ts`

### Step 1: Fix Merge Message (#201)

The merge phase message at `formatting.ts:687` says:
```
🔀 Merging lane branches into develop...
```

Fix: Replace the hardcoded "develop" with the actual orch branch name. The orch branch is available in the batch state. Check how `formatting.ts` receives its data — the function may need an additional parameter for the orch branch name, or it may already have access to it via the batch state.

**Artifacts:**
- `extensions/taskplane/formatting.ts` (modified)

### Step 2: Fix Merge Agents Section (#202)

The dashboard's merge agent section in `app.js` has multiple places that assume `orch-merge` prefix without the operator ID:

1. **Line 631:** `s.startsWith("orch-merge")` — should match `orch-{operatorId}-merge-{N}` pattern. Use `s.includes("-merge-")` or derive the prefix from batch state lane names.
2. **Line 657:** `orch-merge-w${mr.waveIndex + 1}` — hardcoded session name pattern for merge results lookup. Needs to match actual naming.
3. **Line 661:** `orch-merge-${mr.waveIndex + 1}` — telemetry key fallback. Same issue.
4. **Line 721:** Similar pattern for checking already-shown merge sessions.

Fix all four locations to match the actual merge session naming convention. Look at how lane session names are structured in the batch state (e.g., `orch-henrylach-lane-1`) and derive the merge session prefix from that pattern (replace `lane` with `merge`).

**Artifacts:**
- `dashboard/public/app.js` (modified)

### Step 3: Fix Test Failures (#193)

Two source-based tests in `supervisor-merge-monitoring.test.ts` fail:

1. **Test 9.3:** `_emitHealthEvents source emits stuck event only when stuckEmitted is false`
2. **Test 10.5:** `waitForMergeResult early exit path — monitor signals dead session before timeout`

These are source extraction tests that check for specific patterns in the implementation. Read each failing test, understand what pattern it's looking for, then check the actual source to find the drift. Fix the tests to match the current implementation (the implementation is correct — the tests are stale).

**Artifacts:**
- `extensions/tests/supervisor-merge-monitoring.test.ts` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Run `cd extensions && npx vitest run tests/supervisor-merge-monitoring.test.ts` — both previously failing tests now pass
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Build passes: `node bin/taskplane.mjs help`

### Step 5: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- None (these are bug fixes, not behavior changes)

**Check If Affected:**
- None

## Completion Criteria

- [ ] Merge message shows actual orch branch name, not "develop"
- [ ] Dashboard merge agents section shows active merge sessions
- [ ] All supervisor-merge-monitoring tests pass (0 failures)
- [ ] All other tests still pass
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `fix(TP-059): complete Step N — description`
- **Bug fixes:** `fix(TP-059): description`
- **Hydration:** `hydrate: TP-059 expand Step N checkboxes`

## Do NOT

- Change merge agent behavior — only fix display/filtering/tests
- Refactor the merge session naming convention — just make the dashboard match what exists
- Modify the merge health monitor logic — only fix the stale tests

---

## Amendments (Added During Execution)

