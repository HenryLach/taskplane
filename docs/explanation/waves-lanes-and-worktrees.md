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

Why this matters:

- no file write conflicts between parallel workers
- independent git history per lane
- safer recovery and post-failure inspection

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

## Related

- [Architecture](architecture.md)
- [Execution Model](execution-model.md)
- [Persistence and Resume](persistence-and-resume.md)
