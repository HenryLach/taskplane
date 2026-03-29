# TP-099: Integration STATUS.md Preservation ��� Status

**Current Step:** Step 1 (Diagnose rebase/merge conflict)
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-29
**Review Level:** 2
**Review Counter:** 2
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read checkpoint commit and orch_integrate flow
- [x] Read GitHub issue #356

---

### Step 1: Diagnose rebase/merge conflict
**Status:** ✅ Complete

**Root cause: H2 CONFIRMED — merge.ts artifact staging overwrite**

Diagnosis results:
- [x] **Case A (FF)**: STATUS.md preserved ✅ — no issue with direct FF
- [x] **Case B3 (Rebase conflict)**: REBASE CONFLICT when both branches modify STATUS.md
- [x] **Case C2 (Squash after overwrite)**: STATUS.md LOST, .DONE MISSING — artifact staging overwrote
- [x] **Case D (Isolation)**: ROOT CAUSE CONFIRMED — `copyFileSync` from `repoRoot` overwrites correct STATUS.md

**Authoritative drop point:** `merge.ts` line ~1841, artifact staging copies from `repoRoot` (main working dir) into merge worktree, overwriting correctly-merged STATUS.md from lane branches.

**Fix approach:** In `merge.ts` artifact staging, skip overwriting files that already exist in the merge worktree with content from the lane merge. Only stage artifacts that are NOT already present from the lane merge (e.g., .DONE files that were only in the main working dir).

---

### Step 2: Implement STATUS.md preservation
**Status:** ⬜ Not Started

- [ ] Implement chosen approach based on Step 1 diagnosis
- [ ] Verify .DONE and .reviews/ also survive

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Integration tests for STATUS.md preservation
- [ ] Integration tests for .DONE preservation
- [ ] Integration tests for .reviews/ preservation
- [ ] Full test suite passing

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Log discoveries

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | Plan | Step 1 | REVISE | .reviews/R001-plan-step1.md |
| R002 | plan | Step 1 | APPROVE | .reviews/R002-plan-step1.md |

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| No `git rebase` in code — issue #356 root cause may be H2 not H1 | Validate in Step 1 | extensions/taskplane/extension.ts, merge.ts |
| merge.ts artifact staging copies from `repoRoot` not worktree | Key suspect for H2 | extensions/taskplane/merge.ts:1841 |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-29 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-29 | Step 0 complete | Traced integration flow, read issue #356 |
| 2026-03-29 | Step 1 plan revised | R001 feedback: expanded diagnosis matrix |
| 2026-03-29 21:44 | Review R002 | plan Step 1: APPROVE |

---

## Blockers

*None*

---

## Notes

### Preflight Analysis

**Integration flow traced:**
1. Engine creates orch branch from main (`engine.ts`)
2. Workers execute in worktrees, update STATUS.md
3. `mergeWaveByRepo` merges lane branches into orch branch, stages task artifacts (.DONE, STATUS.md) from `repoRoot`
4. Integration via `executeIntegration` (FF/merge/PR modes)
5. For PR mode: supervisor's `handlePrLifecycle` polls CI and squash-merges

**Key code paths (no rebase found):**
- FF: `git merge --ff-only orchBranch` (extension.ts)
- Merge: `git merge orchBranch --no-edit` (extension.ts)
- PR: `git push origin orchBranch` + `gh pr create` (extension.ts)
- Supervisor merge: `gh pr merge --squash --delete-branch` (supervisor.ts)
