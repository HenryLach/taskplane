# Taskplane Polyrepo — Concrete Execution Backlog (Internal)

> **Status:** Draft v0.1
> **Date:** 2026-03-15
> **Related:**
> - `polyrepo-support-spec.md`
> - `polyrepo-implementation-plan.md`

---

## 1) Backlog goals

This backlog translates the polyrepo spec into implementation-ready slices with:

- explicit sequence/dependencies
- code touchpoints
- acceptance criteria
- team-scale considerations for large organizations

Primary constraint: **one Taskplane implementation must support both monorepo and polyrepo.**

---

## 2) Team-scale assumptions and requirements

Large polyrepo projects typically involve many developers and many active task batches.

### Must-haves for team scale

1. **No monorepo regressions** — existing users are unaffected.
2. **Operator isolation** — one operator’s run should not corrupt another’s local state.
3. **Collision-resistant naming** — lane/session/worktree identifiers should be unique and traceable.
4. **Clear ownership signals** — tasks should explicitly indicate target repo.
5. **High observability** — repo-aware dashboard/doctor output for faster triage.
6. **Predictable partial outcomes** — cross-repo non-atomic merges are explicit and auditable.

### Scope note

This backlog targets local/dev execution scale first (many users, many repos, per-user clones).
Centralized distributed locking across multiple machines is tracked as a later hardening item.

---

## 3) Priority bands

- **P0**: required for polyrepo v1 correctness
- **P1**: required for safe team-scale operations in v1 rollout
- **P2**: post-v1 hardening and ergonomics

---

## 4) Concrete tickets

## EPIC A — Runtime context + workspace mode

### TP-POLY-001 (P0) — Add workspace config loader and execution context

**Touchpoints**
- `extensions/taskplane/types.ts`
- `extensions/taskplane/workspace.ts` (new)
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/engine.ts`

**Deliverables**
- `WorkspaceConfig` schema/types
- `ExecutionContext` type
- mode detection (`repo` default, `workspace` opt-in)

**Acceptance**
- No workspace config => behavior is identical to current
- Invalid workspace config => clear fatal message
- Valid workspace config => context object available to engine pipeline

**Depends on**: none

---

### TP-POLY-002 (P1) — Workspace-aware doctor diagnostics

**Touchpoints**
- `bin/taskplane.mjs`

**Deliverables**
- `taskplane doctor` validates workspace repos, task root, routing map
- actionable remediation hints

**Acceptance**
- non-git workspace root accepted in workspace mode
- each mapped repo path validated as git repo
- missing/unknown route entries reported clearly

**Depends on**: TP-POLY-001

---

## EPIC B — Task routing and metadata

### TP-POLY-003 (P0) — Parse task execution target from PROMPT

**Touchpoints**
- `extensions/taskplane/discovery.ts`
- `extensions/taskplane/types.ts`

**Deliverables**
- parse `## Execution Target` / `Repo:` metadata
- extend `ParsedTask` with `repoId` (resolved by end of discovery)

**Acceptance**
- explicit repo parsed correctly
- absent section does not break old prompts

**Depends on**: TP-POLY-001

---

### TP-POLY-004 (P0) — Implement deterministic task→repo routing chain

**Touchpoints**
- `extensions/taskplane/discovery.ts`
- `extensions/taskplane/messages.ts`

**Deliverables**
- routing precedence: prompt repo -> area map -> default repo -> error
- new errors (`TASK_REPO_UNRESOLVED`, `TASK_REPO_UNKNOWN`)

**Acceptance**
- unresolved tasks fail plan with clear guidance
- monorepo mode still resolves implicitly to current repo

**Depends on**: TP-POLY-003

---

## EPIC C — Polyrepo execution correctness

### TP-POLY-005 (P0) — Fix external task-folder `.DONE`/`STATUS` path semantics

**Touchpoints**
- `extensions/taskplane/execution.ts`

**Deliverables**
- robust canonical path logic for task folders outside execution repo
- compatibility fallback retained for monorepo paths

**Acceptance**
- task packets in docs repo + execution in service repo complete reliably
- no monorepo regression

**Depends on**: TP-POLY-001

---

### TP-POLY-006 (P0) — Repo-scoped lane allocation and worktree lifecycle

**Touchpoints**
- `extensions/taskplane/waves.ts`
- `extensions/taskplane/worktree.ts`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/engine.ts`

**Deliverables**
- wave tasks grouped by repo for allocation
- lane/worktree creation executes against each repo root
- lane identity includes repo dimension

**Acceptance**
- one batch can allocate lanes for 2+ repos
- worktrees created under correct repo paths

**Depends on**: TP-POLY-004, TP-POLY-005

---

### TP-POLY-007 (P1) — Collision-safe session/worktree naming for team-scale runs

> **Status: DELIVERED by TP-010** (2026-03-15)
> Implemented in `naming.ts` with `resolveOperatorId()`, `sanitizeNameComponent()`, `resolveRepoSlug()`.
> All session/worktree/branch/merge artifact names include `opId`. 83 collision resistance tests passing.

**Touchpoints**
- `extensions/taskplane/types.ts` ✅
- `extensions/taskplane/waves.ts` ✅
- `extensions/taskplane/execution.ts` ✅
- `extensions/taskplane/merge.ts` ✅
- `extensions/taskplane/naming.ts` ✅ (new)
- `extensions/taskplane/worktree.ts` ✅

**Deliverables**
- ✅ naming includes `repoSlug` + short `operatorId` + batch id suffix
- ✅ operatorId default from env/user/hostname fallback

**Acceptance**
- ✅ concurrent runs on shared machine do not collide on tmux session names
- ✅ names remain human-traceable in logs/dashboard

**Depends on**: TP-POLY-006

---

### TP-POLY-008 (P0) — Repo-scoped merge orchestration

**Touchpoints**
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/messages.ts`

**Deliverables**
- merge loops by repo
- per-repo integration branch support
- explicit partial-success reporting

**Acceptance**
- if repo A succeeds and repo B fails, batch report is explicit and accurate
- no claim of atomic all-repo merge

**Depends on**: TP-POLY-006

---

## EPIC D — Persistence, resume, and observability

### TP-POLY-009 (P0) — Persisted state schema v2 with repo dimension

**Touchpoints**
- `extensions/taskplane/types.ts`
- `extensions/taskplane/persistence.ts`

**Deliverables**
- bump schema version to 2
- persist `repoId` on lanes/tasks (+ any needed repoRoot snapshots)

**Acceptance**
- state file validates with repo-aware fields
- v1 files handled via migration or explicit actionable failure

**Depends on**: TP-POLY-006

---

### TP-POLY-010 (P0) — Resume reconciliation across repos

**Touchpoints**
- `extensions/taskplane/resume.ts`

**Deliverables**
- repo-aware session matching and worktree handling
- continue from correct wave/tasks with mixed repo lane state

**Acceptance**
- interrupted multi-repo batch resumes correctly

**Depends on**: TP-POLY-009, TP-POLY-008

---

### TP-POLY-011 (P1) — Dashboard repo-aware views and filters

**Touchpoints**
- `dashboard/server.cjs`
- `dashboard/public/app.js`
- `extensions/taskplane/formatting.ts`

**Deliverables**
- repo labels in lane/task rows
- filter by repo
- merge panel grouped by repo

**Acceptance**
- operator can identify failing repo within 1-2 clicks

**Depends on**: TP-POLY-009

---

## EPIC E — Team-scale operational hardening

### TP-POLY-012 (P1) — Task ownership and routing enforcement checks

**Touchpoints**
- `extensions/taskplane/discovery.ts`
- `extensions/taskplane/messages.ts`

**Deliverables**
- warning/fail policy when task has no explicit execution target in workspace mode (configurable)
- optional strict mode: require explicit `Execution Target` on all workspace tasks

**Acceptance**
- large teams can enforce routing hygiene to reduce accidental repo drift

**Depends on**: TP-POLY-004

---

### TP-POLY-013 (P2) — Workspace lock model (optional shared-environment safety)

**Touchpoints**
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/persistence.ts`
- `bin/taskplane.mjs` (doctor visibility)

**Deliverables**
- advisory lock file for workspace mode runs (`.pi/workspace-run.lock`)
- stale lock detection and takeover guidance

**Acceptance**
- prevents accidental double-orchestration on same shared workspace clone

**Depends on**: TP-POLY-001

---

### TP-POLY-014 (P2) — Team docs/runbook for polyrepo ops

**Touchpoints**
- internal docs under `.pi/local/docs/taskplane/`

**Deliverables**
- operator runbook: start/stop/recover in workspace mode
- naming/ownership conventions for large teams
- failure triage playbook (partial merge outcomes)

**Acceptance**
- onboarding doc can be followed by a new teammate without tribal knowledge

**Depends on**: TP-POLY-011

---

## 5) Test backlog (mapped)

### TP-POLY-T001 (P0) — Unit tests for workspace config and routing
- New tests under `extensions/tests/` for loader + resolver + error cases

### TP-POLY-T002 (P0) — Integration fixture: non-git workspace with 3 repos
- workspace root fixture
- docs repo + two service repos
- end-to-end `/orch-plan` and execution path checks

### TP-POLY-T003 (P0) — Resume regression for repo-aware schema v2
- interrupted run restore across repo lanes

### TP-POLY-T004 (P1) — Naming collision tests
- ✅ concurrent run naming uniqueness — **DELIVERED by TP-010** (`naming-collision.test.ts`, 83 tests)

### TP-POLY-T005 (P1) — Dashboard repo grouping snapshot tests
- expected payload/grouping checks

---

## 6) Suggested delivery milestones

### Milestone M1 (Correctness foundation)
- TP-POLY-001, 003, 004, 005
- TP-POLY-T001

### Milestone M2 (Execution + merge)
- TP-POLY-006, 008, 009, 010
- TP-POLY-T002, T003

### Milestone M3 (Team-scale rollout readiness)
- TP-POLY-002, 007, 011, 012
- TP-POLY-T004, T005

### Milestone M4 (Post-v1 hardening)
- TP-POLY-013, 014

---

## 7) Definition of Done (Polyrepo v1)

Polyrepo v1 is done when:

1. M1 + M2 + M3 tickets are complete.
2. Emailgistics pilot scenario passes:
   - workspace root non-git
   - central docs task root
   - cross-repo `/orch` batch with deterministic outcomes
3. Monorepo regression suite remains green.
4. Operator-facing messages/documentation clearly explain partial cross-repo merge outcomes.
