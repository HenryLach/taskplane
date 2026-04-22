# Task: TP-043 — Auto-Integration & Batch Summary

**Created:** 2026-03-21
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Extends supervisor with integration flow and summary generation. Touches git operations and PR creation. Must respect branch protection.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-043-auto-integration-batch-summary/
├── PROMPT.md   ← This file
├── STATUS.md   ← Execution state
├── .reviews/   ← Reviewer output
└── .DONE       ← Created when complete
```

## Mission

Enable the supervisor to manage the full integration lifecycle after batch
completion — syncing the orch branch with the base branch, handling conflicts,
creating PRs, waiting for CI, and merging. Also generate a structured batch
summary (retrospective) with timeline, incidents, cost breakdown, and
recommendations.

Three integration modes configured during onboarding or via settings:
- `manual` — supervisor tells operator to run `/orch-integrate` (current behavior)
- `supervised` — supervisor proposes plan, asks confirmation, then executes
- `auto` — supervisor executes integration without asking, pauses only on issues

## Dependencies

- **Task:** TP-041 (supervisor agent must be functional for interactive integration)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/watchdog-and-recovery-tiers.md` — Section 14.4 Script 9, Section 9.2
- `extensions/taskplane/extension.ts` — /orch-integrate implementation
- `extensions/taskplane/supervisor.ts` — supervisor module (from TP-041)

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** git, gh CLI (for PR creation)


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `extensions/taskplane/supervisor.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/messages.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/auto-integration.test.ts` (new)

## Steps

### Step 0: Preflight

- [ ] Read /orch-integrate implementation — understand ff, merge, PR modes
- [ ] Read spec Script 9 for the full auto-integration flow
- [ ] Read spec Section 9.2 for batch summary format
- [ ] Check how branch protection detection could work (`gh api`)

### Step 1: Supervisor-Managed Integration

- [ ] On `batch_complete` event, supervisor initiates integration based on configured mode
- [ ] Detect branch protection: attempt `gh api repos/{owner}/{repo}/branches/{branch}/protection` — if protected, default to PR mode
- [ ] `supervised` mode: describe plan, ask confirmation, then execute
- [ ] `auto` mode: execute directly, report outcome
- [ ] Integration steps: sync orch branch with base → resolve conflicts → push → create PR → wait for CI → merge → cleanup
- [ ] Handle conflicts: trivial (auto-resolve) vs complex (ask operator)
- [ ] Handle CI failure: report, suggest fixes or retry
- [ ] Add `integration.mode` to config schema: `manual | supervised | auto`

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (modified)
- `extensions/taskplane/extension.ts` (modified)
- `extensions/taskplane/types.ts` (modified)

### Step 2: Batch Summary Generation

- [ ] After integration (or on batch completion if manual mode), generate summary
- [ ] Write to `.pi/supervisor/{opId}-{batchId}-summary.md`
- [ ] Include: results (succeeded/failed/skipped), duration, cost, wave timeline
- [ ] Include: incidents and recoveries (from Tier 0 events and audit trail)
- [ ] Include: recommendations (timeout adjustments, scope observations, reviewer stats)
- [ ] Include: cost breakdown by wave (if telemetry available)
- [ ] Supervisor presents summary to operator in conversation

**Artifacts:**
- `extensions/taskplane/supervisor.ts` (modified)
- `extensions/taskplane/messages.ts` (modified — summary formatting)

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Test: batch_complete in auto mode → integration executed without asking
- [ ] Test: batch_complete in supervised mode → confirmation requested first
- [ ] Test: batch_complete in manual mode → operator told to /orch-integrate
- [ ] Test: branch protection detected → defaults to PR mode
- [ ] Test: batch summary generated with correct structure
- [ ] Test: integration conflict handling (trivial auto-resolve)
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Update `docs/reference/configuration/taskplane-settings.md` — integration mode config
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `docs/reference/configuration/taskplane-settings.md` — integration.mode

**Check If Affected:**
- `docs/reference/commands.md` — /orch-integrate behavior with supervisor

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Supervisor manages integration in supervised and auto modes
- [ ] Branch protection detected and respected
- [ ] Batch summary generated on completion
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-043): complete Step N — description`
- **Bug fixes:** `fix(TP-043): description`
- **Tests:** `test(TP-043): description`
- **Hydration:** `hydrate: TP-043 expand Step N checkboxes`

## Do NOT

- Change the core /orch-integrate implementation (reuse it)
- Push to remote without operator's integration mode being auto/supervised
- Create PRs or merge without respecting configured integration mode

---

## Amendments (Added During Execution)
