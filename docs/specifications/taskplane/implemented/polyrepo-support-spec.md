# Taskplane Polyrepo Support Spec (Internal)

> **Status:** Draft v0.4 (internal) — Phase 1 foundations: TP-001 (context/config), TP-005 (merge), TP-006 (persistence v2); Phase 2 resume: TP-007 (repo-aware resume)
> **Date:** 2026-03-15 (updated: 2026-03-15)
> **Audience:** Taskplane maintainers
> **Goal:** One Taskplane implementation that supports both monorepo and polyrepo workspaces.

---

## 1) Context and Constraint Summary

### Real-world target topology (Emailgistics)

- Workspace root: `C:\dev\emailgistics\`
- Workspace root is **not** a git repo (just a VSCode folder)
- Each top-level folder (except editor/agent folders) is its own git repo
- `platform-docs` is a repo that owns central docs + task packets
- Canonical tasks root: `platform-docs/task-management`

### Key implication

Current Taskplane orchestration assumes a single git repo rooted at `cwd`.
Polyrepo requires separating:

- **Control plane root** (workspace/docs/task packets)
- **Execution repo root** (where worktrees/branches/merges happen)

---

## 2) Current Behavior: What Breaks in Polyrepo

### Works today

- Discovery/parsing of task packets from arbitrary paths
- `/task` if run inside a real git repo and task path is reachable

### Breakpoints

1. **Orchestrator git operations use one repo root (`cwd`)**
   - Worktree creation/reset/merge assumes `cwd` is a git repo
   - Fails when workspace root is not git

2. **Task folder ↔ worktree path translation assumes task folder under repo root**
   - `.DONE`/`STATUS.md` resolution fails for external task roots

3. **No first-class task→repo routing model**
   - No deterministic way to map a task packet to target repo

4. **State schema lacks repo dimension**
   - Lane/task runtime state currently not keyed by repo

---

## 3) Design Goals

1. Keep a **single Taskplane codebase** for mono + poly
2. Preserve existing mono behavior by default (no config changes required)
3. Add explicit workspace mode for polyrepos
4. Keep deterministic/resumable semantics (`STATUS.md`, `.DONE`, persisted state)
5. Avoid distributed-transaction complexity in v1

---

## 4) Non-Goals (v1)

- Atomic cross-repo rollbacks across multiple repos
- Multi-repo single-commit transactions
- Auto-discovery of repos without explicit config
- Full repo-boundary sandboxing of all tool access

---

## 5) Core Architecture: Dual Mode

> **Implementation status (TP-001):** Dual mode contracts fully defined in `types.ts`.
> `WorkspaceMode`, `ExecutionContext`, and `createRepoModeContext()` are implemented.
> Orchestrator startup in `extension.ts` builds an `ExecutionContext` at session start
> and threads `repoRoot` through all engine/state/discovery paths (replacing raw `cwd`).
> Repo mode preserves existing behavior (workspaceRoot === repoRoot === cwd).

Taskplane runs in one of two modes:

### Mode A — Repo Mode (existing default)

- Trigger: no workspace config present
- Behavior: current monorepo semantics unchanged

### Mode B — Workspace Mode (new)

- Trigger: workspace config file present
- Behavior: discovery from workspace task roots, execution per target repo

---

## 6) New Config: `.pi/taskplane-workspace.yaml`

> **Implementation status (TP-001):** Config loader fully implemented in `workspace.ts`.
> Schema validated with 12 deterministic error codes (see `WorkspaceConfigErrorCode` in `types.ts`).
> 38 unit tests cover all validation paths.
>
> **Schema adjustments from spec:**
> - `version` and `mode` top-level fields are not yet required/parsed (mode is inferred from file presence).
> - `workspace.root` is not used — the workspace root is always `cwd`.
> - `integration_branch` is loaded as `default_branch` in the implementation.
> - `routing.area_to_repo` is not yet implemented (deferred to WS-B: task routing).
> - Paths are canonicalized (realpath + lowercase + forward-slash) for cross-platform comparison.
> - Git repo root validation: not just "is a git repo" but "is the repo root" (via `--show-toplevel`).

Location: workspace root (can be non-git)

```yaml
version: 1
mode: "workspace"         # "repo" (default implicit) | "workspace"

workspace:
  root: "."
  tasks_root: "platform-docs/task-management"

repos:
  platform-docs:
    path: "platform-docs"
    integration_branch: "develop"
  identity-service:
    path: "identity-service"
    integration_branch: "develop"
  notifications-service:
    path: "notifications-service"
    integration_branch: "develop"

routing:
  default_repo: "platform-docs"
  area_to_repo:
    task-system: "platform-docs"
    identity-access: "identity-service"
    notifications: "notifications-service"
```

### Validation rules

- `repos.*.path` must exist and be a git repo (and must be the repo root, not a subdirectory)
- repo IDs must be unique
- repo paths must be unique (after canonicalization)
- mapped repo IDs must exist
- `tasks_root` must exist

---

## 7) Task-to-Repo Routing Model

Add explicit task execution target with deterministic fallback chain.

### Preferred (task-local declaration)

PROMPT metadata section:

```markdown
## Execution Target
- **Repo:** identity-service
```

### Fallback chain

1. `Execution Target -> Repo` in PROMPT
2. `routing.area_to_repo[task.areaName]`
3. `routing.default_repo`
4. Error (`TASK_REPO_UNRESOLVED`) with actionable message

This keeps monorepo tasks simple (no extra metadata needed) while making polyrepo routing explicit.

---

## 8) `/task` Behavior in Workspace Mode

### Command surface

Keep `/task <PROMPT.md>` unchanged.

### Runtime behavior

- Parse task
- Resolve target repo via routing model
- Execute worker/reviewer with `cwd` = target repo (or worktree path if orchestrated)
- Read/write `PROMPT.md` + `STATUS.md` at canonical task path (under docs repo)

### Important semantic update

In workspace mode, STATUS changes may live outside execution repo git history.
`STATUS.md` remains authoritative memory on disk; git checkpoints are repo-scoped.

---

## 9) `/orch` Behavior in Workspace Mode

### Discovery

Global discovery unchanged (from configured task areas/tasks root).

### Planning

- Build one global DAG (dependencies can cross repos)
- Each task annotated with `repoId`

### Lane allocation

- Lane pools are per repo (e.g., `identity-service/lane-1`)
- Wave execution remains dependency-safe globally

### Execution

- For each task: create/use worktree under its target repo
- Run task-runner in that repo worktree
- `.DONE` and `STATUS.md` checks must support **external task folders**

### Merge

> **Implementation status (TP-005):** Repo-scoped merge orchestration fully delivered.
> `mergeWaveByRepo()` in `merge.ts` partitions lanes by `repoId`, resolves per-repo
> roots and base branches, and runs independent `mergeWave()` calls per repo group.
> Mono-repo mode (no `repoId`) produces a single group and delegates directly to
> `mergeWave()` for zero-overhead backward compatibility.

- Merge flow runs **per repo** for lanes that touched that repo
- Lanes are grouped by `AllocatedLane.repoId` via `groupLanesByRepo()`
- Groups are sorted alphabetically by `repoId` (undefined → `""` sorts first, preserving mono-repo behavior)
- Within each group, merge order is preserved (fewest-files-first or sequential per config)
- Each group's merge runs against `resolveRepoRoot(repoId)` with `resolveBaseBranch(repoId)`
- No attempt at atomic all-repo merge in v1

**Non-atomic outcome policy:**

- A failure in one repo does **not** stop merging in other repos (best-effort)
- Aggregate `MergeWaveResult.status`:
  - ALL repos succeed → `"succeeded"`
  - SOME fail, SOME succeed → `"partial"`
  - ALL fail → `"failed"`
- `failedLane` / `failureReason` are set to the first failure across repos (deterministic due to sorted group order)
- `repoResults` array carries per-repo `RepoMergeOutcome` attribution

**Partial-success reporting:**

- When status is `"partial"` and repos have divergent statuses (some succeeded, some failed), a repo-attributed summary is emitted via `formatRepoMergeSummary()` in `messages.ts`
- When partial is from mixed-outcome lanes within one repo (not cross-repo divergence), no misleading repo-divergence text is emitted

**Failure policy integration:**

- `computeMergeFailurePolicy()` (shared pure function in `messages.ts`) computes pause/abort transitions identically in both `engine.ts` and `resume.ts`
- Failure attribution priority chain: (1) lane-level failures, (2) `failedLane` fallback, (3) repo-level `repo:<repoId>` labels for setup failures
- On pause/abort: lane worktrees are preserved for manual intervention

### Resume

> **Implementation status (TP-007):** Repo-aware resume fully delivered.
> `resumeOrchBatch()` in `resume.ts` reconciles multi-repo lane/session/worktree state,
> computes repo-aware resume points, and continues wave execution with full repo attribution.
> v1 state files (no repo fields) resume identically to pre-polyrepo behavior.

**Reconciliation in workspace mode:**

- Lane→task matching uses `laneRecord.taskIds.includes(task.taskId)` — repo is an attribute, not a key
- Session names are globally unique (`orch-lane-N`) so tmux session checks remain repo-agnostic
- `.DONE` and worktree existence checks use absolute paths from persisted records (no repo root resolution needed)
- Repo root is resolved via `resolveRepoRoot(lane.repoId, repoRoot, workspaceConfig)` for: worktree resets, worktree cleanup, branch deletion, re-execute spawning, and reconnect polling

**Resume point computation:**

- `computeResumePoint()` is a pure function operating on abstract signal sets — repo awareness lives in the caller
- `persistedStatus === "skipped"` treated as terminal for wave-skip (waves with only completed/failed/skipped tasks are skipped)
- Never-started tasks (`pending` + no session) get `"pending"` reconciliation action (not incorrectly `mark-failed`)
- Reconciled failures seed `blockedTaskIds` via `computeTransitiveDependents()` before the wave loop begins
- Cross-repo blocked propagation: failure in repo A correctly blocks dependents in repo B under `skip-dependents` policy

**Metadata preservation across resume checkpoints:**

- `reconstructAllocatedLanes()` rebuilds `AllocatedLane[]` from persisted lane + task records at resume init
- Task repo attribution (`repoId`, `resolvedRepoId`, `taskFolder`) carried forward from persisted records for non-pending tasks
- `encounteredRepoRoots` tracking set: seeded from persisted lanes, augmented by `onLanesAllocated` callback per wave
- Inter-wave worktree reset and terminal cleanup use `encounteredRepoRoots` (covers repos from both persisted and newly allocated lanes)

**Counter stability:**

- `blockedTasks` counter: persisted-blocked tasks in unvisited waves are counted at resume init (prevents undercounting)
- `persistedBlockedTaskIds` tracking prevents double-counting for tasks blocked in prior runs
- Re-exec merge uses sentinel `waveIndex: -1`; persistence normalizes with `Math.max(0, ...)` to prevent negative indices

**v1 backward compatibility:**

- v1 state files (no repo fields) resume identically: `resolveRepoRoot(undefined, repoRoot, null)` returns `repoRoot`
- All `undefined` repo fields fall through to single-repo behavior
- No v1 state file migration required

**Guarantees:**

- Resume is deterministic: same persisted state + same live signals → same reconciliation actions
- Cross-repo dependency graph is respected through blocked propagation
- No task is lost, double-counted, or incorrectly re-queued across pause/resume cycles

**Limitations (v1):**

- Resume does not re-validate workspace config consistency (if repos are added/removed between pause and resume, behavior is undefined)
- No per-repo pause granularity — pause/resume operates on the entire batch
- `encounteredRepoRoots` is runtime-only (not persisted) — reconstructed from persisted lanes + allocated lanes on each resume

---

## 10) Git and Worktree Semantics

In workspace mode:

- Never run git commands at workspace root unless it is itself a repo
- All git operations are executed with `cwd = repos[repoId].path`
- Worktree directories are repo-local (e.g., `<repo>/.worktrees/...`)

This removes current assumption that a single root repo owns all execution.

### 10.1) Naming Contract (TP-010)

> **Implementation status (TP-010):** Collision-resistant naming delivered.
> `naming.ts` provides `resolveOperatorId()`, `sanitizeNameComponent()`, and
> `resolveRepoSlug()`. All session, worktree, branch, and merge artifact names
> now include an operator identifier (`opId`) for team-scale isolation.

All runtime artifacts include an **operator identifier** (`opId`) to prevent collisions when multiple operators run concurrently on the same machine or repo.

**Operator ID resolution:** `TASKPLANE_OPERATOR_ID` env → `operator_id` config → OS username → `"op"` fallback. Sanitized to lowercase alphanumeric + hyphens, max 12 chars.

| Artifact | Naming pattern |
|---|---|
| TMUX session (repo) | `{tmux_prefix}-{opId}-lane-{N}` |
| TMUX session (workspace) | `{tmux_prefix}-{opId}-{repoId}-lane-{N}` |
| Merge session | `{tmux_prefix}-{opId}-merge-{N}` |
| Worktree directory | `{worktree_prefix}-{opId}-{N}` |
| Git branch | `task/{opId}-lane-{N}-{batchId}` |
| Merge temp branch | `_merge-temp-{opId}-{batchId}` |
| Merge workspace | `merge-workspace-{opId}` |
| Merge sidecars | `merge-result-w{W}-lane{L}-{opId}-{batchId}.json` |

**Cross-operator behavior notes:**
- Session listing (`/orch-sessions`) and sidecar cleanup use prefix-only matching, so they operate across all operators' sessions. This is intentional: session listing is informational, and cleanup is a hard-stop escape hatch.
- Worktree discovery (`listWorktrees`) is operator-scoped: it matches `{prefix}-{opId}-{N}` to find only the current operator's worktrees.

**Known limitations:**
- `sanitizeNameComponent()` collapses dots/underscores to hyphens (`john.doe` ≡ `john-doe`)
- Truncation to 12 chars can collide for long names sharing a prefix (recommend unique 12-char prefixes in CI)

---

## 11) Persistence / Resume Schema Changes

> **Implementation status (TP-006):** Schema v2 delivered. `BATCH_STATE_SCHEMA_VERSION` bumped from 1 → 2.
> Persisted records extended with repo identity fields. v1→v2 in-memory upconversion implemented.
> 207 tests passing, including 499 persistence-specific assertions.

Persisted state extended with repo identity:

- `PersistedBatchState.mode` — `"repo"` | `"workspace"` (required in v2)
- `PersistedTaskRecord.repoId` — prompt-declared repo ID (optional)
- `PersistedTaskRecord.resolvedRepoId` — final resolved repo ID after routing precedence (optional)
- `PersistedLaneRecord.repoId` — allocated lane's target repo (optional)
- `mergeResults` grouped by repo — carried via `MergeWaveResult` structure (TP-005 merge grouping)

> **Design note:** `worktree.repoRoot` was intentionally omitted from persisted state.
> Repo roots are resolved at resume time from workspace config + `repoId`, keeping
> state files portable across machines and avoiding stale path snapshots.

Backward compatibility:

- v1 state files upconvert to v2 in memory via `upconvertV1toV2()` (on-disk file not rewritten)
- Missing `mode` defaults to `"repo"`, missing `baseBranch` defaults to `""`
- Missing `repoId`/`resolvedRepoId` default to `undefined` (omitted from JSON)
- Schema versions other than 1 and 2 are rejected with `STATE_SCHEMA_INVALID`
- `saveBatchState()` always writes schema version 2

---

## 12) Dashboard Updates

Add repo dimension:

- lane cards show `repoId`
- filters: all repos / single repo
- merge panel grouped by repo
- failures include `repoId` for operator clarity

---

## 13) Backward Compatibility Contract

### Monorepo users

- No workspace config => existing behavior, unchanged commands
- Existing configs/state continue to work

### Polyrepo users

- Opt-in via `.pi/taskplane-workspace.yaml`
- Existing task-runner/orchestrator configs still used for task semantics
- Workspace config adds routing + repo topology only

---

## 14) Migration Plan (Phased)

### Phase 1 — Foundations

- ✅ Add workspace config loader/validator *(TP-001: `workspace.ts`, 12 error codes, 38 tests)*
- ✅ Add execution context and dual-mode contracts *(TP-001: `types.ts`, `extension.ts` startup wiring)*
- ✅ Thread `repoRoot` through orchestrator engine paths *(TP-001: extension.ts uses `execCtx.repoRoot`)*
- Add task->repo resolution *(pending: WS-B)*
- Add external task folder `.DONE`/`STATUS` path handling *(pending: WS-C)*
- ✅ Add state schema fields (`mode`, `repoId`, `resolvedRepoId`) *(TP-006: types.ts + persistence.ts, v1→v2 compat, 207 tests)*

### Phase 2 — Orchestrator execution

- Repo-scoped lane pools and worktree lifecycle
- ✅ Repo-scoped merge flow *(TP-005: `mergeWaveByRepo()` in `merge.ts`, per-repo grouping/ordering/merge, partial outcome reporting, shared failure policy helper)*
- ✅ Resume support across repo lanes *(TP-007: repo-aware reconciliation, resume point computation, wave continuation with repo attribution)*

### Phase 3 — UX

- `taskplane doctor` workspace diagnostics
- Dashboard repo grouping/filtering
- Clear error messages for unresolved repo routing

---

## 15) Operational Guidance for Emailgistics (interim)

Until full workspace mode is implemented:

- Run Taskplane from a specific target repo for execution
- Keep central task packets in `platform-docs/task-management`
- Avoid `/orch` from non-git workspace root

After workspace mode:

- Run from `C:\dev\emailgistics`
- Let routing map tasks to target repos
- Keep one canonical task root in `platform-docs`

---

## 16) Risks and Mitigations

1. **Cross-repo dependency complexity**
   - Mitigation: keep one global DAG but repo-scoped execution/merge

2. **Non-atomic multi-repo merges**
   - Mitigation: explicit per-repo success reporting; no false atomic guarantee

3. **Task packet outside execution repo**
   - Mitigation: canonical external path support + clear checkpoint semantics in workspace mode

4. **Increased operator complexity**
   - Mitigation: repo-aware dashboard and doctor diagnostics

---

## 17) Open Questions

1. Should repo target be required in PROMPT for workspace mode, or area-map fallback sufficient?
2. Should we add `/task --repo <id>` override for manual reruns/debugging?
3. Should merge ordering be global or repo-batched first in mixed waves?
4. Do we need a strict guard against edits outside target repo during execution?

---

## Related Internal Plan

- Implementation plan: `./polyrepo-implementation-plan.md`

---

## 18) Acceptance Criteria (v1 Polyrepo)

- Workspace root may be non-git
- Task packets may live in a dedicated docs repo
- `/task` can execute a packet routed to another repo and complete reliably
- `/orch` can execute/merge across >=2 repos in one batch
- Resume works after interruption with repo-aware state
- Monorepo behavior remains unchanged without workspace config
