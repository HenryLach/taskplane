# TP-022: Orch Branch Lifecycle & Merge Redirect — Status

**Current Step:** Step 2: Route Worktrees and Merge to Orch Branch
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-18
**Review Level:** 2
**Review Counter:** 5
**Iteration:** 3
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
- [x] R002: Fill in explicit test file paths in Notes "Impacted Test Files" section
- [x] R002: Deduplicate Reviews table and Execution Log rows

---

### Step 1: Create Orch Branch at Batch Start
**Status:** ✅ Complete

- [x] Generate orch branch name `orch/{opId}-{batchId}` using `resolveOperatorId(orchConfig)` and create via `runGit(["branch", orchBranch, baseBranch], repoRoot)`; store in `batchState.orchBranch`
- [x] Handle creation failure: set phase="failed", endedAt, push error, notify, return (matching existing early-exit pattern in engine.ts)
- [x] Log branch creation via `execLog("batch", batchId, "created orch branch", { orchBranch, baseBranch })`
- [x] R003: Clean duplicate Execution Log rows in STATUS.md
- [x] R004: Move orch branch creation after preflight+discovery, or add best-effort cleanup on all planning-phase early exits that occur after branch creation
- [x] R004: Add tests for orch branch creation (success path, failure path, cleanup on early exit)

---

### Step 2: Route Worktrees and Merge to Orch Branch
**Status:** 🟨 In Progress

- [ ] In engine.ts: pass `orchBranch` (not `baseBranch`) to `executeWave()` and `mergeWaveByRepo()` calls
- [ ] In engine.ts: post-merge worktree reset targets `orchBranch` (not `baseBranch`)
- [ ] In resume.ts: add orchBranch empty-guard — fail fast with clear message if `batchState.orchBranch` is empty/missing on resume
- [ ] In resume.ts: pass `orchBranch` to `executeWave()` and `mergeWaveByRepo()` calls (4 call sites: re-exec merge, wave executeWave, wave mergeWaveByRepo, and re-exec merge target)
- [ ] In resume.ts: post-merge worktree reset targets `orchBranch` (not `baseBranch`)
- [ ] Verify `resolveBaseBranch()` compatibility — in workspace mode it detects per-repo branch; in repo mode it returns passed-in value (now orchBranch)
- [ ] Add tests for orchBranch routing: engine execute/merge/reset, resume parity, resolveBaseBranch repo vs workspace mode
- [ ] Remove duplicate R004 review row in STATUS.md

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
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |

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
| 2026-03-18 14:34 | Review R001 | plan Step 0: REVISE |
| 2026-03-18 | Step 0 complete | All preflight items checked, baseBranch call sites mapped, test files identified |
| 2026-03-18 14:37 | Worker iter 1 | done in 215s, ctx: 49%, tools: 40 |
| 2026-03-18 14:39 | Review R002 | code Step 0: REVISE |
| 2026-03-18 | R002 revisions | Fixed test file names in Notes, deduplicated Reviews/Execution Log tables |
| 2026-03-18 14:40 | Worker iter 2 | done in 78s, ctx: 10%, tools: 14 |
| 2026-03-18 14:40 | Step 0 complete | Preflight |
| 2026-03-18 14:40 | Step 1 started | Create Orch Branch at Batch Start |
| 2026-03-18 14:43 | Review R003 | plan Step 1: REVISE — hydrate naming/failure/test items |
| 2026-03-18 | Step 1 impl | Orch branch creation added to engine.ts, all 753 tests pass |
| 2026-03-18 14:47 | Worker iter 2 | done in 228s, ctx: 22%, tools: 31 |
| 2026-03-18 14:48 | Worker iter 2 | done in 253s, ctx: 20%, tools: 32 |
| 2026-03-18 14:50 | Review R004 | code Step 1: REVISE |
| 2026-03-18 | R004 revisions | Moved orch branch creation after all planning validations; added tests for success/failure/lifecycle; 754 tests pass |
| 2026-03-18 14:51 | Review R004 | code Step 1: REVISE |
| 2026-03-18 14:58 | Worker iter 2 | done in 465s, ctx: 28%, tools: 58 |
| 2026-03-18 14:58 | Step 1 complete | Create Orch Branch at Batch Start |
| 2026-03-18 14:58 | Step 2 started | Route Worktrees and Merge to Orch Branch |
| 2026-03-18 15:00 | Review R005 | plan Step 2: REVISE |
| 2026-03-18 15:01 | Worker iter 2 | done in 567s, ctx: 24%, tools: 41 |
| 2026-03-18 15:01 | Step 1 complete | Create Orch Branch at Batch Start |
| 2026-03-18 15:01 | Step 2 started | Route Worktrees and Merge to Orch Branch |

---

## Blockers

*None*

---

## Notes

### Impacted Test Files (Step 5 reference)
- `extensions/tests/orch-state-persistence.test.ts` — baseBranch/orchBranch serialization, v1→v2 upconvert, round-trip tests
- `extensions/tests/waves-repo-scoped.test.ts` — resolveBaseBranch() tests (likely no changes needed)
- `extensions/tests/orch-pure-functions.test.ts` — resolveBaseBranch, state serialization with baseBranch
- `extensions/tests/worktree-lifecycle.test.ts` — baseBranch in createWorktree calls (no change: worktree code is unchanged)
- `extensions/tests/monorepo-compat-regression.test.ts` — orchBranch field in state fixtures
- `extensions/tests/merge-repo-scoped.test.ts` — merge flow tests (may need update for update-ref vs ff-only)

### baseBranch → orchBranch Migration Summary
- **engine.ts**: 3 sites migrate to orchBranch (executeWave, mergeWaveByRepo, post-merge reset). Phase 3 cleanup keeps baseBranch.
- **merge.ts**: ff-only replaced with update-ref, stash/pop removed. targetBranch parameter receives orchBranch from caller.
- **resume.ts**: 4 sites migrate to orchBranch (mirrors engine.ts). Cleanup keeps baseBranch.
- **waves.ts**: No changes needed. resolveBaseBranch() receives orchBranch in repo mode.
- **persistence.ts**: orchBranch serialization already present from TP-020.
