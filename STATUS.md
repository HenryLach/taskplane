# TP-099: Integration STATUS.md Preservation — Status

**Current Step:** Step 0 (Preflight)
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-29
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** 🟡 In Progress

- [x] Read checkpoint commit and orch_integrate flow
- [x] Read GitHub issue #356

---

### Step 1: Diagnose rebase/merge conflict
**Status:** ⬜ Not Started

- [ ] Reproduce the STATUS.md loss
- [ ] Identify exact git operation that drops changes

---

### Step 2: Implement STATUS.md preservation
**Status:** ⬜ Not Started

- [ ] Implement chosen approach
- [ ] Verify .DONE and .reviews/ also survive

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Integration tests for STATUS.md preservation
- [ ] Full test suite passing

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Log discoveries

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-29 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-29 | Step 0 started | Reading integration flow, issue #356, merge.ts |

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

**Artifact staging in merge.ts (line ~1841):**
- Copies .DONE, STATUS.md, REVIEW_VERDICT.json from `join(repoRoot, relPath)` to merge worktree
- `repoRoot` is the main working directory (not the worktree where worker ran)
- This may overwrite correctly-merged STATUS.md from lane branches with old version from main

**Issue #356 root cause analysis:**
- GitHub squash merge creates a single commit from the diff between merge-base and orch tip
- If artifact staging overwrites STATUS.md with old content, the net diff is zero
- Squash merge then has no STATUS.md change to include
