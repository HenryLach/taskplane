# Task: TP-083 - Supervisor Segment Recovery and Reordering

**Created:** 2026-03-28
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Extends autonomous supervisor behavior from task-level failures to segment-level recovery and dynamic reordering decisions. Medium-high behavioral impact.
**Score:** 5/8 — Blast radius: 2, Pattern novelty: 1, Security: 1, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-083-supervisor-segment-recovery-and-reordering/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Integrate segment-aware autonomous recovery with supervisor-controlled reordering of dependency-ready segments. The supervisor should be able to keep progress moving by retrying/skipping/reordering segment frontier items without violating DAG constraints, with all interventions persisted and observable.

## Dependencies

- **Task:** TP-088 (engine/resume packet-path threading)
- **Task:** TP-085 (segment frontier scheduler + resume parity)
- **Task:** TP-078 (supervisor recovery tooling baseline)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — supervisor reordering decision
- `docs/specifications/taskplane/autonomous-supervisor.md` — alert/recovery protocol
- `extensions/taskplane/engine.ts` and `resume.ts` — failure handling + alert emission
- `extensions/taskplane/extension.ts` — supervisor command surface
- `extensions/taskplane/types.ts` — alert and state contracts

## Environment

- **Workspace:** `extensions/taskplane/`
- **Services required:** None

## File Scope

- `extensions/taskplane/types.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/extension.ts` (if supervisor commands/hooks are extended)
- `extensions/taskplane/persistence.ts`
- `extensions/taskplane/supervisor-primer.md`
- `extensions/tests/supervisor-alerts.test.ts`
- `extensions/tests/orch-direct-implementation.test.ts`

## Steps

### Step 0: Preflight

- [ ] Read current supervisor alert payloads and recovery hooks
- [ ] Identify where segment-level failure context must be added
- [ ] Identify frontier selection path where supervised reorder can be applied safely

### Step 1: Segment-level supervisor alerts

- [ ] Add segment-level context to supervisor alert payloads (segment id, repo id, frontier snapshot)
- [ ] Ensure alert formatting remains concise and action-oriented
- [ ] Preserve backward compatibility for non-segment batches

**Artifacts:**
- `extensions/taskplane/types.ts` (modified)
- `extensions/taskplane/engine.ts` (modified)
- `extensions/taskplane/resume.ts` (modified)

### Step 2: Reordering policy + enforcement

- [ ] Allow supervisor to reorder only dependency-ready, non-dependent pending segments
- [ ] Reject reorder requests that violate DAG constraints
- [ ] Apply deterministic tie-breaking when reorder input is partial/ambiguous
- [ ] Persist reorder action metadata (who/when/why/before→after)

**Artifacts:**
- `extensions/taskplane/engine.ts` (modified)
- `extensions/taskplane/persistence.ts` (modified)
- `extensions/taskplane/extension.ts` (modified if command/tool entrypoint is required)

### Step 3: Supervisor playbook updates

- [ ] Update supervisor primer with segment-level recovery decision tree
- [ ] Add guidance for when reorder is appropriate vs retry/skip/abort
- [ ] Include explicit guardrails: never violate dependencies

**Artifacts:**
- `extensions/taskplane/supervisor-primer.md` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Add/adjust tests for segment-level alerts and context payloads
- [ ] Add/adjust tests for allowed vs rejected reorder scenarios
- [ ] Add/adjust tests proving reorder audit trail persistence
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 5: Documentation & Delivery

- [ ] Update spec docs if implementation constraints were discovered
- [ ] Log discoveries in STATUS.md
- [ ] Create `.DONE`

## Documentation Requirements

**Must Update:**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — if reorder API/shape differs from planned behavior
- `docs/specifications/taskplane/autonomous-supervisor.md` — if recovery protocol text changes

**Check If Affected:**
- `docs/reference/commands.md`

## Completion Criteria

- [ ] Segment failures emit actionable supervisor alerts
- [ ] Supervisor can reorder dependency-ready segments safely
- [ ] Reorder actions are persisted and auditable
- [ ] Playbooks are updated for segment-aware recovery
- [ ] All tests pass

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-083): complete Step N — description`
- **Bug fixes:** `fix(TP-083): description`
- **Tests:** `test(TP-083): description`
- **Hydration:** `hydrate: TP-083 expand Step N checkboxes`

## Do NOT

- Introduce dependency-violating reorder behavior
- Add segment bundles in this task (deferred post-v1)
- Remove existing retry/skip/force-merge capabilities
- Skip full-suite tests

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
