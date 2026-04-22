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


## Execution Target

- **Repo:** taskplane
- **Submodule path:** `.pi/git/github.com/loopyd/taskplane`
- **Upstream URL:** `https://github.com/loopyd/taskplane.git`

> This task operates within the `taskplane` submodule. All file paths, git operations, and worktrees are scoped to this submodule's repository root.

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

### 2026-03-31 — Pre-implementation alignment update (post-TP-108 handoff)

Context update since task creation:

- TP-108 is the intended batch/merge Runtime V2 cutover task.
- TP-109 remains the authority task for **workspace packet-home correctness + resume reconciliation**.
- TP-107/TP-093 observability work is in place; TP-111 tracks conversation-event fidelity and is not a blocker for packet-home authority.

#### Required clarifications for TP-109 delivery

1. **Authoritative path contract:** when explicit packet paths exist, all Runtime V2 flows must use them for `PROMPT.md`, `STATUS.md`, `.DONE`, and `.reviews/` (no silent `cwd` fallback).
2. **Execution vs packet-home separation:** preserve execution worktree location while reading/writing packet artifacts at authoritative packet-home paths.
3. **Resume correctness is mandatory:** resume/reconciliation must reconstruct task completion/progress from authoritative packet paths across repos.
4. **Archive/cleanup correctness:** packet-home-aware archive and completion checks must remain deterministic after interruption.
5. **No scope bleed into TP-108/segment expansion:** do not re-open batch-runtime ownership or dynamic segment mutation scope here.

#### Revised context to read first (in addition to original)

- `extensions/taskplane/types.ts` (`ExecutionUnit`, packet path helpers)
- `extensions/taskplane/engine.ts`, `execution.ts`, `resume.ts`, `lane-runner.ts`, `merge.ts`
- `extensions/tests/packet-home-contract.test.ts`
- `extensions/tests/polyrepo-regression.test.ts`
- `extensions/tests/workspace-config.integration.test.ts`
- `docs/specifications/framework/taskplane-runtime-v2/05-polyrepo-and-segment-compatibility.md`

#### Test emphasis addendum

At minimum, run and extend:

- `extensions/tests/packet-home-contract.test.ts`
- `extensions/tests/polyrepo-regression.test.ts`
- `extensions/tests/workspace-config.integration.test.ts`
- `extensions/tests/orch-state-persistence.test.ts`
- relevant resume tests (`extensions/tests/*resume*.test.ts`)
- full suite

#### Non-goal reminder

- Do not treat dashboard/event-fidelity gaps (TP-111) as part of packet-home authority closure.
