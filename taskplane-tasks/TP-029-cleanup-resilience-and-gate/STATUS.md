# TP-029: Cleanup Resilience & Post-Merge Gate — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 2
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read CONTEXT.md (Tier 2 context)
- [x] Read worktree cleanup flow (engine → worktree.ts)
- [x] Read merge worktree lifecycle (merge.ts)
- [x] Understand issue #93 root cause: why only last-wave repos get cleanup
- [x] Read roadmap Phase 2 sections 2b, 2c, 2d
- [x] Read /orch-integrate flow in extension.ts (autostash, cleanup touchpoints)
- [x] Read resume.ts per-repo cleanup pattern for parity (R001 issue 3)
- [x] Inventory existing test surface for cleanup/worktree/integrate paths
- [x] Record preflight findings: insertion points, expected failure-path behavior
- [x] R002: Fix Reviews table separator row placement (moved after header)
- [x] R002: Remove duplicate R002 row from Reviews table
- [x] R002: Verify no out-of-scope TP-028 edits in checkpoint

---

### Step 1: Fix Per-Wave Cleanup Across All Repos
**Status:** ⬜ Not Started

- [ ] Iterate ALL repos per wave for cleanup
- [ ] Apply force cleanup fallback pattern
- [ ] Extend to merge worktrees
- [ ] Remove empty .worktrees/ dirs

---

### Step 2: Post-Merge Cleanup Gate
**Status:** ⬜ Not Started

- [ ] Verify cleanup success before advancing wave
- [ ] Pause batch on cleanup failure
- [ ] Emit diagnostic with recovery commands

---

### Step 3: Integrate Cleanup into /orch-integrate
**Status:** ⬜ Not Started

- [ ] Clean autostash entries after integrate
- [ ] Verify polyrepo acceptance criteria
- [ ] Report cleanup status

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Multi-repo cleanup tests
- [ ] Force cleanup fallback tests
- [ ] Cleanup gate tests
- [ ] Autostash cleanup tests
- [ ] Full test suite passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Close issue #93
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-19 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-19 20:27 | Task started | Extension-driven execution |
| 2026-03-19 20:27 | Step 0 started | Preflight |
| 2026-03-19 20:29 | Review R001 | plan Step 0: REVISE |
| 2026-03-19 20:32 | Worker iter 1 | done in 197s, ctx: 46%, tools: 35 |
| 2026-03-19 20:33 | Worker iter 1 | done in 266s, ctx: 53%, tools: 48 |
| 2026-03-19 20:34 | Review R002 | code Step 0: REVISE |
| 2026-03-19 20:35 | R002 revisions | Fixed reviews table, removed duplicate row, verified no TP-028 edits |
| 2026-03-19 20:35 | Review R002 | code Step 0: REVISE |

---

## Blockers

*None*

---

## Notes

### Preflight Findings

**Root cause of issue #93:**
- In `engine.ts` inter-wave reset (~line 576), `listWorktrees()` is called with only `repoRoot` (the primary repo). In workspace mode, secondary repos have their own lane worktrees but these are never discovered or reset between waves.
- In `engine.ts` terminal cleanup (~line 824), `removeAllWorktrees()` is similarly called only against the primary `repoRoot`. The `resume.ts` terminal cleanup (~line 1485) correctly iterates `encounteredRepoRoots` (all repos that had lanes), which is the pattern engine.ts should follow.

**Insertion points for fixes:**
1. **Inter-wave reset (engine.ts ~576):** Must collect all repo roots from `latestAllocatedLanes` (via `lane.repoId` → `resolveRepoRoot()`) and run `listWorktrees()` + reset/cleanup per repo. Follow `resume.ts:1485` pattern.
2. **Terminal cleanup (engine.ts ~824):** Same — must iterate all encountered repo roots, not just primary. Follow `resume.ts:1485` pattern exactly.
3. **Merge worktree cleanup (merge.ts ~end of mergeWave):** Already cleans up its own merge worktree via `git worktree remove --force`. The `forceCleanupWorktree()` fallback pattern should be applied if the initial remove fails.
4. **Post-merge gate (engine.ts, after merge + cleanup):** New code between merge and wave-advance. Verify cleanup succeeded in all repos before continuing.
5. **/orch-integrate cleanup (extension.ts ~466):** `performCleanup()` deletes orch branch and batch state but doesn't clean autostash entries or verify polyrepo acceptance criteria.

**Parity constraints with resume.ts:**
- `resume.ts:1475-1507` uses `encounteredRepoRoots` set to collect ALL repo roots from persisted + newly allocated lanes. Engine.ts needs the same approach.
- Per-repo target branch resolution differs: primary repo uses orchBranch, secondary repos resolve via `resolveBaseBranch()`.

**Cleanup gate failure classification:**
- New `cleanup_post_merge_failed` classification will be surfaced via `batchState.errors` and exec log.
- Phase transitions: merge succeeded → cleanup attempted → if cleanup fails: phase = "paused", block next wave.

**Test strategy:**
- `extensions/tests/cleanup-resilience.test.ts` (new) will test multi-repo cleanup iteration, force cleanup fallback, cleanup gate blocking, and autostash cleanup.
- Acceptance criteria from roadmap 2d (lines 441-452): no registered worktrees, no lane branches, no orch branches, no stale autostash, no non-empty .worktrees/ containers.
