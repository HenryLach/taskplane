# TP-029: Cleanup Resilience & Post-Merge Gate — Status

**Current Step:** Step 2: Post-Merge Cleanup Gate
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 5
**Iteration:** 3
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
**Status:** ✅ Complete

- [x] Inter-wave reset: collect all repo roots from allocated lanes and iterate per-repo (following resume.ts encounteredRepoRoots pattern); per-repo target branch resolution (primary=orchBranch, secondary=resolveBaseBranch)
- [x] Terminal cleanup: iterate all encountered repo roots for removeAllWorktrees (not just primary repoRoot); follow same pattern as resume.ts:1475-1507
- [x] Force cleanup fallback: apply forceCleanupWorktree to both merge.ts stale-prep cleanup (~577) and end-of-wave merge worktree cleanup (~887)
- [x] .worktrees parent cleanup: only remove empty .worktrees base dirs in subdirectory mode; never force-remove non-empty parents (R003 safety rule)
- [x] Remove duplicate execution-log rows at STATUS.md:110-113 (R003 housekeeping)
- [x] R004: Remove unused `resolveRepoIdFromRoot` import from engine.ts (fixes circular dep engine→resume→engine)
- [x] R004-v2: Remove duplicate .worktrees base-dir cleanup from engine.ts (keep single owner in removeAllWorktrees)
- [x] R004-v2: Add behavioral test for merge worktree force cleanup fallback (forceRemoveMergeWorktree)
- [x] R004-v2: Add engine-level behavioral test for multi-repo terminal cleanup (not just structural assertions)
- [x] R004: Add behavioral tests for multi-repo terminal cleanup (repos active in earlier waves but not final wave)
- [x] R004: Add behavioral test for merge worktree force cleanup fallback path
- [x] R004: Add behavioral test for .worktrees base-dir cleanup safety split by mode (subdirectory vs sibling)
- [x] R004-v2: Run full test suite and confirm green (998 tests, 26 files, all pass)

---

### Step 2: Post-Merge Cleanup Gate
**Status:** ✅ Complete

- [x] R005: Add `cleanup_post_merge_failed` classification to messages.ts (pure function like computeMergeFailurePolicy) — returns targetPhase "paused", errorMessage, persistTrigger, notification with per-repo failure details and recovery commands (`/orch-resume`, manual cleanup)
- [x] R005: In engine.ts, after inter-wave reset loop, verify no registered worktrees remain for any repo that should be clean; collect per-repo failure payloads (repo path + stale worktree list); if any failures → call cleanup gate policy → set phase="paused", persist state, emit diagnostic, break wave loop
- [x] R005: Add parity cleanup gate to resume.ts inter-wave reset (same verification + pause + persist pattern)
- [x] R005: Add tests — (a) cleanup failure pauses batch and blocks wave N+1 start, (b) cleanup success still advances normally (regression guard)
- [x] R005: Run full test suite and confirm green (998 tests, 26 files, all pass)

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
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R005 | plan | Step 2 | APPROVE | .reviews/R005-plan-step2.md |

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
| 2026-03-19 20:36 | Worker iter 1 | done in 84s, ctx: 10%, tools: 14 |
| 2026-03-19 20:36 | Step 0 complete | Preflight |
| 2026-03-19 20:36 | Step 1 started | Fix Per-Wave Cleanup Across All Repos |
| 2026-03-19 20:36 | Worker iter 1 | done in 74s, ctx: 10%, tools: 15 |
| 2026-03-19 20:38 | Review R003 | plan Step 1: REVISE |
| 2026-03-19 20:50 | Worker iter 2 | done in 688s, ctx: 55%, tools: 74 |
| 2026-03-19 20:55 | Worker iter 2 | done in 1015s, ctx: 40%, tools: 116 |
| 2026-03-19 21:00 | Review R004 | code Step 1: REVISE |
| 2026-03-19 21:06 | Review R004 | code Step 1: REVISE |
| 2026-03-19 21:09 | Worker iter 2 | done in 538s, ctx: 30%, tools: 46 |
| 2026-03-19 21:09 | Step 1 complete | Fix Per-Wave Cleanup Across All Repos |
| 2026-03-19 21:09 | Step 2 started | Post-Merge Cleanup Gate |
| 2026-03-19 21:12 | Review R005 | plan Step 2: REVISE |
| 2026-03-19 21:17 | Worker iter 2 | done in 646s, ctx: 29%, tools: 76 |
| 2026-03-19 21:17 | Step 1 complete | Fix Per-Wave Cleanup Across All Repos |
| 2026-03-19 21:17 | Step 2 started | Post-Merge Cleanup Gate |
| 2026-03-19 21:19 | Review R005 | plan Step 2: APPROVE |

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

**Step 1 done when:**
1. Inter-wave reset iterates ALL repos that had lanes in the batch, not just primary repoRoot
2. Terminal cleanup iterates ALL encountered repo roots (parity with resume.ts)
3. Merge worktree cleanup (both stale-prep and end-of-wave in merge.ts) applies forceCleanupWorktree fallback
4. Empty .worktrees base dirs (subdirectory mode only) are cleaned after batch container removal
5. Non-empty parents are never force-removed (partial failure safety)
6. Repo active in wave N but not in final wave still gets cleaned up

**Cleanup gate failure classification:**
- New `cleanup_post_merge_failed` classification will be surfaced via `batchState.errors` and exec log.
- Phase transitions: merge succeeded → cleanup attempted → if cleanup fails: phase = "paused", block next wave.

**Step 2 done when:**
1. After inter-wave reset in engine.ts, any repos with remaining registered worktrees are detected and collected as per-repo failure payloads
2. On detection of stale worktrees, batch transitions to phase="paused" with `persistRuntimeState(...)` — survives process restart
3. Diagnostic emitted includes: repo path, stale worktree count, and recovery commands (`/orch-resume`, `git worktree remove`)
4. `computeCleanupGatePolicy()` pure function in messages.ts computes all outputs deterministically (parity pattern with `computeMergeFailurePolicy`)
5. Resume.ts has identical cleanup gate logic after its inter-wave reset loop
6. Tests prove: (a) cleanup failure → paused → wave N+1 blocked, (b) clean pass → normal advance

**Test strategy:**
- `extensions/tests/cleanup-resilience.test.ts` (new) will test multi-repo cleanup iteration, force cleanup fallback, cleanup gate blocking, and autostash cleanup.
- Acceptance criteria from roadmap 2d (lines 441-452): no registered worktrees, no lane branches, no orch branches, no stale autostash, no non-empty .worktrees/ containers.
