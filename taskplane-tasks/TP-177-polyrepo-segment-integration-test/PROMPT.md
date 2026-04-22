# Task: TP-177 - Polyrepo Segment Integration Test

**Created:** 2026-04-12
**Size:** M

## Review Level: 0 (None)

**Assessment:** Test-only task. No production code changes. Validates Phase A works end-to-end.
**Score:** 0/8 — Blast radius: 0, Pattern novelty: 0, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-177-polyrepo-segment-integration-test/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Validate Phase A segment-aware steps end-to-end using the polyrepo test workspace (`C:\dev\tp-test-workspace`). Update the test workspace task PROMPT.md files to include `#### Segment: <repoId>` markers, then run the full 6-task batch and verify workers complete without supervisor intervention.

This is the acceptance test for the Phase A specification.

## Dependencies

- **Task:** TP-173 (discovery parsing must be implemented)
- **Task:** TP-174 (lane-runner segment scoping must be implemented)
- **Task:** TP-175 (worker prompt must include multi-segment rules)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/segment-aware-steps.md` — Phase A definition of done (section A.11)

## Environment

- **Workspace:** `C:\dev\tp-test-workspace\` (polyrepo test workspace)
- **Services required:** None


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

## File Scope

- `C:\dev\tp-test-workspace\shared-libs\task-management\platform\general\TP-*/PROMPT.md`
- `C:\dev\tp-test-workspace\.reset-snapshots\general\TP-*/STATUS.md`

## Steps

### Step 0: Preflight

- [ ] Verify test workspace exists and is clean (all tasks reset via .reset-snapshots)
- [ ] Verify all 3 repos (shared-libs, api-service, web-client) are on initial state
- [ ] Identify which tasks are multi-segment (TP-004, TP-005, TP-006)

### Step 1: Add Segment Markers to Test Tasks

- [ ] Update TP-004 PROMPT.md: add `#### Segment: shared-libs` and `#### Segment: web-client` markers to appropriate steps
- [ ] Update TP-005 PROMPT.md: add `#### Segment: shared-libs` and `#### Segment: api-service` markers
- [ ] Update TP-006 PROMPT.md: add `#### Segment:` markers for all repos it touches
- [ ] Update corresponding STATUS.md files in .reset-snapshots with matching segment structure
- [ ] Verify single-segment tasks (TP-001, TP-002, TP-003) have no markers (unchanged)
- [ ] Commit changes to shared-libs develop branch

### Step 2: Run Polyrepo Batch

- [ ] Reset test workspace using .reset-snapshots
- [ ] Run `/orch all` from the workspace root
- [ ] Monitor execution: workers should only see their segment's checkboxes
- [ ] Verify: no supervisor steering needed for multi-segment tasks
- [ ] Verify: all 6 tasks succeed
- [ ] Verify: TP-004 shared-libs segment completes without trying web-client work
- [ ] Verify: TP-005 shared-libs segment completes without trying api-service work

### Step 3: Validate Results

- [ ] All 6 .DONE files exist
- [ ] STATUS.md files show segment-scoped progress (not cross-repo confusion)
- [ ] No supervisor recovery actions in actions.jsonl for segment-related issues
- [ ] Worker iteration counts are reasonable (1-2 per segment, not 5+ from confusion loops)
- [ ] Run `/orch-integrate` successfully

### Step 4: Documentation & Delivery

- [ ] Document test results in STATUS.md
- [ ] Reset test workspace to clean state for future runs

## Documentation Requirements

**Must Update:**
- None

**Check If Affected:**
- None

## Completion Criteria

- [ ] All Phase A definition-of-done items from spec section A.11 verified
- [ ] Polyrepo batch runs without supervisor intervention for segment issues
- [ ] All 6 tasks succeed
- [ ] Test workspace reset and ready for next run

## Git Commit Convention

- **Step completion:** `test(TP-177): complete Step N — description`

## Do NOT

- Modify taskplane runtime code (this is a test task)
- Change the test workspace structure (only add segment markers to PROMPT.md)
- Skip the full batch run
- Commit without the task ID prefix

---

## Amendments (Added During Execution)

