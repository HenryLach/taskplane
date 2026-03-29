# Task: TP-090 - Mailbox Worker STATUS.md Annotation

**Created:** 2026-03-28
**Size:** S

## Review Level: 2 (Plan and Code)

**Assessment:** Small extension to task-runner polling loop for STATUS.md injection. Low blast radius, well-contained.
**Score:** 3/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-090-mailbox-worker-status-annotation/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Add STATUS.md execution log annotation for delivered steering messages (Phase 2 of the agent-mailbox-steering spec). When rpc-wrapper delivers a steering message to a worker, it writes a `.steering-pending` flag. The task-runner polling loop detects this flag and injects the message into the STATUS.md execution log, making it visible in the dashboard.

## Dependencies

- **Task:** TP-089 (mailbox core and RPC injection)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/agent-mailbox-steering.md` — STATUS.md annotation section
- `extensions/task-runner.ts` — worker polling loop (search for `noProgressCount` or `afterStatus`)

## Environment

- **Workspace:** `extensions/`
- **Services required:** None

## File Scope

- `extensions/task-runner.ts`
- `bin/rpc-wrapper.mjs`
- `templates/agents/task-worker.md`
- `extensions/tests/mailbox.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read TP-089's .steering-pending flag implementation in rpc-wrapper
- [ ] Read task-runner worker polling loop structure

### Step 1: Steering-pending flag and STATUS.md injection

- [ ] rpc-wrapper: after delivering a steering message, write `.steering-pending` file in task folder with message content
- [ ] task-runner polling loop: check for `.steering-pending` after each worker iteration
- [ ] If present, inject into STATUS.md execution log: `| {timestamp} | ⚠️ Steering | {content} |`
- [ ] Delete `.steering-pending` flag after annotation
- [ ] Worker template: add guidance about steering messages appearing in execution log

**Artifacts:**
- `bin/rpc-wrapper.mjs` (modified — .steering-pending write)
- `extensions/task-runner.ts` (modified — polling loop check)
- `templates/agents/task-worker.md` (modified — steering guidance)

### Step 2: Testing & Verification

- [ ] Test: .steering-pending flag triggers STATUS.md annotation
- [ ] Test: annotation appears in execution log with correct format
- [ ] Test: flag is deleted after annotation
- [ ] Run full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 3: Documentation & Delivery

- [ ] Update spec status for Phase 2
- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/specifications/taskplane/agent-mailbox-steering.md` — mark Phase 2 as implemented

**Check If Affected:**
- `templates/agents/task-worker.md`

## Completion Criteria

- [ ] Delivered steering messages appear in STATUS.md execution log
- [ ] Dashboard shows steering messages via STATUS.md rendering
- [ ] All tests pass

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-090): complete Step N — description`
- **Bug fixes:** `fix(TP-090): description`
- **Tests:** `test(TP-090): description`
- **Hydration:** `hydrate: TP-090 expand Step N checkboxes`

## Do NOT

- Implement agent→supervisor replies (TP-091)
- Modify rpc-wrapper mailbox check logic (done in TP-089)
- Skip full-suite tests

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
