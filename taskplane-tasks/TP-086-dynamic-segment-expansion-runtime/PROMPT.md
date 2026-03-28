# Task: TP-086 - Dynamic Segment Expansion Protocol and Supervisor Decisions

**Created:** 2026-03-28
**Size:** M

## Review Level: 3 (Full)

**Assessment:** Introduces runtime expansion request protocol and supervisor decision plumbing, without yet mutating execution frontier. High novelty but controlled blast radius.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 2, Security: 1, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-086-dynamic-segment-expansion-runtime/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Implement the runtime protocol for dynamic segment expansion requests and supervisor decisions (`approve | modify | reject`). This task wires messages, validation, and operator/supervisor visibility. Graph mutation is intentionally deferred to TP-087 to keep context size and risk manageable.

## Dependencies

- **Task:** TP-088 (engine/resume packet-path threading)
- **Task:** TP-083 (supervisor segment recovery/reordering baseline)
- **Task:** TP-085 (segment frontier scheduler + resume parity)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — dynamic expansion request flow
- `docs/specifications/taskplane/autonomous-supervisor.md` — supervisor alert/protocol conventions
- `extensions/taskplane/execution.ts` — worker/main IPC wiring
- `extensions/taskplane/extension.ts` — supervisor integration points
- `extensions/taskplane/types.ts` — message/payload contracts

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/types.ts`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/supervisor-primer.md`
- `extensions/tests/supervisor-alerts.test.ts`
- `extensions/tests/orch-direct-implementation.test.ts` (as needed)

## Steps

### Step 0: Preflight

- [ ] Read current worker→engine IPC contracts and supervisor alert flow
- [ ] Define structured request/decision payload schemas before implementation
- [ ] Identify minimal validation needed before supervisor sees a request

### Step 1: Expansion request protocol

- [ ] Add `segment-expansion-request` contract (taskId, fromRepo, requestedRepoIds, rationale, optional suggested edges)
- [ ] Wire request emission path from worker/runtime context
- [ ] Add deterministic payload validation (shape + known repo IDs when available)

**Artifacts:**
- `extensions/taskplane/types.ts` (modified)
- `extensions/taskplane/execution.ts` (modified)

### Step 2: Supervisor decision plumbing

- [ ] Surface requests to supervisor as structured actionable alerts/messages
- [ ] Add decision response contract: `approve | modify | reject`
- [ ] Persist/emit decision metadata sufficient for TP-087 graph mutation stage

**Artifacts:**
- `extensions/taskplane/extension.ts` (modified)
- `extensions/taskplane/types.ts` (modified)

### Step 3: Playbook and observability hooks

- [ ] Update supervisor primer for expansion request handling
- [ ] Ensure user-visible reporting includes request summary + decision outcome

**Artifacts:**
- `extensions/taskplane/supervisor-primer.md` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Add/adjust tests for request payload validation
- [ ] Add/adjust tests for approve/modify/reject decision plumbing
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Update spec wording if protocol details are finalized/renamed
- [ ] Log discoveries in STATUS.md
- [ ] Create `.DONE`

## Documentation Requirements

**Must Update:**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — protocol details if changed
- `docs/specifications/taskplane/autonomous-supervisor.md` — decision flow details if changed

**Check If Affected:**
- `docs/reference/commands.md`

## Completion Criteria

- [ ] Worker can emit structured expansion requests at runtime
- [ ] Supervisor can return structured approve/modify/reject decisions
- [ ] Decision data is available for deterministic application in TP-087
- [ ] All tests pass

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-086): complete Step N — description`
- **Bug fixes:** `fix(TP-086): description`
- **Tests:** `test(TP-086): description`
- **Hydration:** `hydrate: TP-086 expand Step N checkboxes`

## Do NOT

- Mutate the live segment graph/frontier in this task (TP-087)
- Implement resume reconstruction for expanded graph here (TP-087)
- Introduce non-deterministic request handling
- Skip full-suite tests

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
