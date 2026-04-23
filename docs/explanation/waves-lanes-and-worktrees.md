# Waves, Lanes, and Worktrees

Parallel orchestration (`/orch`) is built on three concepts:

- **waves**: dependency-safe task groups executed sequentially
- **lanes**: parallel execution slots within a wave
- **worktrees**: isolated git checkouts where workers run

Together with the **orch-managed branch model**, these concepts enable safe
parallel task execution without touching the user's working branch.

## Single-repo mode vs workspace mode

Taskplane operates in one of two modes depending on your project structure:

**Single-repo mode** is the default. Your project lives in one git repository
and all tasks, configuration, and code share that single repo. This is the
common setup for most projects — think of a typical monorepo or standalone
application. Taskplane creates worktrees, branches, and merges entirely within
that one repository.

**Workspace mode** is for polyrepo projects — multiple independent git
repositories that are developed together (e.g., a frontend app, a backend API,
and a shared library in separate repos). In workspace mode, a lightweight
pointer file (`taskplane-pointer.json`) in the workspace root tells Taskplane
where to find the configuration repo, and a workspace config maps repo IDs to
directory paths. Tasks can target specific repos via `## Execution Target` in
their PROMPT.md, and the orchestrator creates worktrees, branches, and merges
independently in each repo.

Everything in this document applies to both modes. Sections that describe
workspace-specific behavior are called out explicitly.

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

| Strategy                   | Behavior                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `affinity-first` (default) | Tasks sharing overlapping `## File Scope` entries are grouped onto the same lane to avoid merge conflicts |
| `round-robin`              | Tasks distributed evenly across lanes                                                                     |
| `load-balanced`            | Tasks distributed by estimated size (`size_weights`: S=1, M=2, L=4)                                       |

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
2. Execute    ─  Spawn worker agents (subprocess) per lane
3. Monitor    ─  Poll STATUS.md, .DONE, and lane snapshots; update dashboard
4. Collect    ─  Gather per-task outcomes (succeeded, failed, blocked)
5. Merge      ─  LLM merge agent merges lane branches into orch branch
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
orch branch. This is where Taskplane's approach fundamentally differs from
traditional CI merge strategies.

### LLM-powered merge agent

Taskplane doesn't use `git merge` blindly. Instead, it spawns an **LLM merge
agent** — a full AI agent with read, write, edit, and bash access — that
performs the merge intelligently:

1. The engine generates a **merge request file** containing:
   - The orch branch (target) and lane branch (source)
   - The list of tasks completed on that lane
   - Instructions for conflict resolution

2. The merge agent runs in a temporary **merge worktree**:

   ```
   .worktrees/{batchId}/merge/
   ```

3. For each lane branch, the agent:
   - Runs `git merge --no-ff task/{lane-branch}`
   - If the merge is clean → commits and moves on
   - If there are conflicts → **reads the conflict markers**, understands
     both sides' intent (it can read PROMPT.md and the full diff), and
     **edits the files to resolve conflicts semantically**
   - Runs `git add` and `git commit` to complete the merge

4. After all lanes are merged, the agent writes a **result JSON** file that
   the engine polls for.

### Why LLM merge matters

Traditional merge tools (3-way merge, `git rerere`) handle textual conflicts
but can't understand **intent**. When two workers both modify the same function
— one adding error handling, the other adding a parameter — a text-based merge
produces conflict markers. The LLM merge agent reads both changes, understands
they're complementary, and produces a correct resolution that includes both.

This is critical for parallel task execution. Without intelligent merge, you'd
need to either:

- Serialize all tasks (slow)
- Manually resolve every conflict (defeats automation)
- Hope file scopes don't overlap (fragile)

### Merge health monitor

During the merge phase, a **merge health monitor** actively polls the merge
agent every 2 minutes:

- **Process liveness** — checks the process registry and PID to confirm the
  agent is still running
- **Activity detection** — compares recent output with previous snapshots to
  detect stalls

Escalation thresholds:

- **Stale** (10 min no output): emits `merge_health_stale` event
- **Stuck** (20 min no output): emits `merge_health_stuck` event with a
  recommendation to kill and retry

The monitor emits events but does **not** kill agents autonomously — the
supervisor decides on intervention.

### Merge verification

After merging, the agent optionally runs **verification commands**
(`merge.verify` in config) — typically the project's test suite:

```json
{
  "merge": {
    "verify": "cd extensions && node --test tests/*.test.ts"
  }
}
```

If verification fails, the merge agent can attempt to fix the issue (test
failures from merge resolution errors) before reporting failure.

### Failure handling

When a merge fails (timeout, unresolvable conflict, verification failure):

| Policy                              | Behavior                                                       |
| ----------------------------------- | -------------------------------------------------------------- |
| `on_merge_failure: pause` (default) | Batch pauses, preserving all state for supervisor intervention |
| `on_merge_failure: abort`           | Batch stops entirely                                           |

The supervisor can then:

1. Inspect merge diagnostics (`read_lane_logs`, event log)
2. Manually resolve in the merge worktree if needed
3. Resume the batch with `orch_resume()`

### Per-repo merge (workspace mode)

In workspace mode, merge work still runs per repository, but the wave outcome is atomic across all participating repos:

1. For each repo that had lanes in this wave:
   - Create a temporary merge worktree on the orch branch
   - Merge each lane branch sequentially
   - Run verification commands per repo
   - Stage task artifacts
   - Tentatively update the repo's orch branch ref
   - Clean up
2. If every repo group succeeds, the wave is finalized.
3. If any repo group fails, Taskplane rolls every already-advanced repo ref back to its pre-wave head and reports the wave as failed instead of partially succeeded.
4. If a rollback fails, the batch safe-stops in `paused` state with recovery guidance so the operator can inspect the affected repos manually.

### Artifact staging

Workers write `.DONE` and update `STATUS.md` in the canonical task folder (which
lives in the config repo in workspace mode). These files are copied into the
merge worktree and committed to the orch branch alongside the code changes.

For the full merge lifecycle and conflict resolution details, see
[Merge and Conflict Resolution](merge-and-conflict-resolution.md).

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

| Policy                      | Behavior                                                   |
| --------------------------- | ---------------------------------------------------------- |
| `skip-dependents` (default) | Failed task's dependents are blocked; other tasks continue |
| `stop-wave`                 | Remaining tasks in the current wave are cancelled          |
| `stop-all`                  | Entire batch stops immediately                             |

Blocked and skipped tasks are tracked in batch state counters and visible in the
dashboard.

---

## 10) Why this model works

Compared to running many agents in one working directory:

| Concern                 | Taskplane                                                               | Shared directory                              |
| ----------------------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| **File conflicts**      | Impossible — worktree isolation                                         | Frequent — agents overwrite each other        |
| **Merge safety**        | LLM merge agent resolves conflicts semantically, with test verification | No merge step — conflicts accumulate silently |
| **Conflict resolution** | AI understands both sides' intent, produces correct combined code       | Manual resolution or corrupted output         |
| **User branch safety**  | Untouched until `/orch-integrate`                                       | Modified directly, no rollback                |
| **Debugging**           | Each lane has its own branch, worktree, and commit history              | One tangled history                           |
| **Resumability**        | File-backed state survives any crash                                    | Lost on restart                               |
| **Parallelism**         | Bounded by lanes, safe by design                                        | Unbounded and unsafe                          |

---

## Related

- [Architecture](architecture.md)
- [Execution Model](execution-model.md)
- [Merge and Conflict Resolution](merge-and-conflict-resolution.md) — deep dive on LLM-powered merge
- [Persistence and Resume](persistence-and-resume.md)
- [Commands Reference](../reference/commands.md) — `/orch`, `/orch-integrate` details
- [Resilience & Diagnostics Roadmap](../specifications/taskplane/implemented/resilience-and-diagnostics-roadmap.md) — planned improvements
