# Waves, Lanes, and Worktrees

Parallel orchestration (`/orch`) is built on three concepts:

- **waves**: dependency-safe task groups
- **lanes**: parallel execution slots
- **worktrees**: isolated git checkouts per lane

---

## 1) Dependency graph

Orchestrator discovers pending tasks and builds a DAG:

- nodes = pending tasks
- edges = dependency references from `PROMPT.md`
- completed tasks are treated as pre-satisfied dependencies

Validation includes:

- self-dependencies
- duplicate dependencies
- unresolved dependency targets
- circular dependencies

If validation fails, planning stops.

---

## 2) Wave computation

Waves are computed with topological-sort logic (Kahn-style):

- **Wave 1**: tasks with no unmet dependencies
- **Wave N+1**: tasks whose dependencies are satisfied by earlier waves/completed tasks

Properties:

- deterministic ordering by task ID within a wave
- cycle detection if tasks cannot be placed

---

## 3) Lane assignment

Each wave is assigned to up to `max_lanes`.

Configurable strategy:

- `affinity-first`
- `round-robin`
- `load-balanced`

`size_weights` provide relative load estimates (`S/M/L`) for balancing.

### Repo-scoped allocation (workspace mode)

When a workspace configuration is active, tasks are grouped by their resolved
repository ID before lane assignment. Each repo group receives independent
allocation: its own affinity groups, its own `max_lanes` budget, and its own
strategy application. Lane numbers are globally unique across all repo groups
within a wave.

In single-repo mode (no workspace config), all tasks land in one group and
behavior is identical to the original model.

---

## 4) Worktree isolation

Each lane executes in its own git worktree and branch.

Typical branch format:

```text
task/lane-<N>-<batchId>
```

Typical worktree directory:

- `subdirectory` mode: `.worktrees/<prefix>-<N>`
- `sibling` mode: `../<prefix>-<N>`

### Repo-scoped worktrees (workspace mode)

When workspace mode is active, worktrees are created per repo group.
Each repo group's lanes are provisioned against that repo's root directory
with its resolved base branch. The base branch resolution follows a
fallback chain: per-repo config override → detected repo HEAD → batch-level
base branch.

If worktree creation fails for any repo group, all previously-created
worktrees across all repos are rolled back (atomic wave provisioning).

Lane identifiers include the repo context:

| Identifier | Repo mode | Workspace mode |
|------------|-----------|----------------|
| `laneId` | `lane-{N}` | `{repoId}/lane-{N}` |
| `tmuxSessionName` | `{prefix}-lane-{N}` | `{prefix}-{repoId}-lane-{N}` |

Why this matters:

- no file write conflicts between parallel workers
- independent git history per lane
- safer recovery and post-failure inspection
- each repo maintains its own worktree/branch lifecycle

---

## 5) Wave execution flow

For each wave:

1. allocate/prepare lane worktrees
2. launch lane execution sessions
3. monitor status/heartbeats and `.DONE`
4. collect per-task outcomes
5. merge successful lane branches
6. reset/recycle worktrees for next wave

---

## 6) Merge stage

After lane execution in a wave:

- successful lanes are merged into integration branch
- merge order follows configured policy
- optional merge verification commands run

On merge failure:

- `on_merge_failure: pause` → preserve state and allow `/orch-resume`
- `on_merge_failure: abort` → stop batch

---

## 7) Failure propagation

`on_task_failure` policy controls dependent tasks:

- `skip-dependents` (default)
- `stop-wave`
- `stop-all`

Blocked/skipped tasks are tracked in batch state counters.

---

## 8) Why this model works

Compared to running many agents in one working directory:

- **Isolation**: no clobbering shared files
- **Determinism**: explicit dependency boundaries via waves
- **Scalability**: parallelism bounded by lanes
- **Debuggability**: each lane has independent branch/worktree/session history

---

## 9) Repo-scoped lane allocation (workspace mode)

When workspace mode is active (multiple repositories), lane allocation and
worktree management become **repo-scoped**. In single-repo mode (default),
all behavior is unchanged.

### Repo grouping

Before lane assignment, wave tasks are grouped by `resolvedRepoId`:

- Each repo group gets its own `max_lanes` budget
- Affinity grouping operates within each repo group independently
- Groups are sorted by `repoId` ascending for deterministic ordering

### Lane identity

Lane identifiers include the repo dimension in workspace mode:

| Component | Repo mode | Workspace mode |
|-----------|-----------|----------------|
| `laneId` | `lane-{N}` | `{repoId}/lane-{N}` |
| TMUX session | `{prefix}-lane-{N}` | `{prefix}-{repoId}-lane-{N}` |

`N` is the local lane number within the repo group (1-indexed).
`laneNumber` (global) remains unique across all repos in a wave.

### Per-repo worktree provisioning

Each repo group resolves its own:

- **Repo root**: from `workspaceConfig.repos.get(repoId).path`
- **Base branch**: fallback chain of per-repo config → detected branch → batch default

Worktrees are created per-group with the group-specific root and branch.

### Cross-repo rollback

If worktree provisioning fails for any repo group, all previously-created
worktrees from earlier groups in the same wave are rolled back. This provides
atomic wave allocation: all lanes succeed or none remain.

### Abort compatibility

Session matching handles both name formats. Lane ID enrichment during abort
sources from persisted `PersistedLaneRecord` (keyed by `tmuxSessionName`)
to preserve the repo dimension.

---

## Related

- [Architecture](architecture.md)
- [Execution Model](execution-model.md)
- [Persistence and Resume](persistence-and-resume.md)
