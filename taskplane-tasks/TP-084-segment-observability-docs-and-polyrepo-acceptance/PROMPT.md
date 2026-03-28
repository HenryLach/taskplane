# Task: TP-084 - Segment Observability, Docs, and Polyrepo Acceptance

**Created:** 2026-03-28
**Size:** M

## Review Level: 1 (Plan Only)

**Assessment:** Primarily observability/docs/test-hardening on top of prior runtime changes. Moderate coordination, low algorithmic novelty.
**Score:** 3/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-084-segment-observability-docs-and-polyrepo-acceptance/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Complete the first implementation tranche for #51 by shipping segment-aware observability, updating user-facing documentation, and running polyrepo acceptance validation. This task should leave operators with clear visibility and trustworthy runbooks for segment-based execution.

## Dependencies

- **Task:** TP-087 (dynamic segment expansion graph mutation + resume)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — dashboard/acceptance criteria
- `docs/specifications/taskplane/autonomous-supervisor.md` — supervisor behavior references
- `dashboard/server.cjs` and `dashboard/public/*` — current dashboard data model and UI
- `extensions/taskplane/formatting.ts` and widget rendering helpers

## Environment

- **Workspace:** `dashboard/`, `extensions/taskplane/`, `docs/`
- **Services required:** None

## File Scope

- `dashboard/server.cjs`
- `dashboard/public/*`
- `extensions/taskplane/formatting.ts`
- `extensions/taskplane/extension.ts` (if dashboard payload wiring changes)
- `docs/reference/commands.md`
- `docs/explanation/architecture.md`
- `docs/specifications/taskplane/multi-repo-task-execution.md`
- `extensions/tests/polyrepo-regression.test.ts`
- `extensions/tests/orch-direct-implementation.test.ts`

## Steps

### Step 0: Preflight

- [ ] Review current dashboard model and identify missing segment-level visibility
- [ ] Map acceptance criteria from spec to concrete test scenarios
- [ ] Confirm prior tasks exposed all required runtime fields

### Step 1: Segment observability in dashboard/status surfaces

- [ ] Add packet-home repo visibility for each task/segment
- [ ] Add active segment per lane and segment status transitions
- [ ] Add supervisor intervention/reorder visibility where available

**Artifacts:**
- `dashboard/server.cjs` (modified)
- `dashboard/public/*` (modified)
- `extensions/taskplane/formatting.ts` (modified, if needed)

### Step 2: Documentation alignment

- [ ] Update command/architecture docs to explain segment-based execution model
- [ ] Update spec implementation status + any finalized syntax/behavior notes
- [ ] Ensure docs clearly state segment bundles are deferred post-v1

**Artifacts:**
- `docs/reference/commands.md` (modified)
- `docs/explanation/architecture.md` (modified)
- `docs/specifications/taskplane/multi-repo-task-execution.md` (modified)

### Step 3: Polyrepo acceptance validation

- [ ] Execute polyrepo smoke/acceptance scenarios for segment model
- [ ] Verify no false `.DONE` failures and no packet-path resolution regressions
- [ ] Validate forced interruption + resume at segment level
- [ ] Validate dynamic segment expansion scenario; if behavior is incomplete, document exact gap and stage follow-up task(s) without silent pass

**Artifacts:**
- `extensions/tests/polyrepo-regression.test.ts` (modified)
- `taskplane-tasks/CONTEXT.md` (modified only if follow-up debt/tasks are logged)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Run CLI smoke checks: `node bin/taskplane.mjs help` and `node bin/taskplane.mjs doctor`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Log discoveries in STATUS.md
- [ ] Record acceptance outcomes clearly (pass/fail + evidence)
- [ ] Create `.DONE`

## Documentation Requirements

**Must Update:**
- `docs/reference/commands.md`
- `docs/explanation/architecture.md`

**Check If Affected:**
- `README.md`
- `docs/reference/configuration/taskplane-settings.md`

## Completion Criteria

- [ ] Segment-level visibility is available in operator surfaces
- [ ] Docs are consistent with implemented segment model behavior
- [ ] Polyrepo acceptance scenarios are executed with evidence
- [ ] Any deferred/incomplete acceptance item is explicitly tracked as a follow-up task
- [ ] All tests pass

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-084): complete Step N — description`
- **Bug fixes:** `fix(TP-084): description`
- **Tests:** `test(TP-084): description`
- **Hydration:** `hydrate: TP-084 expand Step N checkboxes`

## Do NOT

- Add segment-bundle runtime support in this task
- Mark acceptance as passed without concrete evidence
- Hide incomplete behavior in docs wording
- Skip full-suite tests

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
