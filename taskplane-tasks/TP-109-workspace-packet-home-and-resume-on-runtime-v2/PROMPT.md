# Task: TP-109 - Workspace Packet-Home and Resume on Runtime V2

**Created:** 2026-03-30
**Size:** L

## Review Level: 3 (Full)

**Assessment:** This completes the critical workspace-mode correctness story for Runtime V2. High blast radius across engine, resume, and packet-home path handling, but it directly resolves a core polyrepo model gap.
**Score:** 7/8 — Blast radius: 2, Pattern novelty: 2, Security: 1, Reversibility: 2

## Canonical Task Folder

```
taskplane-tasks/TP-109-workspace-packet-home-and-resume-on-runtime-v2/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Thread authoritative packet-home paths through Runtime V2 end-to-end and make workspace-mode resume/reconciliation trustworthy on the new backend. This task should absorb the practical packet-path work from TP-082 / TP-088 into the now-real Runtime V2 execution path.

## Dependencies

- **Task:** TP-102 (packet-path and ExecutionUnit contracts exist)
- **Task:** TP-105 (lane-runner Runtime V2 path exists)
- **Task:** TP-108 (batch and merge Runtime V2 migration is in place)

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/framework/taskplane-runtime-v2/05-polyrepo-and-segment-compatibility.md` — Runtime V2 packet-home requirements
- `docs/specifications/taskplane/multi-repo-task-execution.md` — existing packet-home and workspace semantics to preserve
- `extensions/taskplane/resume.ts` — current reconciliation logic that must become packet-path authoritative
- `extensions/tests/polyrepo-regression.test.ts` — existing workspace-mode regression coverage to extend

## Environment

- **Workspace:** `extensions/taskplane/`, `docs/`
- **Services required:** None

## File Scope

- `extensions/taskplane/engine.ts`
- `extensions/taskplane/execution.ts`
- `extensions/taskplane/lane-runner.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/merge.ts`
- `extensions/tests/polyrepo-regression.test.ts`
- `extensions/tests/orch-state-persistence.test.ts`

## Steps

### Step 0: Preflight

- [ ] Trace every Runtime V2 completion, artifact, and reconciliation path that reads or writes packet files
- [ ] Identify every place remaining `cwd`-derived assumptions could still corrupt packet-home authority in workspace mode

### Step 1: Packet-Home Threading in Runtime V2 Execution

- [ ] Ensure Runtime V2 engine, lane-runner, and merge flows receive and use authoritative packet paths consistently
- [ ] Make `.DONE`, `STATUS.md`, and `.reviews/` checks fully packet-path authoritative when explicit paths exist
- [ ] Preserve single-repo backward behavior when packet paths are local

### Step 2: Resume and Reconciliation

- [ ] Make resume/reconciliation use authoritative packet paths end-to-end on the Runtime V2 backend
- [ ] Verify archive-path and completion fallback behavior remains correct for packet-home repos
- [ ] Preserve deterministic batch-state reconstruction under interruption

### Step 3: Testing & Verification

- [ ] Add or extend workspace/polyrepo behavioral tests covering packet-home execution and resume on Runtime V2
- [ ] Run the full suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 4: Documentation & Delivery

- [ ] Update Runtime V2 and multi-repo docs if implementation details or names differ from plan
- [ ] Log discoveries in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/specifications/framework/taskplane-runtime-v2/05-polyrepo-and-segment-compatibility.md`
- `docs/specifications/taskplane/multi-repo-task-execution.md`

**Check If Affected:**
- `docs/explanation/persistence-and-resume.md`
- `docs/explanation/execution-model.md`
- `README.md`

## Completion Criteria

- [ ] Runtime V2 treats packet-home paths as authoritative in workspace mode
- [ ] Resume/reconciliation is packet-path-correct on the new backend
- [ ] Polyrepo regression coverage exercises the new Runtime V2 path

## Git Commit Convention

Commits happen at **step boundaries** (not after every checkbox). All commits
for this task MUST include the task ID for traceability:

- **Step completion:** `feat(TP-109): complete Step N — description`
- **Bug fixes:** `fix(TP-109): description`
- **Tests:** `test(TP-109): description`
- **Hydration:** `hydrate: TP-109 expand Step N checkboxes`

## Do NOT

- Fall back silently to `cwd`-derived packet authority when explicit packet paths are present
- Mark workspace mode solved without resume/reconciliation proof
- Re-open split-brain packet handling during migration

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
