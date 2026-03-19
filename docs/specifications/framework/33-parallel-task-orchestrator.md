# 33 — Parallel Task Orchestrator

> **Status:** Draft — Pending Review  
> **Created:** 2026-03-08  
> **Related:** [task-runner extension](../../../extensions/task-runner.ts), task-runner.yaml (`.pi/task-runner.yaml`)

---

## 1. Problem Statement

The current task-runner extension (`/task`) executes a single task serially.
When a batch of tasks is staged — for example, 12 tasks across time-off,
performance, and notifications — they must be launched one at a time by a human
or run end-to-end in sequence. A batch of 12 medium tasks at ~2 hours each takes
~24 hours of wall-clock time.

The old Ralph Wiggum orchestrator (`ralph-orchestrator.ps1`) added dependency-
aware wave execution with optional parallelism, but ran parallel agents in the
**same working directory**. This caused file-writing conflicts: two agents
editing the same Go file, running `go build` simultaneously, or committing to
the same branch at the same time.

### Goals

1. **Parallel execution** of independent tasks to reduce wall-clock time
2. **Zero file conflicts** between parallel agents — complete filesystem isolation
3. **Preserve the task-runner model** — STATUS.md as persistent memory, checkpoint
   discipline, fresh-context worker iterations, cross-model reviews
4. **Orchestrator as supervisor** — the orchestrator manages lifecycle, never does
   implementation or merge work itself; it delegates to specialized agents
5. **Deterministic merge** — changes from parallel lanes merge cleanly into the
   integration branch with full traceability

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR EXTENSION                           │
│              (runs in user's interactive Pi session)                │
│                                                                     │
│  Responsibilities:                                                  │
│  • Parse PROMPT.md files, build dependency DAG                      │
│  • Compute execution waves via topological sort                     │
│  • Allocate lanes (worktrees) for each wave                         │
│  • Spawn TMUX sessions for each lane                                │
│  • Monitor progress via STATUS.md polling                           │
│  • Spawn TMUX sessions for merge agents after wave completion       │
│  • Render high-level dashboard                                      │
│  • Handle failures, pauses, and user intervention                   │
│                                                                     │
│  Does NOT: implement features, review code, resolve merge conflicts │
└──────┬──────────┬──────────┬──────────┬─────────────────────────────┘
       │          │          │          │
       │  TMUX: orch-lane-1 │  TMUX: orch-lane-2
       │    ┌─────▼─────┐   │    ┌─────▼─────┐
       │    │  LANE 1   │   │    │  LANE 2   │    ...up to maxLanes
       │    │           │   │    │           │
       │    │ Worktree: │   │    │ Worktree: │
       │    │ cm-wt-1/  │   │    │ cm-wt-2/  │
       │    │           │   │    │           │
       │    │ Branch:   │   │    │ Branch:   │
       │    │ lane-1-*  │   │    │ lane-2-*  │
       │    │           │   │    │           │
       │    │ ┌───────┐ │   │    │ ┌───────┐ │
       │    │ │  pi   │ │   │    │ │  pi   │ │   Each Pi session has
       │    │ │task-  │ │   │    │ │task-  │ │   full TUI dashboard,
       │    │ │runner │ │   │    │ │runner │ │   attachable via TMUX
       │    │ └──┬──┬─┘ │   │    │ └──┬──┬─┘ │
       │    │    │  │    │   │    │    │  │    │
       │    │    │  │    │   │    │    │  │    │
       │    │  TMUX:│    │   │    │  TMUX:│    │
       │    │  orch-lane │   │    │  orch-lane │   Workers/reviewers
       │    │  -1-worker │   │    │  -2-worker │   also in TMUX for
       │    │  orch-lane │   │    │  orch-lane │   drill-down visibility
       │    │  -1-review │   │    │  -2-review │
       │    └───────────┘   │    └───────────┘
       │                    │
  .worktrees/merge-workspace/               (isolated merge worktree)
  ┌──────────────────────────────────────┐
  │  MERGE WORKTREE (_merge-temp branch) │   Created before merge phase,
  │                                      │   removed after fast-forward.
  │  TMUX: orch-merge-1 (cwd = here)    │
  │  ┌────────────────────────────────┐  │   Merge agents run sequentially
  │  │  MERGE AGENT 1 → lane-1       │  │   inside this worktree. User's
  │  └────────────────────────────────┘  │   main repo is untouched.
  │  TMUX: orch-merge-2 (cwd = here)    │
  │  ┌────────────────────────────────┐  │
  │  │  MERGE AGENT 2 → lane-2       │  │
  │  └────────────────────────────────┘  │
  └──────────────────────────────────────┘
         │
         ▼  (after all lanes merged)
  git merge --ff-only _merge-temp → develop
```

### Observability Stack

The system provides two complementary observability channels:

**Web Dashboard** (`http://localhost:8099`) — The primary monitoring interface.
Shows all lanes, tasks, worker stats, and merge status in a browser. Includes
a conversation viewer that renders the live AI worker stream (tool calls, text
output, token usage). No external dependencies — vanilla HTML/CSS/JS with
xterm.js from CDN. Server uses SSE for live push updates.

**TMUX drill-down** — For deep inspection of the runner TUI or merge agents:

```
Level 0: Web dashboard at http://localhost:8099
         → Lanes, tasks, worker stats (tools, elapsed, context %)
         → "View" button shows full AI conversation stream
         
Level 1: tmux attach -t orch-lane-1
         → task-runner TUI dashboard: step cards, progress bars,
           worker iteration count, context %, current tool
         
Level 1: tmux attach -t orch-merge-1
         → Merge agent Pi session: running git merge, resolving conflicts
```

Workers run in subprocess/JSON mode (not TMUX) when orchestrated, so there is
no `orch-lane-N-worker` session to attach to. Instead, the full worker
conversation is captured via JSON stream and viewable in the web dashboard.

All TMUX sessions are detachable — attaching to observe has no effect on
execution. Detach with `Ctrl+B, d` (standard TMUX).

### Component Inventory

| Component | Type | Location | New/Existing |
|-----------|------|----------|--------------|
| `task-orchestrator.ts` | Pi extension | `extensions/` | **New** |
| `task-orchestrator.yaml` | Config | `.pi/` | **New** |
| `task-merger.md` | Agent definition | `.pi/agents/` | **New** |
| `orch-dashboard-web/` | Web dashboard | `extensions/` | **New** — server.cjs + public/ |
| `task-runner.ts` | Pi extension | `extensions/` | Existing — **modified** (subprocess mode, sidecar files) |
| `task-worker.md` | Agent definition | `.pi/agents/` | Existing — **unchanged** |
| `task-reviewer.md` | Agent definition | `.pi/agents/` | Existing — **unchanged** |
| `task-runner.yaml` | Config | `.pi/` | Existing — **minor addition** (spawn_mode) |
| `creating-pi-tasks` | Skill | `.agents/skills/` | Existing — minor addition (`## File Scope`) |

---

## 3. Concepts

### 3.1 Lanes

A **lane** is a serial execution track backed by its own git worktree. Each lane:

- Has its own filesystem (worktree) — full checkout of tracked files
- Has its own git branch — created from `develop` at wave start
- Runs one task at a time serially (using the existing task-runner)
- Persists across tasks within the same wave (if a lane is assigned multiple
  serial tasks in the same wave)

Lanes are **pooled and reused** across waves. After a wave completes and merges,
the lane's worktree is updated to the new `develop` HEAD for the next wave.

The number of active lanes is capped by `max_lanes` in configuration.

### 3.2 Waves

A **wave** is a set of tasks whose dependencies are all satisfied. Within a wave,
all tasks are independent and can run in parallel. Waves execute sequentially —
wave N+1 does not start until wave N is fully merged.

```
Wave 1: [TO-014, OB-005, PS-007]     ← 0 dependencies each
Wave 2: [TO-015, OB-006]             ← depends on wave 1 tasks
Wave 3: [TO-016]                      ← depends on TO-015
```

### 3.3 Merge Agents

A **merge agent** is a short-lived Pi subprocess (using the `task-merger.md`
agent definition) that handles merging a lane's branch into the integration
branch. The orchestrator spawns one merge agent per lane after wave completion.

Merge agents are responsible for:
- Executing the git merge
- Detecting and classifying conflicts
- Auto-resolving trivial conflicts (different files, different sections)
- Reporting unresolvable conflicts back to the orchestrator
- Verifying the merge result compiles/builds

The orchestrator **never runs git merge itself**. It delegates to merge agents
and reacts to their reported outcomes.

### 3.4 Dependency DAG

Dependencies are extracted from PROMPT.md files. The orchestrator supports two
modes:

1. **Agent-analyzed** — An agent reads all PROMPT.md files and produces a
   `dependencies.json` mapping (same as the old ralph-orchestrator)
2. **Declared in PROMPT.md** — Tasks declare dependencies in a structured
   `## Dependencies` section (preferred for new tasks)

Dependency references support two formats:
- Unqualified: `TO-014`
- Area-qualified: `time-off/TO-014`

If an unqualified task ID matches multiple tasks across areas, dependency
resolution fails with `DEP_AMBIGUOUS` and the task must be rewritten using the
area-qualified form.

```markdown
## Dependencies
- **Task:** TO-014 (PTO policy engine must exist before testing accruals)
- **Task:** employee-management/EM-003 (employee batch endpoint needed for name hydration)
```

### 3.5 File Scope (Conflict Avoidance)

Tasks can optionally declare which files/directories they touch:

```markdown
## File Scope
- services/time-service/**
- docs/api/time-service-api.md
- web/src/pages/time-off/**
```

The orchestrator uses file scope for **lane assignment optimization**: tasks with
overlapping file scopes are assigned to the same lane (serial execution) even if
they have no declared dependency. This prevents merge conflicts proactively.

File scope is advisory — the orchestrator does not enforce it. If a task modifies
files outside its declared scope, the merge agent handles any resulting conflicts.

---

## 4. Git Worktree Mechanics

### 4.1 What a Worktree Is

A git worktree creates an additional checkout of the repository at a different
filesystem location. All worktrees share the **same `.git` database** (objects,
pack files, refs). Only the working tree files are duplicated.

```
C:\dev	askplane\                              ← Main worktree (orchestrator runs here)
  .git\                                           ← Full git database (~26 MB, shared)
  .worktrees\                                     ← Worktree base directory (gitignored)
    taskplane-wt-1\                            ← Lane 1 worktree
      .git                                        ← Tiny pointer file (~50 bytes)
      services\, docs\, web\, ...                 ← Own copy of working tree (~30 MB)
    taskplane-wt-2\                            ← Lane 2 worktree
      .git                                        ← Tiny pointer file (~50 bytes)
      services\, docs\, web\, ...                 ← Own copy of working tree (~30 MB)
  services\, docs\, web\, ...                     ← Working tree (~30 MB)
```

> **Note:** The default `worktree_location` is `"subdirectory"`, which places
> worktrees inside `.worktrees/` (gitignored). The `"sibling"` mode places them
> alongside the repo (e.g., `../taskplane-wt-1/`) for environments where
> nested worktrees are problematic.

### 4.2 Cost Per Worktree

| Item | Size | Notes |
|------|------|-------|
| Tracked files | ~30 MB | Full checkout of ~2,875 files |
| `.git` pointer | ~50 bytes | Points back to main `.git` dir |
| Git database | 0 (shared) | Not duplicated |
| `node_modules` | 0 or ~200 MB | Only if `npm install` is run |
| Go module cache | 0 (shared) | `GOMODCACHE` is user-level, shared by default |
| Total (code only) | **~30 MB** | Trivial for modern disks |

### 4.3 Worktree Lifecycle

```
CREATE (at wave start):
  git worktree add .worktrees/taskplane-wt-1 -b task/lane-1-{batchId} develop

USE (during wave execution):
  # Task-runner subprocess runs inside the worktree directory
  cd .worktrees/taskplane-wt-1
  pi -e extensions/task-runner.ts ...

MERGE (after wave completion — done by merge agent):
  # Back in main worktree
  cd C:\dev	askplane
  git checkout develop
  git merge task/lane-1-{batchId} --no-ff

UPDATE (for next wave, if lane is reused):
  cd .worktrees/taskplane-wt-1
  git rebase develop
  # or: git reset --hard develop && git checkout -b task/lane-1-{nextBatchId}

REMOVE (at batch end):
  git worktree remove .worktrees/taskplane-wt-1
  git branch -d task/lane-1-{batchId}
```

> **Branch protection:** During cleanup, `removeAllWorktrees()` and
> `removeWorktree()` check for unmerged commits before deleting branches.
> If a branch has commits not reachable from the integration branch, it is
> preserved as `saved/<branch-name>` instead of being deleted. This prevents
> accidental loss of work from incomplete merges or failed lanes.

### 4.4 Branch Naming Convention

```
task/lane-{N}-{batchId}

Where:
  N       = lane number (1, 2, 3, ...)
  batchId = ISO date-time stamp: 20260308T111750
  
Examples:
  task/lane-1-20260308T111750
  task/lane-2-20260308T111750
```

### 4.5 Git Constraints

- **A branch can only be checked out in one worktree at a time.** Each lane gets
  its own branch. The `develop` branch stays checked out in the main worktree.
- **Worktrees share refs.** A commit made in any worktree is visible to all
  worktrees immediately (they share the same `.git` database).
- **Worktrees share the reflog.** This is fine — we don't rely on reflog.

---

## 5. Execution Flow (Detailed)

### Phase 1: Discovery

```
Input:  Arguments from /orch command (area names, folder paths, or "all")
Output: List of pending tasks with parsed metadata

1. Resolve arguments to tasks:

   The /orch command accepts four types of arguments, which can be mixed:
   
   a. "all" — expands to every area in task-runner.yaml:
      /orch all
        → Iterates every key in task_areas, collects all paths
   
   b. Area names — looked up in task-runner.yaml → task_areas:
      /orch time-off performance-management
        → task-runner.yaml has:
            task_areas:
              time-off:
                path: "docs/task-management/domains/time-off/tasks"
              performance-management:
                path: "docs/task-management/domains/performance-management/tasks"
        → Resolved to directory scan of each path
   
   c. Directory paths — scanned for task folders (used as-is if path exists
      and is a directory):
      /orch docs/task-management/domains/time-off/tasks
        → Scanned for subdirectories containing PROMPT.md
   
   d. Single PROMPT.md file — adds exactly one task:
      /orch docs/task-management/domains/time-off/tasks/TO-014-accrual-engine/PROMPT.md
        → Adds this single task directly (no directory scan)
        → The orchestrator still creates a worktree and lane for it
        → Useful for re-running a specific task with full worktree isolation,
          or when you only have one task but want the merge-back workflow
   
   Resolution logic (pseudocode):
     const taskFolders = [];
     const areaScanPaths = [];
     
     for each arg:
       if arg === "all":
         areaScanPaths.push(...Object.values(task_areas).map(a => a.path))
       else if task_areas[arg] exists:
         areaScanPaths.push(task_areas[arg].path)
       else if arg ends with "PROMPT.md" and file exists:
         // Single task — add directly, no scan needed
         taskFolders.push(dirname(arg))
       else if arg is an existing directory:
         areaScanPaths.push(arg)
       else:
         error("Unknown area, path, or file: {arg}")
     
     // Deduplicate scan paths
     areaScanPaths = unique(areaScanPaths)

2. Scan each area path for pending tasks:
   a. List immediate subdirectories ONLY — do NOT recurse
   b. Skip directories named "archive" (completed tasks live here)
   c. For each remaining subdirectory:
      - Skip if no PROMPT.md exists
      - Skip if .DONE file exists (already complete)
      - Extract task ID from folder name (e.g., "TO-014" from "TO-014-accrual-engine")
      - Parse PROMPT.md: task name, dependencies, review level, size, file scope
      - Add to taskFolders list
   
   Note: archive/ is NOT scanned for PROMPT.md files. It is only checked
   for .DONE markers to build the completed-task-ID set (step 3).

3. Build completed task ID set (for dependency resolution):
   a. For each area path, check archive/ subdirectory:
      - List folders containing .DONE files
      - Extract task IDs from folder names
   b. Also include any task folders from step 2 that had .DONE files
   c. This set is used ONLY to satisfy dependency references —
      completed tasks are never re-executed

4. Build task registry: { taskId → ParsedTask }
   - Pending tasks from step 2 (will be executed)
   - Completed task IDs from step 3 (dependency resolution only)
   - Error if duplicate task IDs found across areas
   - If a single PROMPT.md was passed (step 1d), the registry may contain
     just one task — this is valid. It becomes a single-task wave.
```

### Phase 2: Dependency Analysis & Wave Computation

```
Input:  Task registry
Output: Ordered list of waves, each containing independent task IDs

1. Build dependency graph:
   a. If dependencies.json exists and is fresh → load it
   b. Else → extract from PROMPT.md ## Dependencies sections
   c. Option: spawn analysis agent for complex/ambiguous deps

2. Validate graph:
   a. Check for circular dependencies (DFS cycle detection)
   b. Check for missing dependency targets:
      - If a task depends on a task ID not in the registry (neither pending
        nor completed), the dependency is "unresolved"
      - This happens when a task in one area depends on a task in another
        area that wasn't included in the /orch arguments
        (e.g., /orch time-off, but TO-015 depends on EM-003 from employee-management)
      - Resolution: scan ALL task_areas for the missing task ID
        (check for .DONE in its folder or archive)
      - If found and complete → add to completed set, dependency satisfied
      - If found and NOT complete → error with actionable message:
        "TO-015 depends on EM-003 which is pending in 'employee-management'.
         Include that area: /orch time-off employee-management"
      - If not found in any area → error:
        "TO-015 depends on EM-003 which does not exist in any task area"
   c. Check for ambiguous dependency targets:
      - For unqualified refs (e.g., `EM-003`), if multiple matching tasks are
        found across areas, raise `DEP_AMBIGUOUS`
      - Action required: use area-qualified dependency refs (e.g.,
        `employee-management/EM-003`)
   d. Warn on external dependencies (non-task deps like "All services running")

3. Topological sort into waves:
   a. Wave 1: all tasks with 0 unmet dependencies
   b. Wave 2: tasks whose deps are all in wave 1 or completed
   c. ... repeat until all tasks scheduled

4. Apply file scope affinity:
   a. Within each wave, group tasks with overlapping file scopes
   b. Tasks in the same affinity group → same lane (serial)
```

### Phase 3: Lane Allocation

```
Input:  Current wave's task list, max_lanes config
Output: Lane assignments, worktrees created

1. Determine lane count: min(tasks in wave, max_lanes)

2. Assign tasks to lanes:
   a. Serial-affinity tasks (overlapping file scope) → same lane
   b. Remaining tasks → round-robin across lanes
   c. Balance by estimated duration (task size: S=1, M=2, L=4)

3. For each lane:
   a. If worktree exists from previous wave:
      - Reset branch to current develop HEAD
   b. If new lane:
      - git worktree add .worktrees/{prefix}-{N} -b task/lane-{N}-{batchId} develop
   
4. Pre-warm dependencies (if configured):
   a. Check lane's tasks for file scope touching web/ → npm ci
   b. Go module cache is shared by default — no action needed
   c. Run pre-warm commands in parallel across lanes
```

### Phase 4: Parallel Execution

```
Input:  Lane assignments with worktrees ready
Output: Completed task branches with STATUS.md checkpoints

For each lane (in parallel):
  For each task assigned to this lane (sequentially):

    1. Spawn TMUX session for this task in the lane's worktree:
    
       Environment variables:
         TASK_AUTOSTART    = relative path from worktree root to this task's PROMPT.md
         TASK_RUNNER_SPAWN_MODE = "tmux"  (tells task-runner to use TMUX for workers)
         TASK_RUNNER_TMUX_PREFIX = "orch-lane-{N}"  (prefix for worker/reviewer sessions)
       
       Command:
         tmux new-session -d \
           -s "orch-lane-{N}" \
           -c ".worktrees/{prefix}-{N}" \
           "TASK_AUTOSTART='path/to/PROMPT.md' \
            TASK_RUNNER_SPAWN_MODE=tmux \
            TASK_RUNNER_TMUX_PREFIX='orch-lane-{N}' \
            pi --no-session -e extensions/task-runner.ts"
       
       What happens inside the TMUX session:
         a. Pi starts, loads task-runner.ts extension
         b. task-runner's session_start handler reads TASK_AUTOSTART
         c. task-runner resolves the path relative to cwd (the worktree root)
         d. task-runner parses PROMPT.md, creates/reads STATUS.md
         e. task-runner begins executing — identical to interactive /task behavior
         f. task-runner spawns workers in TMUX sessions named
            "{TASK_RUNNER_TMUX_PREFIX}-worker" (e.g., orch-lane-1-worker)
         g. task-runner spawns reviewers in TMUX sessions named
            "{TASK_RUNNER_TMUX_PREFIX}-reviewer" (e.g., orch-lane-1-reviewer)
         h. When all steps complete, task-runner creates .DONE file and Pi exits
         i. Pi exiting causes the TMUX session to close automatically

    2. Monitor progress (orchestrator does this, NOT the lane):
       a. Poll STATUS.md in the worktree every poll_interval seconds
          Path: .worktrees/{prefix}-{N}/{task-folder}/STATUS.md
       b. Parse step statuses and checkbox counts
       c. Check TMUX session existence: tmux has-session -t orch-lane-{N}
          Exit code 0 = alive, non-zero = session ended
       d. Update orchestrator dashboard
       e. Detect stalls: if STATUS.md mtime unchanged for stall_timeout → stall

    3. Handle completion:
       a. .DONE file appears in task folder → task succeeded
       b. TMUX session exits AND no .DONE → task failed
       c. STATUS.md stall detected → kill TMUX session, mark as stalled

    4. Next task in lane:
       a. If lane has more tasks assigned:
          → spawn a NEW TMUX session with the same name (orch-lane-{N})
            but TASK_AUTOSTART pointing to the next task's PROMPT.md
          → same worktree, so prior task's commits are visible
       b. If no more tasks → lane is complete, move to wave merge
```

### Phase 5: Wave Merge (Isolated Worktree Strategy)

```
Input:  Completed lane branches
Output: Updated develop branch with all wave work merged

1. Wait for ALL lanes in the wave to complete (or fail)

2. Classify wave outcome:
   a. All lanes succeeded → proceed to merge
   b. Some lanes failed → see failure handling (§8)
   c. All lanes failed → abort batch

3. Create an ISOLATED MERGE WORKTREE:
   
   Merging in the user's main repo caused persistent failures — any
   uncommitted file (user edits, IDE artifacts, orchestrator-generated
   files) triggered the merge agent's dirty-worktree guard. The solution
   is a dedicated merge worktree that is always clean by construction.
   
   a. Create a temporary branch at the target branch HEAD:
      git branch _merge-temp-{batchId} develop
   
   b. Create a merge worktree:
      git worktree add .worktrees/merge-workspace _merge-temp-{batchId}
   
   This worktree is separate from lane worktrees and the main repo.
   The user's working directory is completely untouched.

4. For each completed lane, spawn a MERGE AGENT (sequential):
   
   Merge agents run SEQUENTIALLY (not in parallel) to avoid
   race conditions. Each agent runs inside the merge worktree.
   
   a. Spawn merge agent in a TMUX session with cwd = merge worktree:
      tmux new-session -d -s orch-merge-{N} \
        -c ".worktrees/merge-workspace" \
        "pi --no-session --model {merger_model} \
         --append-system-prompt .pi/agents/task-merger.md \
         @merge-request.txt"
   
   b. Merge request contains:
      - Source branch: task/lane-{N}-{batchId}
      - Target branch: develop (for metadata only — agent doesn't checkout)
      - Tasks completed in this lane
      - File scope of those tasks
      - Verification commands to run after merge
      - Instruction: "Branch is already checked out — do NOT checkout"
   
   c. Merge agent executes (in the clean merge worktree):
      - Verify current branch (sanity check)
      - git merge task/lane-{N}-{batchId} --no-ff -m "merge: wave {W} lane {N} — {task IDs}"
      - If conflict → classify and attempt resolution
      - Run verification (go build, npm run type-check)
      - Write result JSON to main repo's .pi/ directory (absolute path)
   
   d. Orchestrator reads merge result:
      - SUCCESS → continue to next lane's merge
      - CONFLICT_RESOLVED → continue (agent resolved it)
      - CONFLICT_UNRESOLVED → pause batch, notify user
      - BUILD_FAILURE → pause batch, notify user
   
   Note: Each successive lane merges into _merge-temp which already
   contains all prior lanes' changes. Lane 2's merge sees lane 1's
   work, enabling proper conflict detection.

5. Fast-forward develop to the merge result:
   
   After all lanes merge successfully into _merge-temp:
   a. In the main repo: git merge --ff-only _merge-temp-{batchId}
   b. If fast-forward is blocked by user's dirty files:
      - Stash user changes (git stash push --include-untracked)
      - Fast-forward develop
      - Restore user changes (git stash pop)
   c. This is safe because the actual merge work (conflict resolution,
      verification) already happened in the isolated worktree.

6. Clean up:
   a. Remove merge worktree:
      git worktree remove .worktrees/merge-workspace --force
   b. Delete temporary branch:
      git branch -D _merge-temp-{batchId}
   c. Clean up merged lane branches:
      git branch -d task/lane-{N}-{batchId}
   d. Update lane worktrees for next wave:
      cd .worktrees/{prefix}-{N}
      git checkout -B task/lane-{N}-{nextBatchId} develop

On any failure:
   - The merge worktree and temp branch are cleaned up
   - The develop branch is untouched (no partial merge)
   - Lane branches are preserved for manual inspection or retry
```

### Phase 6: Next Wave / Completion

```
1. If more waves remain:
   a. Re-evaluate: did any failed tasks block downstream waves?
   b. Adjust remaining waves (remove tasks with failed dependencies)
   c. Return to Phase 3 with next wave

2. If all waves complete:
   a. Remove all worktrees:
      git worktree remove .worktrees/{prefix}-{N}  (for each lane)
   b. Write batch summary to log
   c. Update dashboard → "Batch Complete"
```

---

## 6. TMUX Integration & Observability

### 6.1 Why TMUX

Without TMUX, lane subprocesses are invisible. The orchestrator can poll
STATUS.md for progress numbers, but the user cannot see what a worker is
actually doing — which file it's reading, which test is failing, what the
reviewer is examining. TMUX solves this with zero-cost observability:

- Every subprocess runs in a named TMUX session
- Attach at any time to observe (`tmux attach -t name`)
- Detach without affecting execution (`Ctrl+B, d`)
- Sessions persist even if the user's terminal disconnects
- No performance overhead — TMUX is a terminal multiplexer, not a VM

### 6.2 Session Naming Convention

All orchestrator TMUX sessions use the `orch-` prefix to avoid collisions
with user sessions.

| Session Name | Contains | Purpose |
|---|---|---|
| `orch-lane-{N}` | Pi + task-runner extension | Lane execution (task-runner TUI visible) |
| `orch-lane-{N}-worker` | Pi worker subprocess | Current worker iteration (raw tool calls) |
| `orch-lane-{N}-reviewer` | Pi reviewer subprocess | Code/plan review in progress |
| `orch-merge-{N}` | Pi merge agent | Branch merge + verification |

Where `{N}` is the lane number (1, 2, 3, ...).

Worker and reviewer sessions are ephemeral — created per-iteration and destroyed
on completion. Lane sessions persist for the duration of the wave.

### 6.3 Auto-Start Mechanism

Interactive Pi sessions don't accept commands via CLI arguments — you type them
in the editor. To avoid fragile `tmux send-keys` timing, the task-runner
extension supports an **environment variable trigger**.

**The problem:** The orchestrator needs to tell a Pi session "run `/task X`"
at startup. But Pi commands are typed interactively — there's no `pi --command`
flag. Using `tmux send-keys "/task X" Enter` is fragile because you don't know
when Pi is ready to accept input.

**The solution:** The task-runner extension reads `TASK_AUTOSTART` from the
environment on startup and programmatically invokes the same code path as `/task`.

```bash
# Orchestrator sets TASK_AUTOSTART before launching the TMUX session
TASK_AUTOSTART="docs/task-management/domains/time-off/tasks/TO-014-accrual-engine/PROMPT.md" \
  tmux new-session -d -s orch-lane-1 \
  -c "/path/to/worktree" \
  "pi --no-session -e extensions/task-runner.ts"
```

**Implementation in task-runner.ts** — add to the existing `session_start` handler:

```typescript
pi.on("session_start", async (_event, ctx) => {
    // ... existing initialization (theme, footer, widget, config) ...
    
    // Auto-start: orchestrator passes task path via environment variable
    const autoStart = process.env.TASK_AUTOSTART;
    if (autoStart) {
        const fullPath = resolve(ctx.cwd, autoStart);
        if (!existsSync(fullPath)) {
            ctx.ui.notify(`TASK_AUTOSTART file not found: ${autoStart}`, "error");
            return;
        }
        
        // Same logic as the /task command handler:
        const content = readFileSync(fullPath, "utf-8");
        state = freshState();
        state.task = parsePromptMd(content, fullPath);
        state.config = loadConfig(ctx.cwd);
        state.phase = "running";
        widgetCtx = ctx;
        
        // Generate STATUS.md if missing
        const statusPath = join(state.task.taskFolder, "STATUS.md");
        if (!existsSync(statusPath)) {
            writeFileSync(statusPath, generateStatusMd(state.task));
        } else {
            const existing = parseStatusMd(readFileSync(statusPath, "utf-8"));
            state.reviewCounter = existing.reviewCounter;
            state.totalIterations = existing.iteration;
            for (const s of existing.steps) state.stepStatuses.set(s.number, s);
        }
        
        const reviewsDir = join(state.task.taskFolder, ".reviews");
        if (!existsSync(reviewsDir)) mkdirSync(reviewsDir, { recursive: true });
        
        updateWidgets();
        ctx.ui.notify(`Auto-starting: ${state.task.taskId}`, "info");
        
        // Fire execution (same as /task command)
        executeTask(ctx).catch(err => {
            state.phase = "error";
            ctx.ui.notify(`Task error: ${err?.message || err}`, "error");
            updateWidgets();
        });
    }
});
```

**Flow:** TMUX starts → Pi initializes → extension loads → `session_start`
fires → reads `TASK_AUTOSTART` → parses PROMPT.md → begins execution. Zero
timing races. If the env var is not set (standalone `/task` usage), the existing
interactive behavior is unchanged.

**When Pi exits:** Task-runner calls `executeTask()`, which runs all steps, then
creates `.DONE` and Pi's process exits. Since the Pi process was the only thing
running in the TMUX session, the session closes automatically. The orchestrator
detects this via `tmux has-session` returning non-zero.

### 6.4 Dual Spawn Mode in task-runner.ts

The existing `spawnAgent()` function in task-runner.ts gains a second mode.
The mode is determined by environment variable (set by the orchestrator) with
fallback to config file, with fallback to "subprocess" (current behavior).

**Mode resolution order:**

```typescript
function getSpawnMode(config: TaskConfig): "subprocess" | "tmux" {
    // 1. Environment variable (set by orchestrator when launching lane)
    if (process.env.TASK_RUNNER_SPAWN_MODE === "tmux") return "tmux";
    // 2. Config file (task-runner.yaml)
    if (config.worker.spawn_mode === "tmux") return "tmux";
    // 3. Default
    return "subprocess";
}

function getTmuxPrefix(): string {
    // Environment variable (set by orchestrator per-lane)
    // e.g., "orch-lane-1" → worker session becomes "orch-lane-1-worker"
    return process.env.TASK_RUNNER_TMUX_PREFIX || "task";
}
```

**Why env vars take priority:** The orchestrator sets per-lane env vars
(`TASK_RUNNER_SPAWN_MODE=tmux`, `TASK_RUNNER_TMUX_PREFIX=orch-lane-1`) when
spawning TMUX sessions. This lets task-runner.yaml keep `subprocess` as the
default for standalone `/task` usage, while orchestrated lanes automatically
get TMUX mode without config file changes.

```yaml
# .pi/task-runner.yaml — no change needed for orchestrated use
worker:
  spawn_mode: "subprocess"  # Default for standalone /task
  # Orchestrator overrides this via TASK_RUNNER_SPAWN_MODE env var
```

**Subprocess mode** (existing, default for standalone `/task` usage):

```typescript
// Current behavior preserved exactly — pi -p --mode json, JSON event stream
const { promise, kill } = spawnAgent({
    model, tools, thinking, systemPrompt, prompt,
    onToolCall: (name, args) => { ... },  // Real-time tool tracking
    onContextPct: (pct) => { ... },       // Context window monitoring
});
```

**TMUX mode** (new, for orchestrated parallel execution):

```typescript
function spawnAgentTmux(opts: {
    sessionName: string;   // e.g., "orch-lane-1-worker"
    cwd: string;           // worktree path
    systemPrompt: string;  // agent system prompt content
    prompt: string;        // user prompt content
    model: string;         // e.g., "anthropic/claude-sonnet-4-20250514"
    tools: string;         // e.g., "read,write,edit,bash,grep,find,ls"
    thinking: string;      // e.g., "off"
}): { promise: Promise<{ exitCode: number; elapsed: number }>; kill: () => void } {
    
    // Write system prompt and user prompt to temp files
    // (same approach as existing spawnAgent — avoids shell escaping issues)
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sysTmpFile = join(tmpdir(), `pi-task-sys-${id}.txt`);
    const promptTmpFile = join(tmpdir(), `pi-task-prompt-${id}.txt`);
    writeFileSync(sysTmpFile, opts.systemPrompt);
    writeFileSync(promptTmpFile, opts.prompt);
    
    // Build the Pi command that will run inside the TMUX session
    const piCmd = [
        "pi", "--no-session", "--no-extensions", "--no-skills",
        "--model", opts.model,
        "--tools", opts.tools,
        "--thinking", opts.thinking,
        "--append-system-prompt", sysTmpFile,
        `@${promptTmpFile}`,
    ].join(" ");
    
    // Create the TMUX session
    // -d = detached, -s = session name, -c = working directory
    spawnSync("tmux", [
        "new-session", "-d",
        "-s", opts.sessionName,
        "-c", opts.cwd,
        piCmd,
    ], { shell: true });
    
    // Return interface compatible with existing spawnAgent return type
    const promise = pollUntilSessionEnds(opts.sessionName, sysTmpFile, promptTmpFile);
    const kill = () => {
        spawnSync("tmux", ["kill-session", "-t", opts.sessionName]);
        // Clean up temp files
        try { unlinkSync(sysTmpFile); } catch {}
        try { unlinkSync(promptTmpFile); } catch {}
    };
    
    return { promise, kill };
}

async function pollUntilSessionEnds(
    sessionName: string,
    sysTmpFile: string,
    promptTmpFile: string,
): Promise<{ exitCode: number; elapsed: number }> {
    const start = Date.now();
    while (true) {
        // tmux has-session returns 0 if session exists, 1 if not
        const result = spawnSync("tmux", ["has-session", "-t", sessionName]);
        if (result.status !== 0) {
            // Session no longer exists — Pi process exited, TMUX session closed
            // Clean up temp files
            try { unlinkSync(sysTmpFile); } catch {}
            try { unlinkSync(promptTmpFile); } catch {}
            return { exitCode: 0, elapsed: Date.now() - start };
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}
```

**How task-runner calls the right mode:**

```typescript
// In runWorker() and doReview(), replace the existing spawnAgent() call:
const spawnMode = getSpawnMode(config);

if (spawnMode === "tmux") {
    const prefix = getTmuxPrefix();  // e.g., "orch-lane-1"
    const { promise, kill } = spawnAgentTmux({
        sessionName: `${prefix}-worker`,   // → "orch-lane-1-worker"
        cwd: ctx.cwd,
        systemPrompt, prompt, model,
        tools: config.worker.tools,
        thinking: config.worker.thinking,
    });
    state.workerProc = { kill };
    const result = await promise;
    // ... handle result (same as existing post-spawnAgent logic)
} else {
    // Existing subprocess spawnAgent() — unchanged
    const { promise, kill } = spawnAgent({ ... });
    // ...
}
```

**Key detail — session name reuse:** Worker sessions are ephemeral. Each worker
iteration creates `orch-lane-1-worker`, it runs, Pi exits, the session closes.
The next iteration creates a new `orch-lane-1-worker` session. TMUX allows
reusing session names after the previous one exits. If a user is attached when
the session closes, they see the session end — they'd need to re-attach for the
next iteration.

### 6.5 Orchestrated Worker Mode (Subprocess with Telemetry)

In orchestrated mode, workers run in **subprocess/JSON mode** (not TMUX). This
gives the orchestrator full telemetry while the web dashboard provides
observability that replaces the need for TMUX attach.

The orchestrator sets `TASK_RUNNER_SPAWN_MODE=subprocess` per lane. The runner
spawns workers as headless subprocesses with `pi -p --mode json`, capturing
the JSON event stream on stdout.

**Telemetry captured from JSON stream:**

| Data Point | Available | Source |
|---|---|---|
| Task progress (checkboxes) | ✅ | STATUS.md polling |
| Worker completion | ✅ | Process exit code |
| Worker elapsed time | ✅ | Timer |
| Context window % | ✅ | `message_end` events with token usage |
| Current tool name | ✅ | `tool_execution_start` events |
| Tool call count | ✅ | `tool_execution_start` event counting |
| Full conversation | ✅ | All JSON events teed to JSONL file |

**Sidecar files (written to main repo's `.pi/` directory):**

| File | Contents | Update Frequency |
|---|---|---|
| `.pi/lane-state-orch-lane-{N}.json` | Worker stats (tool count, elapsed, context %, last tool, status) | Every 1 second |
| `.pi/worker-conversation-orch-lane-{N}.jsonl` | Full JSON event stream from worker | Every event |

The `ORCH_SIDECAR_DIR` env var tells the runner where to write these files
(main repo's `.pi/`, not the worktree's). The web dashboard server reads them
for live display.

**Context window management:** In subprocess mode, task-runner tracks context %
via JSON `message_end` events and creates the wrap-up file at `warn_percent`
and kills the process at `kill_percent`.

**Fresh context per iteration:** Each worker iteration is a new Pi subprocess,
so context accumulation resets every iteration.

> **Note:** TMUX mode for workers is still supported for standalone `/task`
> usage and can be forced via `TASK_RUNNER_SPAWN_MODE=tmux`. In TMUX mode,
> the JSON event stream is unavailable and the runner falls back to wall-clock
> timeouts instead of context % tracking.

### 6.6 Orchestrator → Lane Monitoring

The orchestrator does NOT attach to lane TMUX sessions. It monitors lanes via
file-based polling:

```
Orchestrator monitoring loop (every poll_interval seconds):
  For each active lane:
    1. Read STATUS.md from the lane's worktree
       → Parse step status, checkbox counts, iteration number
    2. Check for .DONE file in task folder
       → Task complete
    3. tmux has-session -t orch-lane-{N}
       → Session alive? If not and no .DONE → task failed
    4. Compare STATUS.md mtime to last check
       → No change for stall_timeout → stall detected
```

This is robust — no JSON parsing, no pipe management, no process handle
tracking. The filesystem is the communication channel.

---

## 7. Merge Agent Design

The merge agent keeps the orchestrator as a pure supervisor. It's a short-lived
Pi session (in its own TMUX session) with a focused system prompt.

### 7.1 Agent Definition (`.pi/agents/task-merger.md`)

The merge agent runs in an **isolated merge worktree**, not the user's main
working directory. This eliminates the dirty-worktree failure mode that
previously caused merge failures when the user had uncommitted edits.

```markdown
---
name: task-merger
description: Merges lane branches into develop with conflict resolution
tools: read,write,edit,bash,grep,find,ls
model: ""  # inherits from orchestrator config
---

You are a merge agent running in an ISOLATED MERGE WORKTREE.

## Your Job

1. Read the merge request provided in your prompt
2. Execute the merge (branch is already checked out — do NOT switch branches)
3. Handle any conflicts
4. Verify the result
5. Write your outcome to the specified result file

## Merge Procedure

1. Verify current state (sanity check only):
   git branch --show-current
   git log --oneline -1
   # The correct branch is already checked out. Do NOT switch branches.

2. Attempt merge:
   git merge {source_branch} --no-ff -m "{merge_message}"

3. If merge succeeds (no conflicts):
   → Run verification commands
   → Write SUCCESS result

4. If merge has conflicts:
   → Run: git diff --name-only --diff-filter=U  (list conflicted files)
   → Classify each conflict (see Conflict Classification)
   → Attempt resolution for auto-resolvable conflicts
   → If all resolved: git add . && git commit -m "merge: resolved conflicts..."
   → If any unresolvable: git merge --abort && write CONFLICT_UNRESOLVED result
```

**Key differences from earlier design:**
- No `git status --porcelain` check — the worktree is clean by construction
- No `git checkout develop` — the correct branch (_merge-temp) is already checked out
- Result file is written to an **absolute path** in the main repo's `.pi/` directory
- The agent never touches the user's working directory

### 7.2 Why Sequential Merges

Merge agents run **one at a time**, not in parallel. Rationale:

1. **The develop branch is a shared resource.** Two concurrent merges to develop
   would race on the branch ref.
2. **Each merge must see the prior merge's result.** Lane 2's merge might
   conflict with lane 1's changes — this is only detectable if lane 1 is already
   merged.
3. **Merge agents are fast.** A typical merge takes 10-30 seconds. Even with
   verification (go build), under 2 minutes. For a 3-lane wave, total merge
   time is ~5 minutes — negligible compared to task execution time.

### 7.3 Merge Order

The orchestrator determines merge order using a heuristic:

1. **Lanes with fewer changed files merge first** — smaller changes are less
   likely to conflict, establishing a clean base.
2. **Lanes with non-overlapping file scopes merge first** — guaranteed clean.
3. **Last: lanes with the broadest changes** — most likely to need conflict
   resolution, benefits from seeing all prior merges.

### 7.4 Merge Worktree Lifecycle

The merge worktree provides complete isolation between the merge process and
the user's main working directory.

```
BEFORE MERGE PHASE:
  1. git branch _merge-temp-{batchId} develop
     → Creates temp branch at current develop HEAD
  
  2. git worktree add .worktrees/merge-workspace _merge-temp-{batchId}
     → Creates a clean checkout on the temp branch

DURING MERGE (sequential, per lane):
  3. Merge agent spawns with cwd = .worktrees/merge-workspace
  4. Agent merges lane branch into _merge-temp (current HEAD)
  5. Agent runs verification commands in the worktree
  6. Agent writes result JSON to main repo's .pi/ (absolute path)
  7. Next lane's agent sees prior lanes' merges on _merge-temp

AFTER ALL LANES SUCCEED:
  8. git merge --ff-only _merge-temp-{batchId}    (in main repo)
     → Fast-forwards develop to include all lane merges
     → If blocked by dirty files: stash → ff → pop
  
  9. git worktree remove .worktrees/merge-workspace --force
  10. git branch -D _merge-temp-{batchId}

ON ANY FAILURE:
  8. git worktree remove .worktrees/merge-workspace --force
  9. git branch -D _merge-temp-{batchId}
  → develop is UNTOUCHED (no partial merge)
  → Lane branches preserved for retry
```

**Why this is better than merging in the main repo:**

| Problem | Old Approach | Worktree Approach |
|---------|-------------|-------------------|
| User has uncommitted edits | ❌ BUILD_FAILURE | ✅ Merge is isolated, user edits unaffected |
| Orchestrator generates files (dependencies.json) | ❌ BUILD_FAILURE | ✅ Generated files are in main repo, not worktree |
| IDE has files open | ❌ Potential lock conflict | ✅ Different directory entirely |
| Merge fails midway | ❌ develop has partial merge | ✅ develop untouched until all lanes succeed |
| User edits during merge | ❌ Race condition | ✅ Stash/pop only for fast-forward step |

---

## 8. Failure Handling

### 8.1 Task Failure

When a task fails (worker can't make progress, tests fail permanently, blocker):

| `on_task_failure` Config | Behavior |
|--------------------------|----------|
| `skip-dependents` | Mark task failed. Remove dependent tasks from future waves. Continue current wave's other lanes. |
| `stop-wave` | Mark task failed. Let other lanes in this wave finish. Don't start next wave. |
| `stop-all` | Kill all running lanes immediately. Abort batch. |

Default: `skip-dependents` — maximizes work done while respecting dependency
chains.

### 8.2 Merge Failure

| Merge Result | Orchestrator Action |
|--------------|---------------------|
| `SUCCESS` | Continue to next lane merge |
| `CONFLICT_RESOLVED` | Log resolution details, continue |
| `CONFLICT_UNRESOLVED` | Pause batch. Notify user. Wait for `/orch-resume` |
| `BUILD_FAILURE` | Pause batch. Notify user with error output. Wait for `/orch-resume` |

On pause, the orchestrator preserves all state: worktrees stay on disk, lane
branches are intact, STATUS.md files reflect completed work. The user can:

1. Manually resolve the conflict in the main worktree
2. Resume with `/orch-resume`
3. Or abort with `/orch-abort` (worktrees cleaned up, branches preserved)

### 8.3 Lane Stall Detection

If a lane's STATUS.md hasn't changed for `stall_timeout` minutes (default: 30),
the orchestrator:

1. Checks if the TMUX session is still alive (`tmux has-session -t orch-lane-{N}`)
2. If alive but no progress → kill the session (`tmux kill-session -t orch-lane-{N}`)
3. Also kill any child sessions (`orch-lane-{N}-worker`, `orch-lane-{N}-reviewer`)
4. Mark the current task as stalled
5. Treat as task failure (apply `on_task_failure` policy)

---

## 9. Dashboard Design

The orchestrator provides two monitoring interfaces: a **web dashboard** for
primary monitoring and **TMUX attach** for deep inspection.

### 9.1 Web Dashboard (`http://localhost:8099`)

The web dashboard is the primary monitoring interface, running as a Node.js
HTTP server with SSE (Server-Sent Events) for live push updates.

**Location:** `extensions/orch-dashboard-web/`

| File | Purpose |
|------|---------|
| `server.cjs` | HTTP server, SSE endpoints, file watching, tmux session detection |
| `public/index.html` | Single-page dashboard shell |
| `public/style.css` | Dark GitHub-style theme |
| `public/app.js` | EventSource client, DOM rendering, conversation viewer |

**Start:** `node extensions/orch-dashboard-web/server.cjs`

**Features:**

- **Batch header:** Wave progress, task counts, elapsed time, overall progress bar
- **Lanes & Tasks panel:** Integrated view showing each lane with its tasks,
  progress bars, step info, and live worker stats
- **Worker stats (inline):** Each running task shows: ⏱ elapsed, 🔧 tool count,
  📊 context %, last tool call with path
- **👁 View button:** Opens a conversation viewer panel showing the full AI worker
  stream — text output, tool calls with args, tool results, token usage per turn
- **Merge agents table:** Shows merge session status (ready for merge phase)
- **Errors panel:** Displays any merge failures with details
- **TMUX commands:** Click-to-copy `tmux attach` commands for drill-down

**Data flow:**

```
Task-runner (in worktree)
  ├── Writes STATUS.md to worktree (step progress, checkboxes)
  ├── Writes .pi/lane-state-orch-lane-{N}.json (worker stats, every 1s)
  └── Writes .pi/worker-conversation-orch-lane-{N}.jsonl (full JSON stream)
        │
Dashboard server (port 8099)
  ├── fs.watch on .pi/batch-state.json (immediate push on change)
  ├── Reads .pi/lane-state-*.json (worker stats)
  ├── Reads STATUS.md from worktrees (step progress)
  ├── tmux list-sessions (session liveness)
  └── SSE push to browser every 2s (+ immediate on file change)
        │
Browser (http://localhost:8099)
  ├── EventSource /api/stream (dashboard state)
  └── Fetch /api/conversation/{prefix} (worker JSONL, polled every 2s)
```

**Zero external npm dependencies.** The server uses only Node.js built-ins
(`http`, `fs`, `path`, `child_process`). The frontend is vanilla HTML/CSS/JS.

### 9.2 TUI Dashboard (Runner Level)

Each lane's Pi session shows the task-runner TUI dashboard (visible via
`tmux attach -t orch-lane-{N}`). This provides per-step detail for a single
lane, including step cards, progress bars, and iteration tracking.

### 9.3 Dashboard Data Sources

| Data | Source | Update Method |
|------|--------|---------------|
| Batch state (waves, tasks, phases) | `.pi/batch-state.json` | fs.watch + 2s poll |
| Lane task progress (steps, checkboxes) | STATUS.md in each worktree | Parsed server-side per SSE push |
| Worker stats (tools, elapsed, context %) | `.pi/lane-state-*.json` | Read per SSE push |
| Worker conversation (full AI stream) | `.pi/worker-conversation-*.jsonl` | Fetched on demand via REST |
| Lane alive/dead | `tmux list-sessions` | Checked per SSE push |
| Merge status | Merge result files + TMUX session exit | On completion |

---

## 10. Commands

The orchestrator extension registers these Pi commands:

| Command | Description |
|---------|-------------|
| `/orch <areas\|paths\|all>` | Start batch execution (see argument resolution below). |
| `/orch-plan <areas\|paths\|all>` | Show execution plan (waves, lane assignments) without executing. |
| `/orch-status` | Show current batch progress (refreshes dashboard). |
| `/orch-pause` | Pause after current tasks finish. Lanes stop picking up new tasks. |
| `/orch-resume` | Resume a paused batch. Also used after manual conflict resolution. |
| `/orch-abort` | Graceful abort. Signal workers to checkpoint, wait up to 60s, then force-kill stragglers. |
| `/orch-abort --hard` | Immediate abort. Kill all `orch-*` TMUX sessions instantly. No checkpoint. |
| `/orch-deps <areas\|paths\|all> [--refresh]` | Show or re-analyze dependency graph. |
| `/orch-sessions` | List all active orchestrator TMUX sessions with attach commands. |

**Argument resolution** (applies to `/orch`, `/orch-plan`, `/orch-deps`):

Arguments are resolved in order. Each argument is matched as:
1. **`all`** → expands to every area in `task-runner.yaml → task_areas`
2. **Area name** → looked up in `task-runner.yaml → task_areas → {name}.path`
3. **PROMPT.md file** → if arg ends with `PROMPT.md` and file exists, adds that single task
4. **Directory path** → scanned for task subfolders (skips `archive/` subdirectory)

Multiple arguments are combined. Duplicate paths are deduplicated.
A single PROMPT.md is valid — the orchestrator creates one lane, one wave, one task.

### Usage Examples

```
# Run all pending tasks across all areas defined in task-runner.yaml
/orch all

# Run tasks from specific areas (names from task-runner.yaml → task_areas)
/orch time-off performance-management
#   → resolves to:
#     docs/task-management/domains/time-off/tasks/
#     docs/task-management/domains/performance-management/tasks/
#   → scans each for subdirectories containing PROMPT.md (without .DONE)
#   → skips archive/ subdirectories entirely
#   → builds dependency graph across both areas
#   → computes waves and begins execution

# Run tasks from a specific folder path (bypass area name lookup)
/orch docs/task-management/domains/time-off/tasks

# Mix area names and paths
/orch time-off docs/task-management/platform/notifications/tasks

# Run a single task by pointing directly to its PROMPT.md
/orch docs/task-management/domains/time-off/tasks/TO-014-accrual-engine/PROMPT.md
#   → one task, one lane, one wave — still gets worktree isolation and merge-back

# Preview the execution plan without executing
/orch-plan time-off notifications
#   → shows: tasks found, dependency graph, waves, lane assignments

# Resume after fixing a merge conflict
/orch-resume

# See all TMUX sessions (from a separate terminal window)
tmux list-sessions | grep orch-

# Attach to a lane to see its task-runner dashboard
tmux attach -t orch-lane-1

# Watch the current worker in real time
tmux attach -t orch-lane-1-worker

# Detach without stopping anything
# Press: Ctrl+B, then d
```

---

## 11. Configuration

### 11.1 `task-orchestrator.yaml`

```yaml
# ═══════════════════════════════════════════════════════════════════════
# Parallel Task Orchestrator Configuration
# ═══════════════════════════════════════════════════════════════════════

orchestrator:
  # Maximum parallel lanes (worktrees). Each lane is ~30 MB disk.
  # Recommended: 2-4 depending on CPU/memory available.
  max_lanes: 3

  # Where to create worktree directories.
  # "sibling"       = ../{prefix}-{N}          (alongside main repo, e.g. ../taskplane-wt-1)
  # "subdirectory"  = .worktrees/{prefix}-{N}  (inside repo, gitignored, e.g. .worktrees/taskplane-wt-1)
  worktree_location: "subdirectory"
  worktree_prefix: "taskplane-wt"

  # Batch ID format. Used in branch names and logs.
  # "timestamp" = 20260308T111750
  # "sequential" = batch-001, batch-002, ...
  batch_id_format: "timestamp"

  # How to spawn lane and agent subprocesses.
  # "tmux"       = Each subprocess runs in a named TMUX session.
  #                User can attach to any session for live visibility.
  #                Requires: tmux installed and functional.
  # "subprocess" = Headless subprocesses (no TMUX required).
  #                Parallel execution and worktrees still work.
  #                No drill-down observability (dashboard only).
  spawn_mode: "tmux"

  # Prefix for TMUX session names. All sessions are named:
  #   {tmux_prefix}-lane-{N}, {tmux_prefix}-lane-{N}-worker, etc.
  # Use a unique prefix to avoid collisions with user TMUX sessions.
  tmux_prefix: "orch"

# ── Dependency Analysis ────────────────────────────────────────────────

dependencies:
  # How to determine task dependencies.
  # "prompt" = parse ## Dependencies from PROMPT.md (fast, no agent needed)
  # "agent"  = spawn an agent to analyze all PROMPT.md files (thorough)
  source: "prompt"

  # Cache dependency analysis to dependencies.json per task area.
  cache: true

  # Force re-analysis even if cache exists.
  # refresh: false  # (use /orch-deps --refresh instead)

# ── Lane Assignment ────────────────────────────────────────────────────

assignment:
  # Strategy for assigning tasks to lanes within a wave.
  # "affinity-first" = group by file scope overlap, then round-robin
  # "round-robin"    = simple round-robin (ignores file scope)
  # "load-balanced"  = assign by estimated duration (task size)
  strategy: "affinity-first"

  # Task size weights for load-balanced assignment.
  size_weights:
    S: 1
    M: 2
    L: 4

# ── Pre-warming ────────────────────────────────────────────────────────

pre_warm:
  # Run these commands in each worktree before starting tasks.
  # Commands run relative to the worktree root.
  # Use {lane} placeholder for lane number.
  
  # Auto-detect which commands to run based on task file scope.
  auto_detect: true

  # Commands to run if auto-detect determines they're needed.
  commands:
    go_deps: "go mod download"           # If task touches services/
    npm_deps: "cd web && npm ci"          # If task touches web/
    # go_build: "go build ./..."          # Optional: pre-compile

  # Always run these regardless of file scope.
  always: []

# ── Merge ──────────────────────────────────────────────────────────────

merge:
  # Model for merge agents. Empty = inherit from parent Pi session.
  model: ""
  tools: "read,write,edit,bash,grep,find,ls"

  # Verification commands run after each merge.
  # All must pass or the merge is reverted.
  verify:
    - "go build ./..."
    # - "cd web && npm run type-check"    # Enable when frontend tasks are common

  # Merge order heuristic.
  # "fewest-files-first" = lanes with fewer changed files merge first
  # "sequential"         = merge in lane number order
  order: "fewest-files-first"

# ── Failure Handling ───────────────────────────────────────────────────

failure:
  # What to do when a task fails.
  # "skip-dependents" = mark failed, remove downstream tasks, continue wave
  # "stop-wave"       = let current wave finish, don't start next
  # "stop-all"        = kill all lanes immediately
  on_task_failure: "skip-dependents"

  # What to do when a merge fails.
  # "pause" = pause batch, wait for user intervention
  # "abort" = abort entire batch
  on_merge_failure: "pause"

  # Minutes of no STATUS.md changes before declaring a lane stalled.
  stall_timeout: 30

  # Maximum minutes for a single worker iteration in TMUX mode.
  # In subprocess mode, context % tracking handles this via kill_percent.
  # In TMUX mode, there's no context % visibility, so wall-clock timeout
  # is the safety net. Default 30 minutes per worker iteration.
  max_worker_minutes: 30

  # Seconds to wait for graceful shutdown on /orch-abort before force-killing.
  abort_grace_period: 60

# ── Monitoring ─────────────────────────────────────────────────────────

monitoring:
  # How often to poll STATUS.md files in worktrees (seconds).
  poll_interval: 5

  # Write batch progress to this file (for external monitoring).
  # progress_file: "batch-progress.json"
```

### 11.2 Integration with Existing Config

The orchestrator reads **both** `task-orchestrator.yaml` and `task-runner.yaml`:

- `task-runner.yaml` → task areas, reference docs, worker/reviewer config
- `task-orchestrator.yaml` → lane count, merge strategy, failure handling

This separation means the task-runner extension continues to work independently
for single-task execution (`/task`). The orchestrator is an optional layer on top.

---

## 12. PROMPT.md Additions

Two optional sections are added to the PROMPT.md template for orchestrator
awareness. Both are backward-compatible — the single-task runner ignores them.

### 12.1 File Scope

```markdown
## File Scope

Files and directories this task will modify. Used by the orchestrator for
parallel lane assignment (tasks with overlapping scope run in the same lane).

- services/time-service/**
- docs/api/time-service-api.md
- web/src/pages/time-off/**
- web/src/stores/timeoff.ts
```

### 12.2 Dependencies (already exists, formalize format)

```markdown
## Dependencies

- **Task:** TO-014 — PTO policy engine must exist
- **Task:** employee-management/EM-003 — Employee batch endpoint needed
- **None**
```

Rules:
- Prefer unqualified `TASK-ID` when globally unique
- Use `area-name/TASK-ID` when cross-area IDs may be ambiguous
- If orchestrator reports `DEP_AMBIGUOUS`, update dependency entries to the
  area-qualified form

---

## 13. Runtime Dependencies & Packaging

The orchestrator has hard dependencies beyond Pi itself. This section documents
what's required, how to verify it, and platform-specific installation guidance
for packaging this system for other users.

### 13.1 Dependency Matrix

| Dependency | Required By | Minimum Version | Purpose |
|---|---|---|---|
| **Pi** | Everything | Latest stable | Agent runtime, extension host |
| **Git** | Worktree management | 2.15+ | `git worktree` (added in 2.5), `--no-ff` merge |
| **TMUX** | Observability layer | 2.6+ | Session management, detach/attach |
| **Bash-compatible shell** | TMUX session commands | Any | TMUX spawns commands through a shell |
| **Node.js** | Pi + extensions | 20+ | Extension runtime (TypeScript via Pi) |

Optional dependencies (needed only for specific tasks, not the orchestrator):

| Dependency | Required When | Purpose |
|---|---|---|
| Go toolchain | Tasks touching Go services | `go build`, `go test` in verification |
| npm / Node.js | Tasks touching `web/` | `npm ci`, `npm run type-check` in verification |
| golangci-lint | Go tasks with lint step | Code quality verification |

### 13.2 Preflight Check

The orchestrator runs a preflight check on `/orch` before any execution.
All hard dependencies must pass or the batch is aborted with actionable error
messages.

```typescript
interface PreflightResult {
    passed: boolean;
    checks: {
        name: string;
        status: "pass" | "fail" | "warn";
        version?: string;
        message: string;
        installHint?: string;
    }[];
}

function runPreflight(): PreflightResult {
    const checks = [];

    // Git
    const gitVersion = exec("git --version");       // "git version 2.43.0"
    checks.push(checkMinVersion("git", gitVersion, "2.15"));

    // Git worktree support
    const worktreeTest = exec("git worktree list");
    checks.push({ name: "git-worktree", status: worktreeTest.ok ? "pass" : "fail",
        message: worktreeTest.ok ? "Worktree support available" : "Git worktree not available",
        installHint: "Upgrade Git to 2.15+" });

    // TMUX
    const tmuxVersion = exec("tmux -V");             // "tmux 3.3a"
    checks.push(checkMinVersion("tmux", tmuxVersion, "2.6"));

    // TMUX server reachable (can we create sessions?)
    const tmuxTest = exec("tmux new-session -d -s orch-preflight-test 'exit 0'");
    if (tmuxTest.ok) exec("tmux kill-session -t orch-preflight-test");
    checks.push({ name: "tmux-functional", status: tmuxTest.ok ? "pass" : "fail",
        message: tmuxTest.ok ? "TMUX can create sessions" : "TMUX server not reachable" });

    // Pi (already running, but check version)
    const piVersion = exec("pi --version");
    checks.push({ name: "pi", status: "pass", version: piVersion, message: "Pi available" });

    return { passed: checks.every(c => c.status !== "fail"), checks };
}
```

Preflight output example:

```
Preflight Check:
  ✅ git          2.43.0   Git available
  ✅ git-worktree          Worktree support available
  ✅ tmux         3.3a     TMUX available
  ✅ tmux-functional       TMUX can create sessions
  ✅ pi           1.2.3    Pi available
  ⚠️  go           —       Not found (needed if tasks touch services/)
                            Install: https://go.dev/doc/install

All required checks passed. Starting batch...
```

### 13.3 Platform-Specific Installation

#### Linux

All dependencies available via native package managers:

```bash
# Debian/Ubuntu
sudo apt install git tmux

# Fedora/RHEL
sudo dnf install git tmux

# Arch
sudo pacman -S git tmux

# Pi (via npm)
npm install -g @mariozechner/pi-coding-agent
```

TMUX and Git are standard packages on all major Linux distributions.
No special configuration needed.

#### macOS

```bash
# Homebrew (recommended)
brew install git tmux

# Pi
npm install -g @mariozechner/pi-coding-agent
```

macOS ships with Git, but the Homebrew version is typically newer.
TMUX is not included by default — Homebrew install is required.

#### Windows

Windows requires a POSIX-compatible environment for TMUX. There are two options:

**Option A: MSYS2 / Git Bash (recommended for this project)**

Git for Windows ships with MSYS2, which provides a bash shell and can run
Windows-native ports of Unix tools. TMUX is available as an MSYS2 package but is
**not included by default** in Git for Windows.

```bash
# If using standalone MSYS2:
pacman -S tmux

# If using Git Bash only (no pacman):
# Download pre-built tmux.exe for MSYS2 from:
#   https://packages.msys2.org/package/tmux
# Place tmux.exe and its dependencies (msys-event_core-*.dll) in
# a directory on your PATH (e.g., ~/bin or /usr/bin)
```

Verify it works:

```bash
# In Git Bash:
tmux -V                              # Should print version
tmux new-session -d -s test "echo ok"
tmux has-session -t test && echo "TMUX works"
tmux kill-session -t test
```

Key facts about Git Bash TMUX:
- Runs as a native Windows `.exe` (PE32+), NOT through WSL
- Uses the MSYS2 POSIX translation layer (`msys-2.0.dll`)
- Sees Windows paths as `/c/dev/...` (standard MSYS2 path translation)
- Shares filesystem with native Windows processes — no cross-boundary issues
- Pi, Git, and all other tools work normally within TMUX sessions

**Option B: WSL (Windows Subsystem for Linux)**

```bash
# Inside WSL:
sudo apt install tmux git
npm install -g @mariozechner/pi-coding-agent
```

WSL works but introduces filesystem boundary considerations:
- Windows files accessed from WSL via `/mnt/c/` have performance overhead
- Git operations on `/mnt/c/` are slower than on native Linux filesystem
- Recommended: clone the repo inside WSL's filesystem (`~/projects/`)

**Option C: Without TMUX (fallback)**

If TMUX is unavailable, the orchestrator can fall back to `subprocess` mode
(headless Pi processes, same as current task-runner behavior). Parallel execution
and worktree isolation still work — only the drill-down observability is lost.

```yaml
# .pi/task-orchestrator.yaml
orchestrator:
  spawn_mode: "subprocess"   # Headless mode — no TMUX required
```

### 13.4 Packaging Checklist

For distributing the orchestrator as a Pi package or standalone tool:

| Item | How |
|---|---|
| Extension code | `extensions/task-orchestrator.ts` in a Pi package |
| Agent definitions | `.pi/agents/task-merger.md` |
| Config template | `.pi/task-orchestrator.yaml` with documented defaults |
| Preflight check | Built into extension, runs on first `/orch` |
| Platform docs | README with per-platform install instructions |
| TMUX fallback | `spawn_mode: subprocess` for environments without TMUX |
| Version constraints | `pi` field in `package.json` if Pi supports engine constraints |

### 13.5 Windows-Specific Considerations

These apply regardless of TMUX source (MSYS2 or WSL):

**Path length:** Windows has a default 260-character path limit. Worktree paths
are well within limits (~97 chars for deepest Go files), but `node_modules` can
exceed 260. Mitigation:

```bash
git config core.longpaths true
```

**File locking:** Windows locks open files more aggressively than Unix. If an
IDE has a file open in the main worktree, it won't affect other worktrees
(different directories). But if cleanup runs while an agent has a file open,
`git worktree remove` may fail. Mitigation: the orchestrator retries removal
with exponential backoff.

**Antivirus / Defender:** Windows Defender real-time scanning of new files can
slow worktree creation. The ~2,875 file checkout may take 5-10 seconds instead
of <1 second. This is a one-time cost per wave and acceptable. Users can add
worktree directories to Defender exclusions for better performance.

---

## 14. Sequence Diagram — Complete Wave

```
Orchestrator          TMUX: orch-lane-1   TMUX: orch-lane-2   Merge Worktree
     │                     │                    │                  │
     │─── git worktree ───►│                    │                  │
     │─── git worktree ───►│───────────────────►│                  │
     │                     │                    │                  │
     │─── tmux new ───────►│                    │                  │
     │    (TASK_AUTOSTART)  │                    │                  │
     │─── tmux new ────────│───────────────────►│                  │
     │    (TASK_AUTOSTART)  │                    │                  │
     │                     │                    │                  │
     │  [poll STATUS.md +   │                    │                  │
     │   lane-state JSON +  │                    │                  │
     │   tmux has-session]  │                    │                  │
     │◄── STATUS.md ───────│                    │                  │
     │◄── lane-state.json ─│                    │                  │
     │◄── conversation.jsonl│                    │                  │
     │                     │                    │                  │
     │    ... web dashboard at localhost:8099 shows live stats ... │
     │    ... tasks execute in parallel ...     │                  │
     │                     │                    │                  │
     │◄── .DONE ───────────│                    │                  │
     │    (session exits)   │                    │                  │
     │                     │                    │                  │
     │    ... wait for lane 2 ...               │                  │
     │                     │                    │                  │
     │◄── .DONE ───────────│────────────────────│                  │
     │    (session exits)   │                    │                  │
     │                     │                    │                  │
     │    [all lanes done — create isolated merge worktree]       │
     │                     │                    │                  │
     │─── git branch _merge-temp ──────────────────────────────────│
     │─── git worktree add ────────────────────────────────────────►│
     │                     │                    │                  │
     │─── tmux new (merge-1, cwd=merge-wt) ───────────────────────►│
     │    agent merges lane-1 into _merge-temp  │                  │
     │◄── result file (.pi/) ──────────────────────────────────────│
     │    (session exits)   │                    │                  │
     │                     │                    │                  │
     │─── tmux new (merge-2, cwd=merge-wt) ───────────────────────►│
     │    agent merges lane-2 into _merge-temp  │                  │
     │◄── result file (.pi/) ──────────────────────────────────────│
     │    (session exits)   │                    │                  │
     │                     │                    │                  │
     │─── git merge --ff-only _merge-temp (in main repo)          │
     │    develop now has all lane work         │                  │
     │                     │                    │                  │
     │─── git worktree remove merge-workspace ─────────────────────X
     │─── git branch -D _merge-temp            │                  │
     │                     │                    │                  │
     │─── reset wt-1 ─────►│                    │                  │
     │─── reset wt-2 ─────►│───────────────────►│                  │
     │                     │                    │                  │
     │    [next wave...]   │                    │                  │
```

---

## 15. Comparison with Previous System

| Aspect | ralph-orchestrator.ps1 | Parallel Task Orchestrator |
|--------|------------------------|----------------------------|
| **Execution engine** | PowerShell jobs calling run-wiggum.ps1 | Pi extension spawning TMUX sessions |
| **File isolation** | ❌ None — same directory | ✅ Git worktrees per lane |
| **Git conflicts** | ❌ Agents commit to same branch | ✅ Separate branch per lane, sequential merge |
| **Merge strategy** | None — single branch | Merge agents with conflict resolution |
| **Dependency analysis** | Agent-analyzed, cached | PROMPT.md-declared + agent fallback |
| **Dashboard** | Console logging | Live Pi TUI widget (orchestrator level) |
| **Observability** | Log files only | TMUX drill-down: lane → worker → reviewer |
| **Failure handling** | Stop on first failure | Configurable: skip-dependents / stop-wave / stop-all |
| **Stall detection** | Timeout per task (max minutes) | STATUS.md change monitoring |
| **Resume capability** | None — restart from beginning | Full: /orch-resume continues from last state |
| **Terminal disconnect** | Kills everything | TMUX sessions survive (reconnect on resume) |
| **Persistent memory** | STATUS.md | STATUS.md (unchanged) |
| **Worker model** | Same for all | Per-task-runner config (unchanged) |
| **Review model** | N/A (ralph didn't review) | Cross-model review (unchanged, per task-runner) |
| **Cross-platform** | Windows only (PowerShell) | Any platform with TMUX + Git (fallback: subprocess) |

---

## 16. Implementation Plan

### Phase 1: Core Orchestrator (MVP)

1. **`task-orchestrator.ts`** — Extension with `/orch`, `/orch-plan`, `/orch-status`, `/orch-pause`, `/orch-abort`, `/orch-sessions`
2. **`task-orchestrator.yaml`** — Configuration file with defaults
3. **Preflight check** — Verify git, tmux, pi dependencies on startup
4. **Worktree lifecycle** — Create, update, remove (with retry/backoff on Windows)
5. **Wave computation** — Dependency parsing from PROMPT.md, topological sort, cycle detection
6. **TMUX lane spawning** — Create TMUX sessions per lane with `TASK_AUTOSTART` env var
7. **Progress monitoring** — STATUS.md polling + `tmux has-session` liveness checks
8. **Dashboard widget** — Multi-lane progress with TMUX session name labels

### Phase 2: task-runner.ts Modifications

1. **`TASK_AUTOSTART` env var** — Auto-execute `/task` on session start
2. **Dual spawn mode** — `spawnAgentTmux()` alongside existing `spawnAgentSubprocess()`
3. **`spawn_mode` config** — Read from `task-runner.yaml` or `TASK_RUNNER_SPAWN_MODE` env var
4. **TMUX session lifecycle** — Create named sessions for workers/reviewers, poll for exit
5. **Kill via TMUX** — `tmux kill-session -t name` as alternative to process kill

### Phase 3: Merge Agents

1. **`task-merger.md`** — Agent definition (system prompt, tools, result format)
2. **Merge TMUX sessions** — Each merge agent in `orch-merge-{N}` session
3. **Sequential merge orchestration** — Wait for each merge before starting next
4. **Conflict detection & classification** — Auto-resolve trivial, abort on real
5. **Post-merge verification** — Run configurable build/type-check commands
6. **Merge result handling** — Parse result files, route success/failure

### Phase 4: State Persistence & Resume

1. **`.pi/batch-state.json`** — Write/update on every state change (§17.5)
2. **`/orch-resume`** — Reconstruct from state file, detect orphan TMUX sessions
3. **Orphan detection** — Check for `orch-*` sessions on `/orch` start
4. **Graceful abort** — `/orch-abort` writes wrap-up files, waits, then force-kills (§17.7)
5. **Hard abort** — `/orch-abort --hard` immediate kill

### Phase 5: Refinements

1. **File scope parsing & affinity assignment** — Lane conflict avoidance
2. **Pre-warming** — Auto-detect and install dependencies per worktree
3. **Stall detection** — STATUS.md mtime monitoring with configurable timeout
4. **Subprocess fallback** — `spawn_mode: subprocess` for environments without TMUX
5. **`scripts/setup-tmux.sh`** — TMUX installation helper for Windows/MSYS2 (§17.6)
6. **Batch progress file** — JSON output for external monitoring/CI integration

---

## 17. Design Decisions

Resolved from initial open questions during design review.

### 17.1 Worktree Location → Subdirectory (Inside Repo)

**Decision:** Subdirectory mode (`.worktrees/taskplane-wt-1`, `.worktrees/taskplane-wt-2`).

**Rationale (updated from initial "sibling" decision):** The original sibling
approach (`../taskplane-wt-*`) placed worktrees outside the project root,
making them invisible to VS Code and other IDE file explorers. Moving to
`.worktrees/` inside the repo (gitignored) keeps worktrees discoverable by the
IDE while avoiding git tracking. The `.worktrees/` directory is added to
`.gitignore`.

**Manual step for developers:** because `.vscode/` is gitignored in this repo,
VS Code explorer hiding is local-only. Add this to your local
`.vscode/settings.json` if you want worktrees hidden from Explorer:

```json
{
  "files.exclude": {
    "**/.worktrees": true
  }
}
```

The `"sibling"` mode remains available via config for environments where
nested worktrees are problematic.

**Naming invariant:** Worktree basenames follow `{prefix}-{N}` (e.g.,
`taskplane-wt-1`), where `prefix` is from `worktree_prefix` config and
`N` is the lane number. No `-wt-` suffix is appended (avoids double-wt
like `taskplane-wt-wt-1`).

### 17.2 Go Build Cache → Shared (No Isolation)

**Decision:** Let lanes share the default Go build cache (`GOCACHE`). Do NOT
isolate per lane.

**Rationale:** Go's build cache uses content-addressable storage — files are
keyed by the hash of their inputs, not by project path. Two concurrent
`go build` commands in different worktrees produce the same cache keys for the
same source files. This means:

- **No corruption risk.** Two lanes building the same package write identical
  cache entries. Go handles concurrent writes gracefully (atomic rename).
- **Faster second builds.** After Lane 1 compiles `identity-service`, Lane 2
  gets a cache hit on shared packages, cutting build time significantly.
- **Minor lock contention.** Under high parallelism (4+ lanes building
  simultaneously), there may be brief filesystem lock waits. This is negligible
  compared to LLM API latency.

If profiling reveals build cache issues at higher lane counts, add a config
option to set `GOCACHE` per lane. Not needed for 3 lanes.

### 17.3 Maximum Lanes → 3 (Start Small)

**Decision:** Default `max_lanes: 3`. Increase based on observed rate limit
behavior.

**Rationale:** 3 lanes means up to 3 concurrent workers + up to 3 concurrent
reviewers = 6 simultaneous LLM API calls in the worst case (all lanes
reviewing at once). Most providers handle this, but burst capacity varies.
Start conservative and increase after confirming:

- No HTTP 429 (rate limit) responses from the LLM provider
- Local machine handles 6 concurrent Pi processes without memory pressure
- TMUX server handles 10+ sessions without issues

The `max_lanes` config makes this easy to adjust without code changes.

### 17.4 Reviewer Sharing → Separate Per Lane

**Decision:** Each lane spawns its own reviewer subprocess (unchanged from
single-task behavior).

**Rationale:** A shared reviewer would serialize all reviews across lanes,
defeating parallelism. Since reviews are short-lived (30-120 seconds) and
infrequent (once or twice per step), the overhead of separate reviewer processes
is minimal. Each lane's task-runner manages its own reviewer lifecycle
independently — no coordination needed.

### 17.5 Batch State Persistence → State File + Orphan Detection

**Decision:** Combine state file persistence with TMUX orphan detection for a
resilient resume experience.

**Implementation:**

```
On /orch start:
  1. Write .pi/batch-state.json with:
     - Batch ID, start time
     - Task registry (all tasks with their assignments)
     - Wave plan (which tasks in each wave)
     - Lane assignments (which lane → which worktree → which tasks)
     - Current wave number
     - Per-task status: pending | running | complete | failed
  2. Update batch-state.json after every state change:
     - Task completes → update status, increment wave progress
     - Wave merges → record merge results
     - Lane fails → record failure

On /orch-resume (or fresh /orch detecting existing state):
  1. Read .pi/batch-state.json
  2. Check for orphaned TMUX sessions: tmux list-sessions | grep orch-
     a. If orphan sessions exist AND batch-state.json exists:
        → Notify user: "Found running batch. Resume? (Y/n)"
        → If yes: reconnect monitoring to existing sessions
        → If no: kill orphans, clean up, start fresh
     b. If orphan sessions exist but NO batch-state.json:
        → Notify user: "Found orphan TMUX sessions from a previous batch."
        → Offer to kill them
     c. If no orphans but batch-state.json exists:
        → Sessions finished while orchestrator was disconnected
        → Check .DONE files and STATUS.md to determine what completed
        → Resume from next incomplete task/wave
  3. Reconstruct orchestrator state from batch-state.json
  4. Skip completed tasks (via .DONE files + state file)
  5. Resume execution from current wave

On batch complete or /orch-abort:
  1. Delete .pi/batch-state.json (clean state)
```

**What survives a terminal disconnect:**
- TMUX sessions keep running (server-side processes)
- STATUS.md checkpoints are on disk
- .DONE files mark completed tasks
- batch-state.json preserves wave/lane assignments
- Git commits from workers are in the worktree branches

**What's lost:** The orchestrator's in-memory dashboard state and monitoring
loop. On resume, the dashboard rebuilds from batch-state.json and STATUS.md
polling.

### 17.6 TMUX on Windows → Setup Script

**Decision:** Provide `scripts/setup-tmux.sh` (bash script for Git Bash / MSYS2)
that downloads and installs the MSYS2 TMUX package automatically. Also document
manual installation as fallback.

**Implementation:**

```bash
#!/bin/bash
# scripts/setup-tmux.sh — Install TMUX for Git Bash / MSYS2 on Windows
#
# Run from Git Bash: bash scripts/setup-tmux.sh

if command -v tmux &>/dev/null; then
    echo "TMUX is already installed: $(tmux -V)"
    exit 0
fi

# Detect environment
if [ -f /usr/bin/pacman ]; then
    echo "MSYS2 detected — installing via pacman..."
    pacman -S --noconfirm tmux
elif [ -f /usr/bin/msys-2.0.dll ] || [ -f /c/Program\ Files/Git/usr/bin/msys-2.0.dll ]; then
    echo "Git Bash detected (no pacman). Downloading TMUX binary..."
    # Download pre-built TMUX + libevent from MSYS2 package repo
    # Install to ~/bin (should be on PATH in Git Bash)
    mkdir -p ~/bin
    echo "Please install MSYS2 (https://www.msys2.org/) and run: pacman -S tmux"
    echo "Or download tmux.exe manually from https://packages.msys2.org/package/tmux"
    exit 1
else
    echo "Not running in MSYS2 or Git Bash. TMUX requires a POSIX environment."
    echo "Options: Install MSYS2, use WSL, or set spawn_mode: subprocess"
    exit 1
fi

echo "Verifying: $(tmux -V)"
echo "TMUX installed successfully."
```

The preflight check (§13.2) detects missing TMUX and prints the setup command.
Users on Linux/macOS just `apt install tmux` or `brew install tmux`.

### 17.7 Abort Behavior → Graceful Default, Hard Flag

**Decision:** `/orch-abort` is graceful (checkpoint, then stop). `/orch-abort --hard`
kills immediately.

| Command | Behavior |
|---------|----------|
| `/orch-abort` | Signal each lane to stop after its current checkpoint. Workers see the wrap-up file, finish their current item, commit, then exit. TMUX sessions close on their own. Orchestrator waits up to 60 seconds, then force-kills any remaining sessions. Worktrees and branches preserved. |
| `/orch-abort --hard` | Immediately kill all `orch-*` TMUX sessions (`tmux kill-session`). No checkpoint opportunity. Worktrees and branches preserved (last git commit is the recovery point). |

**Implementation in the extension:**

```typescript
pi.registerCommand("orch-abort", {
    description: "Abort batch execution (--hard for immediate kill)",
    handler: async (args, ctx) => {
        const hard = args?.trim() === "--hard";
        
        if (hard) {
            // Kill all orch-* TMUX sessions immediately
            const sessions = listOrchSessions();
            for (const s of sessions) {
                spawnSync("tmux", ["kill-session", "-t", s]);
            }
            ctx.ui.notify(`Hard abort: killed ${sessions.length} sessions`, "warning");
        } else {
            // Graceful: write wrap-up files for each active lane
            for (const lane of activeLanes) {
                const wrapUpPath = join(lane.worktree, lane.taskFolder, ".task-wrap-up");
                const legacyWrapUpPath = join(lane.worktree, lane.taskFolder, ".wiggum-wrap-up");
                writeFileSync(wrapUpPath, `Abort requested at ${new Date().toISOString()}`);
                // Backward compatibility during migration window
                writeFileSync(legacyWrapUpPath, `Abort requested at ${new Date().toISOString()}`);
            }
            ctx.ui.notify("Abort signal sent. Waiting for checkpoints (60s max)...", "info");
            
            // Wait up to 60 seconds for sessions to exit gracefully
            const deadline = Date.now() + 60_000;
            while (Date.now() < deadline) {
                const remaining = listOrchSessions();
                if (remaining.length === 0) break;
                await sleep(2000);
            }
            
            // Force-kill any that didn't exit
            const stragglers = listOrchSessions();
            for (const s of stragglers) {
                spawnSync("tmux", ["kill-session", "-t", s]);
            }
            if (stragglers.length > 0) {
                ctx.ui.notify(`Force-killed ${stragglers.length} sessions after timeout`, "warning");
            }
        }
        
        // Clean up state
        state.phase = "aborted";
        cleanupBatchState();  // Delete .pi/batch-state.json
        // Worktrees and branches are preserved for manual inspection
        updateWidgets();
    },
});

function listOrchSessions(): string[] {
    const result = spawnSync("tmux", ["list-sessions", "-F", "#{session_name}"]);
    if (result.status !== 0) return [];
    return result.stdout.toString().trim().split("\n")
        .filter(name => name.startsWith(state.config.tmux_prefix + "-"));
}
```

Note: Pi extension commands receive arguments as a single string (`args`).
The handler splits on whitespace or checks for known flags. `--hard` is simple
enough to parse with `args?.trim() === "--hard"`.
