# TP-022: Orch Branch Lifecycle & Merge Redirect — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-18
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** L

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read `engine.ts` — batch execution phases, wave loop, cleanup
- [x] Read `merge.ts` — merge flow, fast-forward, stash/pop
- [x] Read `waves.ts` — `resolveBaseBranch()`, `allocateLanes()`
- [x] Read `persistence.ts` — orchBranch serialization
- [x] Read `resume.ts` — audit all baseBranch routing (worktree base, merge target, reset, cleanup)
- [x] Read `messages.ts` — understand completion message patterns for Step 4
- [x] Verify TP-020 and TP-021 artifacts present
- [x] Map baseBranch call sites → orchBranch migration decisions (log in Discoveries)
- [x] Identify impacted test files for resumed-batch and merge coverage (orch-state-persistence, merge-repo-scoped, monorepo-compat-regression, worktree-lifecycle, orch-pure-functions)

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
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| engine.ts: executeWave() receives baseBranch — migrate to orchBranch | Step 2 | engine.ts ~L165 |
| engine.ts: mergeWaveByRepo() receives baseBranch — migrate to orchBranch | Step 2 | engine.ts ~L238 |
| engine.ts: post-merge worktree reset uses baseBranch — migrate to orchBranch | Step 2 | engine.ts ~L285 |
| engine.ts: Phase 3 cleanup uses baseBranch for unmerged check — keep baseBranch (checks against user branch) | Step 4 | engine.ts ~L338 |
| merge.ts: ff-only + stash/pop — replace with update-ref + remove stash/pop | Step 3 | merge.ts ~L460-490 |
| resume.ts: executeWave() receives baseBranch — migrate to orchBranch | Step 2 | resume.ts ~L780 |
| resume.ts: mergeWaveByRepo() receives baseBranch — migrate to orchBranch (2 call sites) | Step 2 | resume.ts ~L820,~L880 |
| resume.ts: post-merge worktree reset uses baseBranch — migrate to orchBranch | Step 2 | resume.ts ~L970 |
| resume.ts: cleanup uses baseBranch — keep baseBranch | Step 4 | resume.ts ~L1000 |
| waves.ts: resolveBaseBranch() in workspace mode detects per-repo branch — no change needed; receives orchBranch in repo mode | N/A | waves.ts resolveBaseBranch() |
| persistence.ts: orchBranch serialization already present (TP-020) | Verified | persistence.ts serializeBatchState() |
| engine.ts:73 `baseBranch = detectedBranch` — keep as-is (baseBranch is user's branch) | N/A — Step 1 creates orchBranch from baseBranch | engine.ts |
| engine.ts:256 `executeWave(...baseBranch)` — change to orchBranch | Step 2 | engine.ts |
| engine.ts:364 `mergeWaveByRepo(...baseBranch)` — change to orchBranch | Step 2 | engine.ts |
| engine.ts:492 `targetBranch = baseBranch` (worktree reset) — change to orchBranch | Step 2 | engine.ts |
| engine.ts:676 `targetBranch = baseBranch` (cleanup) — keep baseBranch for unmerged-branch check | Step 4 | engine.ts |
| merge.ts ff block (line ~580): `git merge --ff-only tempBranch` in repoRoot — replace with update-ref to orchBranch | Step 3 | merge.ts |
| merge.ts stash/pop block (lines ~584-596) — remove entirely | Step 3 | merge.ts |
| resume.ts:614 `baseBranch = persisted.baseBranch` — keep, also set orchBranch from persisted | Already done by TP-020 | resume.ts |
| resume.ts:905 `mergeWaveByRepo(...baseBranch)` for re-exec merge — change to orchBranch | Step 2 (resume parity) | resume.ts |
| resume.ts:1069 `mergeWaveByRepo(...baseBranch)` re-exec lanes — change to orchBranch | Step 2 (resume parity) | resume.ts |
| resume.ts:1184 `mergeWaveByRepo(...baseBranch)` wave merge — change to orchBranch | Step 2 (resume parity) | resume.ts |
| resume.ts:1297 `targetBranch = baseBranch` (worktree reset) — change to orchBranch | Step 2 (resume parity) | resume.ts |
| resume.ts:1317 `targetBranch = baseBranch` (cleanup) — keep baseBranch for unmerged check | Step 4 (resume parity) | resume.ts |
| Persisted states with orchBranch="" must be handled gracefully (TP-020 defaults) | Already handled by persistence.ts validation | persistence.ts |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-18 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-18 14:32 | Task started | Extension-driven execution |
| 2026-03-18 14:32 | Step 0 started | Preflight |
| 2026-03-18 14:32 | Task started | Extension-driven execution |
| 2026-03-18 14:32 | Step 0 started | Preflight |
| 2026-03-18 14:34 | Review R001 | plan Step 0: REVISE |
| 2026-03-18 14:34 | Review R001 | plan Step 0: REVISE |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
