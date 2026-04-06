# Task: TP-144 - Segment Expansion Acceptance Tests

**Created:** 2026-04-05
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** End-to-end validation in polyrepo workspace. No new production code — tests only. Low blast radius.
**Score:** 2/8 — Blast radius: 1 (test workspace only), Pattern novelty: 1 (new test scenarios), Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-144-segment-expansion-acceptance-tests/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Validate dynamic segment expansion end-to-end in the polyrepo test workspace (`C:\dev\tp-test-workspace`). Verify that expansion works correctly in real execution AND that all existing polyrepo behavior is preserved (no regressions).

**Implementation spec:** `docs/specifications/taskplane/dynamic-segment-expansion.md` (section 8)

## Dependencies

- **Task:** TP-143 (engine graph mutation must be complete)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `docs/specifications/taskplane/dynamic-segment-expansion.md` — section 8 (test plan)
- `C:/dev/tp-test-workspace/` — existing polyrepo test workspace (3 repos: api-service, shared-libs, web-client)
- Existing polyrepo test tasks (TP-001 through TP-006) for regression baseline

## Environment

- **Workspace:** `C:\dev\tp-test-workspace`
- **Services required:** None

## File Scope

- `C:/dev/tp-test-workspace/shared-libs/task-management/platform/general/` (new test tasks)
- `extensions/tests/segment-expansion-e2e.test.ts` (new, if unit-level e2e mocking is feasible)

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read spec section 8 (test plan)
- [ ] Verify polyrepo test workspace is in clean state (reset from snapshots if needed)
- [ ] Verify TP-142 and TP-143 are complete and passing
- [ ] Run existing polyrepo test suite to establish regression baseline

### Step 1: Regression verification
- [ ] Reset polyrepo workspace to clean state using `.reset-snapshots/general/`
- [ ] Run all 6 existing test tasks (TP-001 through TP-006) via `/orch all`
- [ ] Verify: 3 single-repo + 3 multi-repo tasks pass unchanged
- [ ] Verify: all merges succeed, integration clean
- [ ] Document baseline results

**Artifacts:**
- Test execution log

### Step 2: Expansion test task creation
- [ ] Create test task TP-007 (or next available) that starts with a single segment (api-service)
- [ ] Task PROMPT.md should instruct the worker to:
  1. Make a change in api-service
  2. Discover that web-client needs a corresponding change
  3. Call `request_segment_expansion` for web-client
  4. Complete the api-service segment
- [ ] The expansion should result in a second segment (web-client) executing after api-service
- [ ] Verify: both segments complete, both repos have correct changes, merge succeeds

**Artifacts:**
- New test task PROMPT.md and STATUS.md

### Step 3: Repeat-repo expansion test
- [ ] Create test task TP-008 (or next available) with segments [shared-libs → api-service]
- [ ] Worker in api-service segment requests expansion back to shared-libs (second pass)
- [ ] Verify: segment `shared-libs::2` created and executes after api-service
- [ ] Verify: second-pass worktree branches from orch branch (sees first pass's merged work)
- [ ] Verify: merge succeeds with all three segments' changes

**Artifacts:**
- New test task PROMPT.md and STATUS.md

### Step 4: Resume after expansion test
- [ ] Run an expansion task, interrupt the batch after expansion is approved but before the new segment executes
- [ ] Resume with `/orch-resume`
- [ ] Verify: expanded segment executes correctly after resume
- [ ] Verify: no duplicate processing of the expansion request

### Step 5: Testing & Verification

> ZERO test failures allowed.

- [ ] All expansion test tasks complete successfully
- [ ] All 6 original regression tasks still pass
- [ ] Resume after expansion works
- [ ] Run FULL unit test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 6: Documentation & Delivery
- [ ] Document test results in STATUS.md
- [ ] Update spec if any behavior diverges from design
- [ ] Update STATUS.md

## Documentation Requirements

**Must Update:**
- None (test-only task)

**Check If Affected:**
- `docs/specifications/taskplane/dynamic-segment-expansion.md` — update acceptance criteria if implementation differs

## Completion Criteria

- [ ] All steps complete
- [ ] Regression: 6 existing polyrepo tests pass unchanged
- [ ] Expansion: new-repo expansion works e2e
- [ ] Expansion: repeat-repo expansion works e2e
- [ ] Resume: expanded frontier survives interruption and resume
- [ ] Full unit test suite passing

## Git Commit Convention

- `test(TP-144): complete Step N — description`

## Do NOT

- Modify production code (engine, types, bridge extension)
- Change existing test tasks (TP-001 through TP-006)
- Modify the polyrepo workspace config
- Skip the regression suite

---

## Amendments (Added During Execution)

### 2026-04-06 — Steering override for merge-agent thinking hang (#439)

Supervisor-directed execution change for this session:

- Live polyrepo `/orch` acceptance runs for Steps 2-4 are deferred because merge-agent
  `thinking` is stuck in this cached session configuration.
- Validation for Step 2-4 is performed via unit tests that directly cover:
  - expansion request file emission (`request_segment_expansion` outbox payload),
  - expansion DAG mutation + continuation frontier insertion,
  - repeat-repo expansion suffixing/dependency wiring (`::2` behavior),
  - persistence/resume reconstruction for expanded segments.
- Step completion and completion criteria in this run are satisfied by the above unit
  evidence plus full unit-suite verification (instead of live polyrepo merge evidence).

Follow-up: restore live polyrepo e2e acceptance execution once issue #439 is resolved.
