# TP-010: Naming Contract — Team-Scale Session and Worktree Naming

**Version:** 1.0
**Created:** 2026-03-15

---

## 1. Problem Statement

When multiple operators (human or CI) run the orchestrator concurrently on the
same machine or against the same repository, naming collisions can occur on:

- **TMUX sessions** (e.g., two operators both create `orch-lane-1`)
- **Worktree directories** (e.g., two operators both create `.worktrees/project-wt-1`)
- **Git branches** (e.g., two operators both create `task/lane-1-20260308T214300`)
- **Merge temp branches** and sidecar files in `.pi/`

Current naming uses a static `tmux_prefix` and `worktree_prefix` from config,
plus a second-granularity timestamp as batch ID. This is sufficient for single-
operator use but creates collision risks at team scale.

---

## 2. Design Goals

1. **Collision-resistant**: No naming collisions between concurrent orchestrator
   runs by different operators on the same machine or repo.
2. **Deterministic**: Given the same inputs, the same names are produced.
3. **Human-readable**: Names remain debuggable in `tmux ls`, `git worktree list`,
   and `git branch --list` output.
4. **Backward-compatible**: Existing single-operator configs continue to work
   without changes. New collision resistance is opt-in or auto-detected.
5. **Minimal invasiveness**: Changes are concentrated in naming generation
   functions; callers continue to use the same interfaces.

---

## 3. Naming Components

### 3.1 Operator Identifier (`opId`)

A short, stable identifier for the operator running the batch.

**Resolution order (first non-empty wins):**

1. `TASKPLANE_OPERATOR_ID` environment variable (explicit override)
2. `operator_id` field in `.pi/task-orchestrator.yaml` → `orchestrator.operator_id`
3. Current OS username via `os.userInfo().username` (auto-detected)
4. Fallback: `"op"` (safe default if all above fail)

**Sanitization rules:**
- Lowercase
- Replace non-alphanumeric characters (except hyphens) with hyphens
- Collapse consecutive hyphens
- Trim leading/trailing hyphens
- Truncate to 12 characters (TMUX session name length budget)

**Examples:**
- `TASKPLANE_OPERATOR_ID=ci-runner-1` → `ci-runner-1`
- Username `HenryLach` → `henrylach`
- Username `john.doe` → `john-doe`

### 3.2 Repo Slug (`repoSlug`)

Derived from the repository root directory name. Provides disambiguation when
multiple repos share the same machine.

**Derivation:**
- `basename(repoRoot)` (e.g., `taskplane`, `my-api`)
- Same sanitization as `opId`
- Truncate to 16 characters

**When used:** Only in TMUX session names and worktree paths where cross-repo
collisions are possible. Not used in branch names (branches are repo-scoped).

### 3.3 Batch ID (`batchId`)

Already exists as `YYYYMMDDTHHMMSS`. Retains second-level granularity.

Combined with `opId`, the risk of collision is reduced to: same operator,
same second, same machine — which is operationally negligible (the state file
lock prevents this).

---

## 4. Naming Contract by Artifact

### 4.1 Batch ID

**Current:** `YYYYMMDDTHHMMSS`
**New:** `YYYYMMDDTHHMMSS` (unchanged)

No change needed. The batch ID is already sufficiently unique when combined
with the operator identifier in other artifacts.

### 4.2 TMUX Session Names

**Current (repo mode):** `{tmux_prefix}-lane-{N}` → `orch-lane-1`
**Current (workspace):** `{tmux_prefix}-{repoId}-lane-{N}` → `orch-api-lane-1`

**New (repo mode):** `{tmux_prefix}-{opId}-lane-{N}` → `orch-henrylach-lane-1`
**New (workspace):** `{tmux_prefix}-{opId}-{repoId}-lane-{N}` → `orch-henrylach-api-lane-1`

**Rationale:** `opId` makes sessions collision-resistant across operators.
The `tmux_prefix` already provides user-level namespace control.

**TMUX name constraints:** No periods (`.`) or colons (`:`). The sanitization
rules for `opId` already enforce this (alphanumeric + hyphens only).

### 4.3 Worker/Reviewer Session Names

**Current:** `{sessionName}-worker`, `{sessionName}-reviewer`
**New:** Same convention — derived from the parent session name.

No change to the suffix pattern. The parent session name carries the `opId`,
so children inherit collision resistance.

### 4.4 Merge Session Names

**Current:** `{tmux_prefix}-merge-{laneNumber}` → `orch-merge-1`
**New:** `{tmux_prefix}-{opId}-merge-{laneNumber}` → `orch-henrylach-merge-1`

### 4.5 Lane IDs (logical, for logging and display)

**Current (repo):** `lane-{N}`
**Current (workspace):** `{repoId}/lane-{N}`

**New:** Unchanged. Lane IDs are display-only and scoped to the current batch.
They do not need cross-operator disambiguation since they appear in batch-
scoped contexts (logs, dashboard, STATUS.md).

### 4.6 Worktree Directory Names

**Current:** `{worktree_prefix}-{N}` → `taskplane-wt-1`
**New:** `{worktree_prefix}-{opId}-{N}` → `taskplane-wt-henrylach-1`

**Rationale:** Two operators in the same repo need distinct worktree paths.
Adding `opId` prevents directory collisions.

**Discovery/listing impact:** `listWorktrees()` must be updated to match
the new basename pattern `{prefix}-{opId}-{N}`. For backward compatibility,
it should also match the legacy pattern `{prefix}-{N}` (worktrees from
prior batches that haven't been cleaned up).

### 4.7 Git Branch Names

**Current:** `task/lane-{N}-{batchId}` → `task/lane-1-20260308T214300`
**New:** `task/{opId}-lane-{N}-{batchId}` → `task/henrylach-lane-1-20260308T214300`

**Rationale:** Branches are repo-scoped. Two operators in the same repo
creating branches in the same second would collide. Adding `opId` to the
branch name prevents this.

### 4.8 Merge Temp Branch

**Current:** `_merge-temp-{batchId}`
**New:** `_merge-temp-{opId}-{batchId}` → `_merge-temp-henrylach-20260308T214300`

### 4.9 Sidecar Files (Merge Request/Result, Lane Logs)

**Lane log:** `.pi/orch-logs/{sessionName}-{taskId}.log`
- Session name already carries `opId` → naturally collision-resistant.

**Merge result:** `.pi/merge-result-w{W}-lane{L}-{batchId}.json`
**New:** `.pi/merge-result-w{W}-lane{L}-{opId}-{batchId}.json`

**Merge request:** `.pi/merge-request-w{W}-lane{L}-{batchId}.txt`
**New:** `.pi/merge-request-w{W}-lane{L}-{opId}-{batchId}.txt`

---

## 5. Fallback Rules

### 5.1 When operator metadata is unavailable

| Scenario | Behavior |
|---|---|
| `TASKPLANE_OPERATOR_ID` not set, `operator_id` not in config, `os.userInfo()` throws | Use fallback `"op"` |
| `os.userInfo().username` is empty string | Use fallback `"op"` |
| `os.userInfo().username` sanitizes to empty string | Use fallback `"op"` |
| Running in CI without username set | Set `TASKPLANE_OPERATOR_ID` in CI env |

### 5.2 When repo slug is unavailable

| Scenario | Behavior |
|---|---|
| `basename(repoRoot)` is empty | Use `"repo"` as fallback |
| `basename(repoRoot)` sanitizes to empty | Use `"repo"` as fallback |

### 5.3 Backward compatibility (no `opId` configured)

When `opId` resolves to the fallback `"op"`, names look like:
- `orch-op-lane-1` (TMUX session)
- `taskplane-wt-op-1` (worktree dir)
- `task/op-lane-1-20260308T214300` (branch)

This is a minor naming change from the current pattern. For zero-disruption
backward compatibility, when the resolved `opId` equals `"op"` (the default
fallback), the system MAY omit the `opId` segment entirely to produce names
identical to the current format. **Decision: Include `opId` always** — this
ensures a consistent, predictable naming pattern even for single operators,
and the `"op"` prefix adds minimal visual overhead.

---

## 6. Implementation Scope

### New functions to add

1. **`resolveOperatorId(config, env?)`** in `types.ts` or new `naming.ts`
   - Implements the resolution chain from §3.1
   - Returns sanitized `opId`

2. **`sanitizeNameComponent(raw, maxLen)`** in `types.ts` or `naming.ts`
   - Implements the sanitization rules from §3.1
   - Reusable for both `opId` and `repoSlug`

3. **`resolveRepoSlug(repoRoot)`** in `naming.ts`
   - Derives repo slug from directory name

### Functions to modify

| Function | File | Change |
|---|---|---|
| `generateTmuxSessionName()` | `waves.ts` | Add `opId` parameter |
| `generateBranchName()` | `worktree.ts` | Add `opId` parameter |
| `generateWorktreePath()` | `worktree.ts` | Add `opId` parameter |
| `listWorktrees()` | `worktree.ts` | Match new basename pattern |
| `mergeWave()` | `merge.ts` | Use `opId` in session/file names |
| `allocateLanes()` | `waves.ts` | Pass `opId` through pipeline |

### Config addition

```yaml
orchestrator:
  operator_id: ""  # Optional. Auto-detected from OS username if empty.
```

---

## 7. Length Budget

TMUX session names should stay under ~64 characters for readability in
`tmux ls` output. Worst-case with all components:

```
{tmux_prefix}-{opId}-{repoId}-lane-{N}
orch-ci-runner-01-my-frontend-lane-99
```

= 37 characters. Well within budget.

Branch names:
```
task/{opId}-lane-{N}-{batchId}
task/ci-runner-01-lane-99-20260308T214300
```

= 42 characters. Within git's ~255 character ref name limit.
