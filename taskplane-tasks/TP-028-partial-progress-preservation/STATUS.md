# TP-028: Partial Progress Preservation — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** 🟨 In Progress

- [x] Read worktree cleanup logic
- [x] Read task outcome recording
- [x] Read roadmap Phase 2 section 2a
- [x] Understand existing saved-branch logic
- [ ] R001: Read CONTEXT.md (Tier 2) and persistence.ts serialization contract
- [ ] R001: Read naming.ts and diagnostics.ts partialProgress fields for naming alignment
- [ ] R001: Identify all cleanup call sites and document insertion points for Steps 1-2

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

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
