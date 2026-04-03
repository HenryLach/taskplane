# Merge and Conflict Resolution

When parallel tasks complete in a wave, their work must be combined. Taskplane
uses an **LLM-powered merge agent** — a full AI agent that understands code
semantics — to merge lane branches into the orch branch. This is the key
enabler of safe parallel task execution.

---

## Why traditional merge isn't enough

Standard `git merge` uses 3-way text comparison. It handles non-overlapping
changes well, but when two workers modify the same region of a file, it produces
conflict markers and gives up:

```
<<<<<<< HEAD (orch branch)
function process(data) {
  validate(data);
  return transform(data);
}
=======
function process(data, options) {
  return transform(data, options);
}
>>>>>>> task/lane-2 (worker B)
```

Worker A added validation. Worker B added an options parameter. A text-based
merge can't know these are complementary changes. A human (or an LLM that
understands code) can produce the correct resolution:

```typescript
function process(data, options) {
  validate(data);
  return transform(data, options);
}
```

This is what Taskplane's merge agent does.

---

## Merge lifecycle

### 1. Trigger

The merge phase begins after all tasks in a wave reach a terminal state
(succeeded, failed, or skipped). Only lanes with at least one succeeded task
participate in the merge.

### 2. Merge worktree

The engine creates a temporary merge worktree on the orch branch:

```
.worktrees/{batchId}/merge/
```

This isolates the merge operation from the user's working directory and from
the lane worktrees (which are preserved for debugging if needed).

### 3. Merge request

The engine generates a **merge request file** that the merge agent reads. It
contains:

- The orch branch name (merge target)
- Each lane branch to merge (in order)
- The task IDs completed on each lane
- Instructions for conflict resolution strategy
- The verification command to run after merge (if configured)

### 4. Merge agent execution

The merge agent is spawned as a subprocess with full tool access (`read`,
`write`, `edit`, `bash`, `grep`, `find`, `ls`). It works through each lane
branch:

**Clean merge (no conflicts):**
```bash
git merge --no-ff task/henrylach-lane-1-{batchId}
# Fast-forward or auto-merge succeeds → commit created
```

**Conflict merge:**
```bash
git merge --no-ff task/henrylach-lane-2-{batchId}
# CONFLICT in src/processor.ts
# The agent:
# 1. Reads the conflict markers in the file
# 2. Reads both workers' PROMPT.md to understand intent
# 3. Examines the diff from each lane branch
# 4. Edits the file to resolve the conflict semantically
# 5. Runs git add + git commit to complete the merge
```

The agent has full context: it can read the task instructions, the STATUS.md
progress, the git log, and the actual code on both sides. This lets it make
informed decisions about how to combine changes.

### 5. Result reporting

After completing all merges, the agent writes a **result JSON file** that the
engine polls for:

```json
{
  "status": "succeeded",
  "mergedLanes": [1, 2, 3],
  "conflictsResolved": 2,
  "verificationPassed": true
}
```

### 6. Artifact staging

The engine stages task completion markers (`.DONE`, updated `STATUS.md`) into
the merge worktree and commits them to the orch branch. These artifacts live
in the canonical task folder path so they're visible after integration.

### 7. Cleanup

Lane worktrees and branches are removed. The merge worktree is removed. The
orch branch now contains all work from the completed wave.

---

## Merge ordering and affinity

### Lane assignment minimizes conflicts

Before merge even happens, the wave planner uses **file-scope affinity** to
minimize conflicts. Tasks that modify overlapping files are assigned to the
**same lane** (serial execution) rather than parallel lanes:

```
TP-201 modifies: src/auth.ts, src/types.ts
TP-202 modifies: src/auth.ts, src/middleware.ts
TP-203 modifies: src/dashboard.ts

→ Lane 1: TP-201 → TP-202 (serial, shared auth.ts)
→ Lane 2: TP-203 (parallel, no overlap)
```

TP-202 sees TP-201's committed code directly — no merge conflict possible.
The only conflicts that reach the merge agent are from genuinely independent
lanes that happen to touch the same code.

### Multi-lane merge order

When multiple lanes exist, the merge agent processes them sequentially. The
order can be configured (e.g., `fewest-files-first` to merge simple lanes
early, reducing the chance of complex conflicts compounding).

---

## Merge health monitor

During the merge phase, a background monitor polls the merge agent every
2 minutes to detect problems early:

| Check | Method |
|-------|--------|
| **Liveness** | Process registry PID check — is the agent process still running? |
| **Activity** | Compare recent output snapshot with previous — has anything changed? |

### Escalation thresholds

| Duration | Event | Action |
|----------|-------|--------|
| 10 min idle | `merge_health_stale` | Warning to supervisor |
| 20 min idle | `merge_health_stuck` | Recommendation to kill and retry |

The monitor emits events but **never kills autonomously**. The supervisor
(human or AI) decides whether to intervene. This prevents premature termination
of a merge agent that's doing legitimate work (e.g., resolving a complex
conflict and running a long test suite).

---

## Verification

### Post-merge verification

If `merge.verify` is configured, the merge agent runs the verification command
(typically the test suite) after completing all merges:

```json
{
  "merge": {
    "verify": "cd extensions && node --test tests/*.test.ts"
  }
}
```

If verification fails:
- The merge agent can attempt to diagnose and fix the issue (a test failing due
  to an incorrect conflict resolution)
- If the fix succeeds, it commits the fix and re-runs verification
- If it can't fix it, it reports failure in the result file

### Why verification matters

A merge can be syntactically correct (no conflict markers, valid code) but
semantically wrong (broken imports, type mismatches, logic errors from combining
two changes). Running the test suite catches these issues immediately, before
the code is integrated into the user's branch.

---

## Failure handling

### Merge timeout

If the merge agent doesn't produce a result within `merge.timeoutMinutes`
(default: 30), the engine considers it failed and applies the failure policy.

### Failure policies

| Policy | Behavior |
|--------|----------|
| `on_merge_failure: pause` (default) | Batch pauses. All state preserved. Supervisor can intervene and resume. |
| `on_merge_failure: abort` | Batch stops. Worktrees preserved for inspection. |

### Supervisor intervention

When a merge fails, the supervisor can:

1. **Diagnose** — read merge agent logs, inspect the merge worktree, check
   which conflicts remained
2. **Manual resolve** — edit files in the merge worktree, run `git add` and
   `git commit` manually
3. **Retry** — resume the batch, which re-spawns the merge agent
4. **Skip** — skip the failed wave and continue (if appropriate)

### Retry behavior

On retry, the merge agent gets a fresh attempt with full context. It may succeed
on retry if the original failure was transient (API timeout, context overflow)
or if the supervisor provided hints via a steering message.

---

## Integration after merge

After all waves complete successfully, the orch branch contains the accumulated
work from every wave. The user integrates it into their working branch:

| Mode | Command | Behavior |
|------|---------|----------|
| Fast-forward | `orch_integrate()` | Moves branch pointer forward (cleanest) |
| Merge commit | `orch_integrate(mode="merge")` | Creates a merge commit |
| Pull request | `orch_integrate(mode="pr")` | Pushes and creates a PR for CI |

The user's working branch is **never modified** during batch execution. This
means:
- The user can continue working in their checkout during a batch
- If a batch fails, the user's branch is clean — no partial work to undo
- Integration is an explicit, reviewable step

---

## Comparison with other approaches

| Approach | Conflict handling | Semantic understanding | Verification |
|----------|-------------------|----------------------|--------------|
| **Taskplane (LLM merge)** | AI reads both sides, resolves semantically | ✅ Full — reads task intent, code context | ✅ Test suite runs post-merge |
| **git merge (3-way)** | Text-based, fails on overlapping regions | ❌ None — purely textual | ❌ Manual |
| **git rerere** | Records and replays past resolutions | ❌ Pattern matching only | ❌ Manual |
| **Shared directory** | No merge — last writer wins | ❌ None | ❌ None |
| **Sequential execution** | No conflicts (one task at a time) | N/A | ✅ But slow |

Taskplane's approach enables genuine parallelism (multiple AI agents working
simultaneously) with the safety guarantees of sequential execution. The merge
agent is the bridge that makes this possible.

---

## Related

- [Waves, Lanes, and Worktrees](waves-lanes-and-worktrees.md) — the full parallel execution model
- [Architecture](architecture.md) — system overview
- [Execution Model](execution-model.md) — single-task lifecycle
- [Persistence and Resume](persistence-and-resume.md) — how merge state is preserved
