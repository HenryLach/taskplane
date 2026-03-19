# Orchestrator-Managed Branch — Implementation Spec

> **Status:** Ready for implementation  
> **Created:** 2026-03-18  
> **GitHub Issue:** #24  
> **Related:** [resilience-architecture.md](taskplane/resilience-architecture.md), [architecture](../../docs/explanation/architecture.md)

---

## 1. Problem Summary

Three issues with the current orchestrator branch model:

1. **Protected branch blindness.** If `/orch` starts on `main`, tasks execute for hours, then merge fails because branch protection blocks the push. Wasted time, wasted tokens.

2. **HEAD disruption.** The merge step fast-forwards the user's current branch in the main checkout (`git merge --ff-only tempBranch` in `repoRoot`). This changes files under VS Code unexpectedly. If the user switches branches during a long run, merge fails or causes conflicts.

3. **Worktree directory collisions.** Two simultaneous batches by the same operator use the same worktree paths (`{prefix}-{opId}-{N}`), because `batchId` is only in branch names, not directory names.

---

## 2. Solution: Orchestrator-Managed Branch

### Core change

The orchestrator creates an ephemeral branch `orch/{opId}-{batchId}` at batch start and does ALL work relative to it:

- **Lane worktrees** branch from `orch/{opId}-{batchId}` (not the user's branch)
- **Wave merges** merge into `orch/{opId}-{batchId}` in a merge worktree (not the main checkout)
- **User's HEAD** is never touched — VS Code stays on whatever branch the user was working on

After the batch completes, the user integrates the orch branch manually (or via `/orch-integrate`).

### Flow diagram

```
User's branch (e.g., feat/foo) ── A ── B      ← NEVER TOUCHED by orch
                                       │
                                  orch starts
                                       │
orch/henry-20260318T140000 ─────────── B       ← created from user's HEAD
                                       │
                                 Wave 1 starts
                                 ┌─────┼─────┐
                                 wt-1  wt-2  wt-3
                                 │     │     │
                                 (tasks execute)
                                 │     │     │
                                 └─────┼─────┘
                                       │
                                 Wave 1 merge (into orch branch, in worktree)
                                       │
orch/henry-20260318T140000 ─── B ── C ── D ── E
                                              │
                                        Wave 2 starts
                                        (worktrees reset to E)
                                        ┌─────┼─────┐
                                        wt-1  wt-2
                                        │     │
                                        (tasks see Wave 1 results)
                                        └─────┘
                                              │
                                        Wave 2 merge
                                              │
orch/henry-20260318T140000 ─── B ── ... ── F ── G
                                                │
                                          Batch complete.
                                          User runs /orch-integrate
```

---

## 3. Batch-Scoped Worktree Containers

### Current naming (collides)

```
.worktrees/taskplane-wt-henry-1/   ← batch 1 and batch 2 both use this
.worktrees/taskplane-wt-henry-2/
```

### New naming (batch-scoped)

```
.worktrees/{opId}-{batchId}/
├── lane-1/
├── lane-2/
└── merge/
```

Example:
```
.worktrees/henry-20260318T140000/
├── lane-1/
├── lane-2/
├── lane-3/
└── merge/
```

Benefits:
- No collisions between concurrent batches
- Clean per-batch cleanup (remove entire directory)
- Merge worktree is inside the container (no separate `merge-workspace-{opId}` naming)
- Obvious which worktrees belong to which batch

---

## 4. `/orch-integrate` Command

After batch completion, the user integrates the orch branch:

```
/orch-integrate              Fast-forward current branch to orch branch
/orch-integrate --merge      Real merge if branches diverged
/orch-integrate --pr         Push orch branch and open PR on GitHub
```

### Branch safety check

`/orch-integrate` reads `baseBranch` from the persisted batch state and compares to the user's current branch:

- ✅ Same branch → proceed
- ⚠️ Different branch → warn and require `--force`

```
⚠ Batch was started from feat/foo, but you're on feat/bar.
  Switch to feat/foo first, or use --force to merge into feat/bar.
```

### Finding the orch branch

The command reads `.pi/batch-state.json` for:
- `orchBranch` — the orch branch name
- `baseBranch` — the branch the user was on when `/orch` started
- `phase` — must be `"completed"` for integration

If no batch state exists or phase isn't completed, show an appropriate message.

### Auto-integration (opt-in config)

```json
{
  "orchestrator": {
    "integration": "manual"   // default
  }
}
```

- `"manual"` — batch completes, user runs `/orch-integrate`
- `"auto"` — batch auto-fast-forwards on completion (fails gracefully if diverged, falls back to manual)

---

## 5. State Schema Changes

### New fields in `OrchBatchRuntimeState`

```typescript
interface OrchBatchRuntimeState {
  // Existing:
  baseBranch: string;       // branch user was on at /orch start

  // New:
  orchBranch: string;       // "orch/{opId}-{batchId}" — the managed branch
}
```

### New fields in `PersistedBatchState`

```typescript
interface PersistedBatchState {
  // Existing:
  baseBranch: string;

  // New:
  orchBranch: string;
}
```

### Config schema addition

```typescript
interface OrchestratorConfig {
  orchestrator: {
    // ... existing fields ...
    integration: "manual" | "auto";  // default: "manual"
  };
}
```

---

## 6. Code Change Map

### 6.1 `types.ts` — Schema + defaults

- Add `orchBranch: string` to `OrchBatchRuntimeState` and `PersistedBatchState`
- Add `integration: "manual" | "auto"` to `OrchestratorConfig.orchestrator`
- Default `integration` to `"manual"`
- Default `orchBranch` to `""` in `freshOrchBatchState()`

### 6.2 `worktree.ts` — Batch-scoped containers

- **`generateWorktreePath()`** — Change signature: accept `batchId`, `laneNumber`.
  Output: `{basePath}/{opId}-{batchId}/lane-{N}` (batch-scoped container)
- **`generateMergeWorktreePath()`** — New function. Output: `{basePath}/{opId}-{batchId}/merge`
- **`listWorktrees()`** — Update pattern matching for new nested structure
- **`removeAllWorktrees()`** — Remove entire batch container directory
- **`generateBranchName()`** — Unchanged (branch names already include batchId)
- **`resolveWorktreeBasePath()`** — Unchanged (still handles sibling vs subdirectory)

### 6.3 `engine.ts` — Orch branch lifecycle

- **Batch start (Phase 1):** After capturing `baseBranch`:
  1. Generate `orchBranch = "orch/{opId}-{batchId}"`
  2. `git branch {orchBranch} {baseBranch}` — create orch branch from user's HEAD
  3. Store `orchBranch` in `batchState`
- **Pass `orchBranch` (not `baseBranch`)** to `executeWave()` and `mergeWaveByRepo()`
  as the base for worktrees and merge target
- **Post-merge worktree reset:** Reset worktrees to `orchBranch` HEAD (not `baseBranch`)
- **Cleanup (Phase 3):** Remove orch branch only if auto-integration succeeded, OR preserve it for manual integration
- **Auto-integration:** If `config.orchestrator.integration === "auto"`:
  1. Fast-forward `baseBranch` to `orchBranch`
  2. If ff fails (diverged), log warning and preserve orch branch for manual integration
  3. If ff succeeds, delete orch branch
- **Post-batch notification:** Show orch branch name and integration instructions

### 6.4 `merge.ts` — Merge into orch branch

- **`mergeWave()`** — The `baseBranch` parameter now receives the orch branch name.
  The temp branch and merge worktree logic stays largely the same, but:
  - `targetBranch = orchBranch` (was `baseBranch`)
  - Fast-forward step changes: ff the orch branch to temp branch (no longer touches
    user's branch in main checkout). Since orch branch isn't checked out in the
    main repo, use `git update-ref refs/heads/{orchBranch} {tempBranchHead}` instead
    of `git merge --ff-only`.
  - Remove the stash/pop logic (no longer needed — we're not touching the main
    checkout's working tree)
- **Merge worktree path:** Use `generateMergeWorktreePath()` for batch-scoped container

### 6.5 `waves.ts` — Base branch resolution

- **`allocateLanes()`** — receives `orchBranch` as base. Creates worktrees branching from orch branch.
- **`resolveBaseBranch()`** — In repo mode, use `orchBranch` directly. In workspace mode,
  the per-repo branch detection still applies (each repo has its own orch branch or falls
  back to `orchBranch`).

### 6.6 `extension.ts` — `/orch-integrate` command

- Register new `/orch-integrate` command
- Arguments: `--merge`, `--pr`, `--force`
- Implementation:
  1. Load batch state from `.pi/batch-state.json`
  2. Verify batch phase is `"completed"`
  3. Extract `orchBranch` and `baseBranch`
  4. Check current branch matches `baseBranch` (unless `--force`)
  5. Default behavior: `git merge --ff-only {orchBranch}`
  6. `--merge`: `git merge {orchBranch}` (real merge)
  7. `--pr`: `git push origin {orchBranch}` + `gh pr create`
  8. On success: delete orch branch + clean up batch state
  9. Show summary

### 6.7 `persistence.ts` — Serialize `orchBranch`

- Add `orchBranch` to serialization/deserialization in `persistRuntimeState()` and `loadPersistedState()`
- Backward compatibility: default `orchBranch` to `""` when loading older state files

### 6.8 `config-loader.ts` / `config-schema.ts` — Integration config

- Add `integration` field to orchestrator config schema
- Default to `"manual"`
- Add to camelCase↔snake_case mapping

### 6.9 `settings-tui.ts` — Integration setting in TUI

- Add "Integration" toggle field in Orchestrator section: `manual` / `auto`

### 6.10 Documentation

- Update `docs/reference/commands.md` — add `/orch-integrate`
- Update `docs/reference/configuration/taskplane-settings.md` — add Integration setting
- Update `README.md` command table

---

## 7. What Does NOT Change

- **Lane branch naming** (`task/{opId}-lane-{N}-{batchId}`) — unchanged
- **Task execution flow** — workers run the same way, just in worktrees that branch from orch branch instead of user branch
- **Merge agent behavior** — same merge request/result protocol, just targeting orch branch
- **Dashboard** — works the same (reads STATUS.md from worktrees and state files)
- **`/orch-pause`, `/orch-resume`, `/orch-abort`** — same semantics
- **Discovery, waves, dependencies** — unchanged

---

## 8. Edge Cases

### Detached HEAD at /orch start
Already handled — `getCurrentBranch()` returns null, batch fails with clear message.

### Protected base branch
No longer matters. Orch never pushes to the user's branch. The user can `/orch-integrate --pr` to create a PR against the protected branch.

### User switches branches during batch
No impact. Orch branch and worktrees are independent of the main checkout's HEAD.

### Concurrent batches
Batch-scoped containers prevent directory collisions. Orch branch names include batchId, so no branch collisions either.

### Resume after crash
Persisted state includes `orchBranch`. Resume picks up from the orch branch. The user's branch is still untouched.

### Workspace/polyrepo mode
Each repo gets its own lane worktrees. The orch branch is per-repo (or per-batch depending on workspace config). The merge worktree is per-repo too. `resolveBaseBranch()` adapts.

---

## 9. Task Decomposition

### Task 1: Schema + Types + Config (TP-020)
- Add `orchBranch` to `OrchBatchRuntimeState`, `PersistedBatchState`, `freshOrchBatchState()`
- Add `integration` to `OrchestratorConfig` with default `"manual"`
- Update `config-schema.ts` with new field
- Update `config-loader.ts` for camelCase↔snake_case
- Add Integration toggle to `settings-tui.ts`
- Tests for schema, defaults, serialization round-trip

**Dependencies:** None  
**Size:** M  
**File scope:** `types.ts`, `config-schema.ts`, `config-loader.ts`, `settings-tui.ts`, tests

### Task 2: Batch-Scoped Worktree Containers (TP-021)
- Refactor `generateWorktreePath()` to use `{basePath}/{opId}-{batchId}/lane-{N}`
- New `generateMergeWorktreePath()` → `{basePath}/{opId}-{batchId}/merge`
- Update `listWorktrees()` for nested structure
- Update `removeAllWorktrees()` to remove batch container
- Update all callers
- Tests for path generation, listing, cleanup

**Dependencies:** TP-020 (needs batchId in worktree functions)  
**Size:** M  
**File scope:** `worktree.ts`, `waves.ts`, `execution.ts`, `engine.ts`, `merge.ts`, tests

### Task 3: Orch Branch Lifecycle + Merge Redirect (TP-022)
- Create `orch/{opId}-{batchId}` branch at batch start in `engine.ts`
- Pass `orchBranch` as base for worktrees and merge target
- Replace `git merge --ff-only` in `merge.ts` with `git update-ref`
- Remove stash/pop logic from merge
- Post-merge worktree reset to orch branch HEAD
- Auto-integration logic (config-driven)
- Preserve orch branch for manual integration
- Update post-batch notification
- Tests for branch creation, merge redirect, ff, auto-integration

**Dependencies:** TP-020 (schema), TP-021 (worktree paths)  
**Size:** L  
**File scope:** `engine.ts`, `merge.ts`, `persistence.ts`, tests

### Task 4: `/orch-integrate` Command (TP-023)
- Register `/orch-integrate` in `extension.ts`
- Implement ff, merge, PR modes
- Branch safety check (current branch vs baseBranch)
- `--force` override
- Cleanup on success (delete orch branch, clean batch state)
- Tests for command parsing, branch safety, integration modes

**Dependencies:** TP-022 (orch branch must exist to integrate)  
**Size:** M  
**File scope:** `extension.ts`, tests

### Task 5: Documentation + Settings (TP-024)
- Update `docs/reference/commands.md` with `/orch-integrate`
- Update `docs/reference/configuration/taskplane-settings.md` with Integration
- Update `README.md` command table
- Update `docs/explanation/architecture.md` if needed

**Dependencies:** TP-023 (command must be implemented first)  
**Size:** S  
**File scope:** `docs/**`, `README.md`

---

## 10. Wave Plan

```
Wave 1: TP-020 (schema/types/config)
Wave 2: TP-021 (worktree containers) — depends on TP-020
Wave 3: TP-022 (orch branch + merge redirect) — depends on TP-020, TP-021
Wave 4: TP-023 (/orch-integrate command) — depends on TP-022
         TP-024 (docs) — depends on TP-023
```

Note: TP-023 and TP-024 can potentially run in parallel in Wave 4 if docs are written
from the spec rather than from the implementation. But safer to run TP-024 after TP-023.

---

## 11. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Worktree path refactor breaks existing batches | High | Comprehensive tests, backward-compat for `listWorktrees` |
| `git update-ref` edge cases (concurrent writes) | Medium | Lock files, atomic operations |
| Workspace/polyrepo: per-repo orch branches needed | Medium | `resolveBaseBranch()` already handles per-repo, extend pattern |
| Resume from pre-#24 state files missing `orchBranch` | Low | Default to `""`, fall back to legacy baseBranch merge |
