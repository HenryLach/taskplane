# Task: TP-082 - Packet-Path Env Contract and Task-Runner Authority

**Created:** 2026-03-28
**Size:** M

## Review Level: 3 (Full)

**Assessment:** Establishes explicit packet-path environment contract and authoritative task-runner file resolution. High correctness impact, but scoped away from engine/resume threading to reduce context pressure.
**Score:** 6/8 — Blast radius: 2, Pattern novelty: 1, Security: 1, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-082-dual-context-segment-execution-and-packet-path-contract/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Implement the packet-path environment contract used by segment execution and make task-runner treat packet paths as authoritative when provided. This task covers contract definition + task-runner behavior, but intentionally defers engine/resume threading to TP-088.

## Dependencies

- **Task:** TP-085 (segment frontier scheduler + resume parity)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — packet authority + env contract
- `extensions/taskplane/execution.ts` — worker launch env threading
- `extensions/task-runner.ts` — packet path resolution and `.DONE` semantics

## Environment

- **Workspace:** `extensions/`
- **Services required:** None

## File Scope

- `extensions/taskplane/execution.ts`
- `extensions/task-runner.ts`
- `extensions/taskplane/types.ts` (if env contract constants/types are added)
- `extensions/tests/execution-path-resolution.test.ts`
- `extensions/tests/task-runner-orchestration.test.ts`

## Steps

### Step 0: Preflight

- [ ] Trace current worker launch env and task-runner path resolution flow
- [ ] Identify all places in task-runner that derive packet paths from `cwd`
- [ ] Define explicit env var contract and fallback policy before implementation

### Step 1: Add packet-path environment contract

- [ ] Add support for `TASK_PACKET_PROMPT_PATH`
- [ ] Add support for `TASK_PACKET_STATUS_PATH`
- [ ] Add support for `TASK_PACKET_DONE_PATH`
- [ ] Add support for `TASK_PACKET_REVIEWS_DIR`
- [ ] Thread vars into task-runner invocation environment (where execution layer already has packet path info)

**Artifacts:**
- `extensions/taskplane/execution.ts` (modified)
- `extensions/taskplane/types.ts` (modified if needed)

### Step 2: Enforce authoritative packet file resolution in task-runner

- [ ] Update task-runner to prefer packet env paths over cwd-derived paths
- [ ] Ensure `.DONE` checks/write/read use packet-path authority when provided
- [ ] Preserve backward compatibility when env vars are absent (mono-repo / legacy)

**Artifacts:**
- `extensions/task-runner.ts` (modified)

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Add/adjust tests for packet-path env precedence
- [ ] Add/adjust tests for authoritative `.DONE` path behavior
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Update docs for packet-path env contract if names/fallback changed
- [ ] Log discoveries in STATUS.md
- [ ] Create `.DONE`

## Documentation Requirements

**Must Update:**
- `docs/specifications/taskplane/multi-repo-task-execution.md` — finalize env var names if changed

**Check If Affected:**
- `docs/reference/task-format.md`
- `docs/reference/status-format.md`

## Completion Criteria

- [ ] Packet env vars are defined and threaded to task-runner
- [ ] Task-runner treats packet env paths as authoritative when present
- [ ] Legacy behavior remains unchanged when env vars are absent
- [ ] All tests pass

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-082): complete Step N — description`
- **Bug fixes:** `fix(TP-082): description`
- **Tests:** `test(TP-082): description`
- **Hydration:** `hydrate: TP-082 expand Step N checkboxes`

## Do NOT

- Implement engine/resume packet-path threading in this task (TP-088)
- Add scheduler reordering policy here (TP-083)
- Introduce silent fallback that masks invariant violations
- Skip full-suite tests

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
