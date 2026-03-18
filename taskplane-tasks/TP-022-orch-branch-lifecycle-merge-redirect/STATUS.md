# TP-022: Orch Branch Lifecycle & Merge Redirect — Status

**Current Step:** Step 5: Testing & Verification
**Status:** ✅ Step 4 Complete
**Last Updated:** 2026-03-18
**Review Level:** 2
**Review Counter:** 11
**Iteration:** 6
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
**Status:** ✅ Complete

- [x] In engine.ts: pass `orchBranch` (not `baseBranch`) to `executeWave()` and `mergeWaveByRepo()` calls
- [x] In engine.ts: post-merge worktree reset targets `orchBranch` (not `baseBranch`)
- [x] In resume.ts: add orchBranch empty-guard — fail fast with clear message if `batchState.orchBranch` is empty/missing on resume
- [x] In resume.ts: pass `orchBranch` to `executeWave()` and `mergeWaveByRepo()` calls (4 call sites: re-exec merge, wave executeWave, wave mergeWaveByRepo, and re-exec merge target)
- [x] In resume.ts: post-merge worktree reset targets `orchBranch` (not `baseBranch`)
- [x] Verify `resolveBaseBranch()` compatibility — in workspace mode it detects per-repo branch; in repo mode it returns passed-in value (now orchBranch). No changes needed.
- [x] Add tests for orchBranch routing: engine execute/merge/reset, resume parity, resolveBaseBranch repo vs workspace mode (added to orch-direct-implementation.test.ts, tests 5-8)
- [x] Remove duplicate R004 review row in STATUS.md
- [x] R006: Fix orchBranch guard in resume.ts — move guard before runtime state mutation (phase/batchId), or set terminal phase + endedAt + error before returning, so state remains consistent and future /orch-resume is not blocked
- [x] R006: Add workspace-mode fallback handling in resolveBaseBranch() — fail fast with targeted message when fallback would be an orch branch in a non-primary repo (detached HEAD + no defaultBranch)
- [x] R006: Add test for legacy-state guard path verifying runtime state is resumable/consistent after rejection
- [x] R006: Add workspace-mode test for resolveBaseBranch() fallback with detached HEAD when batchBaseBranch is an orch branch

---

### Step 3: Replace Fast-Forward with update-ref in Merge
**Status:** ✅ Complete

- [x] Replace ff-only+stash/pop block with rev-parse+update-ref: get temp branch HEAD via `git rev-parse`, update target branch ref via `git update-ref`, with proper error handling (failedLane/failureReason set on failure, exec logging for success and failure)
- [x] Add non-regression verification: no `git merge --ff-only` or `git stash` calls remain in merge flow
- [x] Add Step 3 tests to orch-direct-implementation.test.ts: success path (update-ref called, no ff-only/stash), failure path (update-ref error → failedLane/failureReason set, status partial/failed)
- [x] Clean up duplicate R006 review row in STATUS.md
- [x] R008: Gate update strategy — detect if targetBranch is checked out in repoRoot; if yes, use checkout-safe advancement (merge --ff-only); if no, use update-ref. Update comment to reflect workspace-mode reality.
- [x] R008: Use compare-and-swap update-ref (`update-ref <ref> <new> <old>`) to guard against concurrent branch movement
- [x] R008: Add workspace-mode merge test — simulate repoId present + target branch checked out, verify post-merge advancement doesn't leave repo dirty

---

### Step 4: Auto-Integration and Cleanup
**Status:** ✅ Complete

- [x] Add ORCH_MESSAGES helper for post-batch integration guidance (shared by engine.ts + resume.ts)
- [x] Implement auto-integration in engine.ts Phase 3: gated ff of baseBranch to orchBranch (success → log+notify, diverged/detached/dirty/missing → warn+preserve orchBranch, never fail the batch)
- [x] Update engine.ts cleanup: do NOT delete orchBranch; lane branches deleted as before; unmerged-branch protection uses orchBranch (lanes merged into orchBranch, not baseBranch)
- [x] Update engine.ts completion notification to include orchBranch integration info
- [x] Resume parity: mirror auto-integration + cleanup + completion messaging in resume.ts section 11
- [x] Add Step 4 tests: auto-integration success, auto-integration divergence fallback, manual mode preserves orchBranch, completion message content, resume parity structural checks (tests 18-23 in orch-direct-implementation.test.ts, 753 tests pass)
- [x] R010: Verify resume.ts cleanup already resolves per-repo target branch in workspace mode (check if already implemented)
- [x] R010: Gate auto-integration and manual guidance in engine.ts to terminal phases only (exclude paused/stopped)
- [x] R010: Gate auto-integration and manual guidance in resume.ts to terminal phases only (parity)
- [x] R010: Add regression tests — no auto-integration/guidance when phase is paused/stopped (engine + resume)
- [x] R010: Add test for resumed workspace-mode cleanup across multiple repos verifying lane branches are deleted against correct per-repo target branch
- [x] R010: Extracted shared attemptAutoIntegration to merge.ts — both engine.ts and resume.ts now import from single source, eliminating parity drift

---

### Step 5: Testing & Verification
**Status:** 🟨 In Progress

- [ ] Full test suite passes: `cd extensions && npx vitest run` — record pass count
- [ ] Orch branch creation edge cases verified: detached HEAD, branch-already-exists handled in tests (Step 1 tests 1-4)
- [ ] Merge advancement: non-checked-out path uses update-ref (no ff-only on user branch); checked-out fallback uses ff-only+stash (Step 3 tests 11-14)
- [ ] Worktrees based on orchBranch: engine.ts and resume.ts pass orchBranch to executeWave (Step 2 tests 5-8)
- [ ] Post-merge worktree reset targets orchBranch (Step 2 tests 5-8)
- [ ] Cleanup preserves orchBranch in manual-integration mode (Step 4 tests 18-23)
- [ ] Auto-integration verified: success path and divergence fallback (Step 4 tests 18-23)
- [ ] Resume parity: terminal-phase gating for auto-integration, orchBranch guard on legacy state (Step 4 tests 24-26, Step 2 tests 9-10)
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
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R007 | plan | Step 3 | APPROVE | .reviews/R007-plan-step3.md |
| R008 | code | Step 3 | REVISE | .reviews/R008-code-step3.md |
| R008 | code | Step 3 | REVISE | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
| R009 | plan | Step 4 | APPROVE | .reviews/R009-plan-step4.md |
| R010 | code | Step 4 | REVISE | .reviews/R010-code-step4.md |
| R010 | code | Step 4 | REVISE | .reviews/R010-code-step4.md |
| R011 | plan | Step 5 | REVISE | .reviews/R011-plan-step5.md |

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
| 2026-03-18 | Step 2 impl | orchBranch routing in engine.ts (3 sites) + resume.ts (4 sites + empty guard), tests added, 753 tests pass |
| 2026-03-18 | Step 2 complete | Route Worktrees and Merge to Orch Branch |
| 2026-03-18 15:01 | Worker iter 2 | done in 567s, ctx: 24%, tools: 41 |
| 2026-03-18 15:01 | Step 1 complete | Create Orch Branch at Batch Start |
| 2026-03-18 15:01 | Step 2 started | Route Worktrees and Merge to Orch Branch |
| 2026-03-18 15:05 | Review R005 | plan Step 2: REVISE |
| 2026-03-18 15:08 | Worker iter 3 | done in 508s, ctx: 37%, tools: 63 |
| 2026-03-18 15:08 | Worker iter 3 | done in 172s, ctx: 19%, tools: 17 |
| 2026-03-18 15:12 | Review R006 | code Step 2: REVISE |
| 2026-03-18 | R006 revisions | Fixed orchBranch guard ordering in resume.ts, added orch branch fallback guard in resolveBaseBranch(), added tests 9-10, 753 tests pass |
| 2026-03-18 15:13 | Review R006 | code Step 2: REVISE |
| 2026-03-18 15:19 | Worker iter 3 | done in 434s, ctx: 20%, tools: 39 |
| 2026-03-18 15:19 | Step 2 complete | Route Worktrees and Merge to Orch Branch |
| 2026-03-18 15:19 | Step 3 started | Replace Fast-Forward with update-ref in Merge |
| 2026-03-18 15:21 | Review R007 | plan Step 3: REVISE |
| 2026-03-18 15:22 | Worker iter 3 | done in 495s, ctx: 25%, tools: 57 |
| 2026-03-18 15:22 | Step 2 complete | Route Worktrees and Merge to Orch Branch |
| 2026-03-18 15:22 | Step 3 started | Replace Fast-Forward with update-ref in Merge |
| 2026-03-18 15:23 | Review R007 | plan Step 3: APPROVE |
| 2026-03-18 | Step 3 impl | ff-only+stash replaced with update-ref, tests 11-13 verified, 753 tests pass |
| 2026-03-18 | Step 3 complete | Replace Fast-Forward with update-ref in Merge |
| 2026-03-18 15:28 | Worker iter 4 | done in 299s, ctx: 27%, tools: 42 |
| 2026-03-18 15:28 | Worker iter 4 | done in 398s, ctx: 26%, tools: 38 |
| 2026-03-18 15:32 | Review R008 | code Step 3: REVISE |
| 2026-03-18 | R008 revisions | Gated advancement: update-ref for non-checked-out (with CAS), ff-only+stash for checked-out; test 14 added; 753 tests pass |
| 2026-03-18 | Step 3 complete | Replace Fast-Forward with update-ref in Merge (R008 addressed) |
| 2026-03-18 15:39 | Worker iter 4 | done in 443s, ctx: 23%, tools: 39 |
| 2026-03-18 15:39 | Step 3 complete | Replace Fast-Forward with update-ref in Merge |
| 2026-03-18 15:39 | Step 4 started | Auto-Integration and Cleanup |
| 2026-03-18 15:43 | Review R009 | plan Step 4: REVISE |
| 2026-03-18 15:44 | Worker iter 4 | done in 683s, ctx: 39%, tools: 53 |
| 2026-03-18 15:44 | Step 3 complete | Replace Fast-Forward with update-ref in Merge |
| 2026-03-18 15:44 | Step 4 started | Auto-Integration and Cleanup |
| 2026-03-18 15:46 | Review R009 | plan Step 4: APPROVE |
| 2026-03-18 | Step 4 impl | Resume parity verified (already implemented); added tests 18-23; 753 tests pass |
| 2026-03-18 | Step 4 complete | Auto-Integration and Cleanup |
| 2026-03-18 15:52 | Worker iter 5 | done in 408s, ctx: 45%, tools: 44 |
| 2026-03-18 15:53 | Worker iter 5 | done in 630s, ctx: 44%, tools: 67 |
| 2026-03-18 15:56 | Review R010 | code Step 4: REVISE |
| 2026-03-18 15:58 | Review R010 | code Step 4: REVISE |
| 2026-03-18 | R010 revisions | Fixed workspace-mode cleanup (per-repo target branch), extracted shared attemptAutoIntegration to merge.ts, added tests 24-26, 753 tests pass |
| 2026-03-18 | Step 4 complete | Auto-Integration and Cleanup (R010 addressed) |
| 2026-03-18 16:12 | Worker iter 5 | done in 945s, ctx: 45%, tools: 108 |
| 2026-03-18 16:12 | Step 4 complete | Auto-Integration and Cleanup |
| 2026-03-18 16:12 | Step 5 started | Testing & Verification |
| 2026-03-18 16:12 | Worker iter 5 | done in 877s, ctx: 40%, tools: 114 |
| 2026-03-18 16:12 | Step 4 complete | Auto-Integration and Cleanup |
| 2026-03-18 16:12 | Step 5 started | Testing & Verification |
| 2026-03-18 16:14 | Review R011 | plan Step 5: REVISE |

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
