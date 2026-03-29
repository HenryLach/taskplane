# Task: TP-078 - Force Merge and Supervisor Recovery Playbooks

**Created:** 2026-03-27
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Adds a merge override tool and updates the supervisor primer with structured recovery playbooks. Touches merge logic and supervisor prompt.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-078-force-merge-and-recovery-playbooks/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Complete Phase 2 of the autonomous supervisor by adding `orch_force_merge` (unblock merge failures) and comprehensive recovery playbooks in the supervisor primer. After this task, the supervisor has all the tools needed to autonomously recover from the three most common batch failure patterns: task failure, merge failure with mixed results, and stalled batches.

## Dependencies

- **Task:** TP-077 (orch_retry_task and orch_skip_task must exist — the playbooks reference them)

## Context to Read First

> Only list docs the worker actually needs. Less is better.

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/autonomous-supervisor.md` — Phase 2 section, alert categories, supervisor response protocol
- `extensions/taskplane/merge.ts` — existing merge logic, specifically the "mixed results" rejection (search for "both succeeded and failed")
- `extensions/taskplane/extension.ts` — tool registration pattern and existing supervisor tools
- `extensions/taskplane/supervisor-primer.md` — current primer content including the Phase 1 alert handling section

## Environment

- **Workspace:** extensions/taskplane
- **Services required:** None

## File Scope

- `extensions/taskplane/extension.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/supervisor-primer.md`
- `extensions/tests/supervisor-force-merge.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read spec Phase 2 section and alert categories
- [ ] Read merge.ts to find the "mixed results" rejection code path
- [ ] Read supervisor-primer.md current alert handling section

### Step 1: Implement orch_force_merge

- [ ] Register `orch_force_merge` tool in extension.ts with parameters: `waveIndex` (number, optional — defaults to current wave), `skipFailed` (boolean, optional — if true, treat failed tasks as skipped for merge purposes)
- [ ] Validation: batch is in paused/failed state due to merge failure, wave index is valid
- [ ] Implementation: invoke the merge logic but with a flag that bypasses the "mixed succeeded/failed" check. The merge should proceed with all succeeded task commits on the lane, ignoring failed ones.
- [ ] Persist merge result and update batch state
- [ ] Return confirmation with merge outcome (files changed, conflicts if any)

### Step 2: Supervisor Recovery Playbooks

- [ ] Add structured recovery playbooks to `supervisor-primer.md` for each alert category:
- [ ] **Task failure playbook:** 1) Check STATUS.md — did the worker complete? 2) If yes (race condition): orch_retry_task. 3) If no (genuine failure): read exit reason, decide retry vs skip. 4) If 3rd failure of same task: escalate to user.
- [ ] **Merge failure playbook:** 1) Check which lanes have mixed results. 2) Use orch_skip_task on genuinely failed tasks. 3) Use orch_force_merge to proceed. 4) If conflicts exist, escalate.
- [ ] **Batch complete playbook:** 1) Report summary to user. 2) If all succeeded: suggest orch_integrate. 3) If some failed: list failures with reasons.
- [ ] Include decision trees (not just instructions) so the supervisor can reason about which path to take

### Step 3: Testing & Verification

- [ ] Create `extensions/tests/supervisor-force-merge.test.ts`
- [ ] Test: orch_force_merge bypasses mixed-result rejection
- [ ] Test: orch_force_merge rejects when no merge failure exists
- [ ] Test: orch_force_merge with skipFailed treats failed tasks as skipped
- [ ] Test: recovery playbook text exists in supervisor-primer.md (source-based verification)
- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Update `docs/specifications/taskplane/autonomous-supervisor.md` — mark Phase 2 as complete
- [ ] Update `docs/reference/commands.md` — add orch_force_merge
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/specifications/taskplane/autonomous-supervisor.md` — mark Phase 2 complete
- `docs/reference/commands.md` — add orch_force_merge description

**Check If Affected:**
- `docs/explanation/architecture.md` — if merge flow description needs updating

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] orch_force_merge unblocks a paused batch with mixed-result lanes
- [ ] Supervisor primer has structured playbooks for all three failure categories
- [ ] Playbooks reference orch_retry_task, orch_skip_task, and orch_force_merge with decision logic

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-078): complete Step N — description`
- **Bug fixes:** `fix(TP-078): description`
- **Tests:** `test(TP-078): description`
- **Hydration:** `hydrate: TP-078 expand Step N checkboxes`

## Do NOT

- Implement the feedback loop (GitHub issue creation) — that's Phase 3
- Implement stall detection — not yet scoped
- Modify orch_retry_task or orch_skip_task — those are TP-077
- Add timer-based polling
- Expand task scope — add tech debt to CONTEXT.md instead
- Load docs not listed in "Context to Read First"
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
