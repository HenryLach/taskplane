# Task: TP-169 - Segment Expansion Resume Crash and Workspace Orch Branch

**Created:** 2026-04-12
**Size:** L

## Review Level: 2 (Plan and Code)

**Assessment:** High-risk changes to resume and workspace branching — both are core recoverability paths. Incorrect resume causes data loss; incorrect branching causes work on wrong branch.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-169-segment-expansion-resume-and-orch-branch/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (created by the orchestrator runtime)
└── .DONE       ← Created when complete
```

## Mission

Fix two bugs: (1) resuming after segment expansion crashes with `allocTask.task.taskFolder undefined` (#441) because dynamically-added segments lack a resolved `taskFolder`, and (2) in workspace mode, some repos (e.g., api-service) commit directly on the base branch instead of creating an orch branch (#458), meaning task work is not isolated.

## Dependencies

- **Task:** TP-165 (segment boundary fixes must be in place before resume/expansion work)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/explanation/architecture.md` — orchestrator architecture overview

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/types.ts`
- `extensions/tests/resume*.test.ts`
- `extensions/tests/engine*.test.ts`
- `extensions/tests/workspace*.test.ts`

## Steps

### Step 0: Preflight and Root Cause Analysis

- [ ] Read resume.ts — how task allocations are reconstructed from persisted state
- [ ] Read engine.ts — how dynamically-expanded segments are persisted (PersistedSegmentRecord)
- [ ] Read execution.ts — how orch branches are created per-repo in workspace mode
- [ ] Trace the `allocTask.task.taskFolder undefined` crash path
- [ ] Trace the workspace orch branch creation for all repos
- [ ] Document findings in STATUS.md

### Step 1: Fix Segment Expansion Resume Crash

- [ ] Ensure dynamically-added segments have `taskFolder` resolved during expansion
- [ ] Or fix the resume path to re-resolve `taskFolder` from segment metadata
- [ ] Ensure all fields in `PersistedSegmentRecord` are populated for expanded segments
- [ ] Run targeted tests: `tests/resume*.test.ts`

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)
- `extensions/taskplane/resume.ts` (modified)
- `extensions/taskplane/types.ts` (modified if schema needs fields)

### Step 2: Fix Workspace Orch Branch Coverage

- [ ] Identify why some repos skip orch branch creation in workspace mode
- [ ] Ensure every repo in the workspace gets an orch branch before task execution
- [ ] Verify the orch branch is used for worktree creation in all repos
- [ ] Run targeted tests: `tests/workspace*.test.ts`

**Artifacts:**
- `extensions/taskplane/execution.ts` (modified)

### Step 3: Testing & Verification

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures
- [ ] Add regression test: resume after segment expansion — no crash, taskFolder populated
- [ ] Add regression test: workspace mode — all repos have orch branch

### Step 4: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- None expected

**Check If Affected:**
- `docs/explanation/architecture.md` — workspace branching behavior

## Completion Criteria

- [ ] All steps complete
- [ ] Resume after segment expansion works without crash
- [ ] All workspace repos get an orch branch
- [ ] All tests passing

## Git Commit Convention

- **Step completion:** `fix(TP-169): complete Step N — description`
- **Bug fixes:** `fix(TP-169): description`
- **Tests:** `test(TP-169): description`
- **Hydration:** `hydrate: TP-169 expand Step N checkboxes`

## Do NOT

- Change the segment expansion request format
- Modify single-repo branching behavior
- Skip tests
- Commit without the task ID prefix in the commit message

---

## Amendments (Added During Execution)

