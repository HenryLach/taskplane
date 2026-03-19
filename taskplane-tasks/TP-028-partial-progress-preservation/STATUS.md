# TP-028: Partial Progress Preservation — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 2
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read worktree cleanup logic
- [x] Read task outcome recording
- [x] Read roadmap Phase 2 section 2a
- [x] Understand existing saved-branch logic
- [x] R001: Read CONTEXT.md (Tier 2) and persistence.ts serialization contract
- [x] R001: Read naming.ts and diagnostics.ts partialProgress fields for naming alignment
- [x] R001: Identify all cleanup call sites and document insertion points for Steps 1-2

---

### Step 1: Detect and Save Partial Progress
**Status:** ⬜ Not Started

- [ ] Check lane branch commit count before cleanup
- [ ] Create saved branch with naming contract
- [ ] Skip lane branch deletion when saved
- [ ] Log partial progress info
- [ ] Workspace-aware repo root for branch ops

---

### Step 2: Record Partial Progress in Task Outcome
**Status:** ⬜ Not Started

- [ ] Add fields to task outcome type
- [ ] Populate fields during progress save
- [ ] Persist to batch-state.json

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Test saved branch for failed task with commits
- [ ] Test no saved branch for failed task without commits
- [ ] Test workspace mode naming
- [ ] Test repo mode naming
- [ ] Test outcome includes partial progress fields
- [ ] Full test suite passes

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Comments updated
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | APPROVE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| `preserveBranch()` in worktree.ts already handles merge-path saved branches; partial progress uses different naming (`saved/{opId}-{taskId}-{batchId}`) vs merge-path (`saved/{originalBranch}`) | Use separate function for partial progress naming | worktree.ts |
| `LaneTaskOutcome` in types.ts needs new fields; `PersistedTaskRecord` also needs them for batch-state serialization | Step 2 scope | types.ts |
| `removeAllWorktrees()` already receives `targetBranch` for merge-path preservation; partial progress save should happen BEFORE worktree removal in the execution/cleanup flow, not during `removeWorktree` | Step 1 design consideration | execution.ts, worktree.ts |
| The partial progress save needs the base branch to count commits — this is the `baseBranch` captured at batch start, available in the execution flow | Step 1 | execution.ts |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-19 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-19 19:02 | Task started | Extension-driven execution |
| 2026-03-19 19:02 | Step 0 started | Preflight |
| 2026-03-19 19:02 | Task started | Extension-driven execution |
| 2026-03-19 19:02 | Step 0 started | Preflight |
| 2026-03-19 19:05 | Review R001 | plan Step 0: APPROVE |
| 2026-03-19 | Step 0 complete | Preflight: read worktree.ts cleanup, execution.ts outcome recording, roadmap Phase 2 sec 2a, saved-branch logic |
| 2026-03-19 19:05 | Review R001 | plan Step 0: REVISE |
| 2026-03-19 19:08 | Worker iter 1 | done in 163s, ctx: 36%, tools: 33 |

---

## Blockers

*None*

---

## Notes

### Preflight Findings (Step 0)

**Cleanup call sites (Step 1 insertion points):**
1. `engine.ts:726` — `removeAllWorktrees()` in post-batch cleanup (end-of-batch). Uses `orchBranch` as targetBranch. This is the PRIMARY insertion point — partial progress save should happen BEFORE this cleanup.
2. `resume.ts:1410` — `removeAllWorktrees()` in resume terminal cleanup (section 11). Per-repo with per-repo targetBranch. Same pattern — save before cleanup.
3. `engine.ts:557` — `forceCleanupWorktree()` in inter-wave worktree reset failure path. This is for BETWEEN waves, not end-of-batch — partial progress save not needed here (task will be retried).
4. `resume.ts:1365` — `forceCleanupWorktree()` in resume pre-execution reset. Same as #3 — between-wave, not relevant.

**Key insight:** Partial progress preservation should happen BEFORE `removeAllWorktrees()` calls at batch end (sites #1 and #2), not during. We need to iterate over failed task outcomes, check each lane branch for commits ahead of base, and create saved branches BEFORE cleanup deletes them.

**Existing branch preservation compatibility:**
- `removeAllWorktrees()` already calls `removeWorktree()` → `ensureBranchDeleted()` → `preserveBranch()` which preserves branches with unmerged commits vs `targetBranch` as `saved/{originalBranch}`.
- TP-028 adds a DIFFERENT preservation: saving branches for FAILED tasks specifically, with task-ID-based naming (`saved/{opId}-{taskId}-{batchId}`).
- These are complementary, not conflicting. The existing merge-aware preservation handles success-path branch safety; TP-028 handles failure-path progress recovery.

**Naming alignment:**
- `diagnostics.ts` already has `partialProgressCommits: number` and `partialProgressBranch: string | null` in `TaskExitDiagnostic`.
- New fields on `LaneTaskOutcome` and `PersistedTaskRecord` should use the same names.
- Saved branch naming: `saved/{opId}-{taskId}-{batchId}` (repo mode) or `saved/{opId}-{repoId}-{taskId}-{batchId}` (workspace mode) per roadmap spec.

**Serialization path (Step 2):**
- `persistence.ts:serializeBatchState()` maps `LaneTaskOutcome` → `PersistedTaskRecord`.
- Add `partialProgressCommits` and `partialProgressBranch` to both types.
- The mapping in `serializeBatchState()` at line ~721 already handles optional fields pattern (see `repoId`, `resolvedRepoId`).
