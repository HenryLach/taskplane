# Waves, Lanes, and Worktrees

Parallel orchestration (`/orch`) is built on three concepts:

- **waves**: dependency-safe task groups executed sequentially
- **lanes**: parallel execution slots within a wave
- **worktrees**: isolated git checkouts where workers run

Together with the **orch-managed branch model**, these concepts enable safe
parallel task execution without touching the user's working branch.

---

## 1) Dependency graph

The orchestrator discovers pending tasks and builds a directed acyclic graph (DAG):

- **Nodes** = pending tasks (no `.DONE` file)
- **Edges** = dependency references from the `## Dependencies` section of each `PROMPT.md`
- Completed tasks (`.DONE` exists) are treated as pre-satisfied dependencies

Validation catches:

- Self-dependencies
- Duplicate dependencies
- Unresolved dependency targets
- Circular dependencies (cycle detection)

If validation fails, planning stops with a diagnostic message.

---

## 2) Wave computation

Waves are computed using topological-sort logic (Kahn-style):

- **Wave 1**: tasks with no unmet dependencies
- **Wave N+1**: tasks whose dependencies were all satisfied by earlier waves or pre-completed tasks

Properties:

- Deterministic ordering by task ID within a wave
- Waves execute **sequentially** — Wave 2 doesn't start until Wave 1's merge completes
- All tasks within a wave may execute **in parallel** (across lanes)

### Example: current resilience batch (TP-025 through TP-035)

```
Wave 1:  TP-025 (RPC wrapper)       TP-028 (partial progress)    TP-029 (cleanup)
              │  \        \
Wave 2:  TP-026  TP-030  TP-034
              │    │  \      \
Wave 3:  TP-027  TP-031  TP-032  TP-035
                           │
Wave 4:                 TP-033
```

TP-025 has no dependencies so it's in Wave 1. TP-026 depends on TP-025, so it
must wait for Wave 2. TP-033 depends on both TP-030 and TP-032, which are in
Waves 2 and 3 respectively, so it lands in Wave 4.

---

## 3) Lane assignment and file-scope affinity

Each wave's tasks are assigned to **lanes** (parallel execution slots) up to the
configured `max_lanes` limit.

### Assignment strategies

| Strategy | Behavior |
|----------|----------|
| `affinity-first` (default) | Tasks sharing overlapping `## File Scope` entries are grouped onto the same lane to avoid merge conflicts |
| `round-robin` | Tasks distributed evenly across lanes |
| `load-balanced` | Tasks distributed by estimated size (`size_weights`: S=1, M=2, L=4) |

### Why affinity matters

When two tasks modify the same files, running them in parallel (different lanes)
would produce merge conflicts. Affinity-first serialization puts them on the
**same lane** so they execute sequentially, with each task building directly on
the previous task's committed work.

For example, in the current batch, TP-025, TP-028, and TP-029 all touch files in
`extensions/taskplane/`. The orchestrator assigns them to a single lane:

```
Wave 1, Lane 1: TP-025 → TP-028 → TP-029 (serial, shared worktree)
```

TP-028 starts working in the same worktree where TP-025 already committed its
code — it sees TP-025's new `diagnostics.ts` file and can import from it directly.

### Size weights

`size_weights` provide relative estimates for load balancing:

```yaml
size_weights:
  S: 1    # ~30 minutes
  M: 2    # ~60 minutes
  L: 4    # ~120 minutes
```

### Repo-scoped allocation (workspace mode)

In polyrepo workspaces, tasks are grouped by their resolved repository ID
**before** lane assignment. Each repo group gets its own `max_lanes` budget and
independent affinity analysis. Lane numbers are globally unique across all repo
groups within a wave.

---

## 4) Orch-managed branch model

The orchestrator creates a dedicated **orch branch** for each batch:

```
orch/{operatorId}-{batchId}
```

All task work is merged onto this branch — the user's working branch (e.g.,
`main` or `develop`) is **never modified** during execution. This design:

- Keeps the user's branch stable for VS Code, manual work, or other tools
- Allows safe concurrent operation
- Provides a clean integration point when the batch completes

### Branch lifecycle

```
1. /orch all
   └─ Creates orch/henrylach-20260319T174500 from current branch
   └─ Creates lane branches: task/henrylach-lane-1-20260319T174500, etc.

2. Wave execution
   └─ Workers commit to lane branches in worktrees
   └─ After each wave, lane branches merge into the orch branch

3. Batch completes
   └─ All work is on the orch branch
   └─ User's branch is untouched

4. /orch-integrate
   └─ Fast-forwards (or merges) user's branch to the orch branch
   └─ Cleans up orch branch and batch state
```

In workspace mode, the orch branch is created in **every** workspace repo that
has tasks, and `/orch-integrate` integrates across all repos.

---

## 5) Worktree isolation

Each lane runs in its own **git worktree** — a separate working directory with
its own checked-out branch, sharing the same `.git` history as the main checkout.

### Batch-scoped containers

Worktrees are organized in batch-scoped containers to prevent collisions between
concurrent batches:

```
.worktrees/{operatorId}-{batchId}/
├── lane-1/     ← worktree for lane 1
├── lane-2/     ← worktree for lane 2
└── merge/      ← temporary merge worktree (created during wave merge)
```

### Lane branches

Each lane gets a dedicated branch:

```
task/{operatorId}-lane-{N}-{batchId}
```

Workers commit to this branch. After the wave completes, the lane branch is
merged into the orch branch via a temporary merge worktree.

### Why worktrees

- **No file conflicts**: parallel workers can't clobber each other's files
- **Independent git history**: each lane has its own commit log
- **Safe inspection**: if a lane fails, its worktree and branch are preserved for debugging
- **Clean merges**: lane → orch branch merges happen in isolated merge worktrees

### Repo-scoped worktrees (workspace mode)

In workspace mode, worktrees are created per-repo:

```
api-service/.worktrees/{opId}-{batchId}/lane-1/
web-client/.worktrees/{opId}-{batchId}/lane-2/
shared-libs/.worktrees/{opId}-{batchId}/lane-3/
```

Each repo's worktrees branch from that repo's base branch. If provisioning fails
for any repo, all previously-created worktrees across all repos are rolled back
(atomic wave provisioning).

---

## 6) Wave execution flow

For each wave:

```
1. Provision  ─  Create lane worktrees and branches for this wave's tasks
2. Execute    ─  Launch tmux sessions with task-runner instances per lane
3. Monitor    ─  Poll STATUS.md and .DONE; update dashboard
4. Collect    ─  Gather per-task outcomes (succeeded, failed, blocked)
5. Merge      ─  Merge successful lane branches into orch branch (per-repo)
6. Artifact   ─  Stage .DONE and STATUS.md into merge worktree, commit to orch branch
7. Cleanup    ─  Remove lane worktrees and branches
8. Advance    ─  Mark wave complete, proceed to next wave
```

Tasks on the same lane execute **serially** in a shared worktree. Each task sees
the previous task's committed work.

Tasks on different lanes (or in different repos) execute **in parallel** in
separate worktrees.

---

## 7) Merge stage

After all lanes in a wave complete, the orchestrator merges their work into the
orch branch.

### Per-repo merge (workspace mode)

In workspace mode, merges happen independently per repository:

1. For each repo that had lanes in this wave:
   - Create a temporary merge worktree on the orch branch
   - Merge each lane branch sequentially (configurable order: `fewest-files-first`, etc.)
   - Run optional verification commands (`merge.verify`)
   - Stage task artifacts (`.DONE`, `STATUS.md`) into the merge worktree
   - Update the orch branch ref via `update-ref`
   - Clean up the merge worktree

2. If merge fails:
   - `on_merge_failure: pause` → batch enters `paused` phase, preserves state for resume
   - `on_merge_failure: abort` → batch stops

### Artifact staging

Workers write `.DONE` and update `STATUS.md` in the canonical task folder (which
lives in the config repo in workspace mode). These files are copied into the
merge worktree and committed to the orch branch alongside the code changes.

### Merge verification

If `merge.verify` commands are configured, they run after merge in the merge
worktree. Failures follow the `on_merge_failure` policy.

---

## 8) Integration (`/orch-integrate`)

When the batch completes, all work lives on the orch branch. The user integrates
it into their working branch:

```
/orch-integrate              # auto-detect orch branch, fast-forward
/orch-integrate --merge      # three-way merge instead of ff
/orch-integrate --pr         # push and create a pull request
```

In workspace mode, `/orch-integrate` loops over all repos that have an orch
branch and integrates each one.

After successful integration:
- The local orch branch is deleted
- Batch state is preserved (for diagnostics) but marked completed

---

## 9) Failure propagation

The `on_task_failure` policy controls what happens to tasks that depend on a
failed task:

| Policy | Behavior |
|--------|----------|
| `skip-dependents` (default) | Failed task's dependents are blocked; other tasks continue |
| `stop-wave` | Remaining tasks in the current wave are cancelled |
| `stop-all` | Entire batch stops immediately |

Blocked and skipped tasks are tracked in batch state counters and visible in the
dashboard.

---

## 10) Why this model works

Compared to running many agents in one working directory:

| Concern | Taskplane | Shared directory |
|---------|-----------|-----------------|
| **File conflicts** | Impossible — worktree isolation | Frequent — agents overwrite each other |
| **Merge safety** | Explicit lane → orch branch merge with verification | No merge step — conflicts accumulate |
| **User branch safety** | Untouched until `/orch-integrate` | Modified directly, no rollback |
| **Debugging** | Each lane has its own branch, worktree, and session | One tangled history |
| **Resumability** | File-backed state survives any crash | Lost on restart |
| **Parallelism** | Bounded by lanes, safe by design | Unbounded and unsafe |

---

## Related

- [Architecture](architecture.md)
- [Execution Model](execution-model.md)
- [Persistence and Resume](persistence-and-resume.md)
- [Commands Reference](../reference/commands.md) — `/orch`, `/orch-integrate` details
- [Resilience & Diagnostics Roadmap](../specifications/taskplane/resilience-and-diagnostics-roadmap.md) — planned improvements
