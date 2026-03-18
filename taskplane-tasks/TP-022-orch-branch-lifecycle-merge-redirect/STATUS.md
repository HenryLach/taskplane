# TP-022: Orch Branch Lifecycle & Merge Redirect — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-18
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read `engine.ts` — batch execution phases, wave loop, cleanup
- [ ] Read `merge.ts` — merge flow, fast-forward, stash/pop
- [ ] Read `waves.ts` — `resolveBaseBranch()`, `allocateLanes()`
- [ ] Read `persistence.ts` — orchBranch serialization
- [ ] Verify TP-020 and TP-021 artifacts present

---

### Step 1: Create Orch Branch at Batch Start
**Status:** ⬜ Not Started

- [ ] Generate orch branch name and create via `git branch`
- [ ] Store in `batchState.orchBranch`
- [ ] Handle creation failure
- [ ] Log branch creation

---

### Step 2: Route Worktrees and Merge to Orch Branch
**Status:** ⬜ Not Started

- [ ] Pass `orchBranch` to `executeWave()` and `mergeWaveByRepo()`
- [ ] Post-merge worktree reset targets `orchBranch`
- [ ] Verify `resolveBaseBranch()` compatibility

---

### Step 3: Replace Fast-Forward with update-ref in Merge
**Status:** ⬜ Not Started

- [ ] Replace `git merge --ff-only` with `git update-ref`
- [ ] Remove stash/pop logic
- [ ] Verify merge worktree still works against orch branch

---

### Step 4: Auto-Integration and Cleanup
**Status:** ⬜ Not Started

- [ ] Implement auto-integration (config-driven ff)
- [ ] Preserve orch branch for manual integration
- [ ] Update completion notification with integration instructions
- [ ] Update cleanup to not delete orch branch

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Unit tests passing
- [ ] Orch branch creation edge cases verified
- [ ] Merge no longer touches user's branch
- [ ] Auto-integration verified
- [ ] All failures fixed

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Discoveries logged
- [ ] `.DONE` created

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
| 2026-03-18 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
