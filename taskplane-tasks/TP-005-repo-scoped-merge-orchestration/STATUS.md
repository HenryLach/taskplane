# TP-005: Repo-Scoped Merge Orchestration with Explicit Partial Outcomes — Status

**Current Step:** Step 4: Documentation & Delivery
**Status:** 🟨 In Progress
**Last Updated:** 2026-03-15
**Review Level:** 3
**Review Counter:** 9
**Iteration:** 5
**Size:** L

> **Hydration:** Checkboxes below must be granular — one per unit of work.
> Steps marked `⚠️ Hydrate` will be expanded by the worker.

---

### Step 0: Partition merge flow by repo
**Status:** ✅ Complete

**Contract:** Lanes are grouped by `repoId` (from `AllocatedLane.repoId`). Groups are sorted alphabetically by repoId (undefined → `""` sorts first, preserving mono-repo behavior). Within each group, the existing fewest-files-first or sequential order is preserved. Each group's merge runs against `resolveRepoRoot(repoId)` with `resolveBaseBranch(repoId)`. Mono-repo mode (no repoId) produces one group with `repoId=undefined`, preserving current behavior exactly.

**Failure semantics (Step 0):** On per-repo failure, continue merging remaining repos (best-effort). Aggregate `MergeWaveResult.status`: if ALL repos succeed → `"succeeded"`, if SOME fail → `"partial"`, if ALL fail → `"failed"`. `failedLane` / `failureReason` are set to the first failure across all repos (deterministic due to sorted repo group order).

- [x] Define repo-scoped merge contract: grouping key, ordering, fallback (documented above)
- [x] Add `groupMergeableLanesByRepo()` helper in `merge.ts`
- [x] Refactor `mergeWave()` to iterate per-repo groups with correct `repoRoot` / `baseBranch`
- [x] Aggregate per-repo merge outcomes into single `MergeWaveResult`
- [x] Update engine.ts `/orch` call site to pass `workspaceConfig` to `mergeWave()`
- [x] Update resume.ts `/orch-resume` call sites (both re-exec merge and wave merge) to pass `workspaceConfig`
- [x] Add unit tests: multi-repo grouping determinism
- [x] Add unit tests: mono-repo no-regression (single group, same behavior)
- [x] Add unit tests: deterministic failure aggregation across repos
- [x] Fix messages.ts misleading "into develop" text
- [x] R002 fix: propagate `repoId` on `MergeLaneResult` in both success and error paths
- [x] R002 fix: aggregate status uses lane-level evidence (not repo-level) to fix all-partial misclassification
- [x] R002 fix: add status rollup edge case tests and repoId propagation tests (10 new assertions)
- [x] R002 fix (iter 2): detect repo-level setup failures via anyRepoFailed flag (not just failedLane)
- [x] R002 fix (iter 2): update test helper to use repo-level statuses, add 4 setup-failure test cases

---

### Step 1: Update outcome modeling
**Status:** ✅ Complete

**Contract:** Step 0 already added `repoId` on `MergeLaneResult`, `RepoMergeOutcome` type, and `repoResults` on `MergeWaveResult`. Step 1 adds explicit partial-success summary reporting when repos diverge in merge outcome.

**Reporting semantics:**
- When `mergeResult.status === "partial"` AND `repoResults` has entries with divergent statuses (some succeeded, some failed), emit a repo-attributed summary listing each repo and its outcome.
- When `mergeResult.status === "partial"` but the cause is mixed-outcome lanes (not repo divergence), emit only the existing lane-level failure message (no misleading repo-divergence text).
- Repo summary lines are sorted by repoId (deterministic).
- Both engine.ts and resume.ts use the same shared formatter for parity.
- Notification level: `"warning"` for the partial summary (since some repos succeeded).

- [x] Add `formatRepoMergeSummary()` shared helper in `messages.ts`
- [x] Add `orchMergePartialRepoSummary` template to `ORCH_MESSAGES`
- [x] Wire partial-summary emission in `engine.ts` after merge result handling
- [x] Wire partial-summary emission in `resume.ts` after merge result handling (parity)
- [x] Add tests: deterministic repo partial-summary formatting
- [x] Add tests: no repo-divergence text when partial is from mixed-outcome lanes only
- [x] Add tests: engine vs resume message parity (same formatter used)
- [x] Add tests: mono-repo (empty repoResults) produces no repo summary

---

### Step 2: Harden failure behavior
**Status:** ✅ Complete

**Contract:**

**Deterministic failure attribution rules:**
- `failedLaneIds` is built from `MergeWaveResult.laneResults` with `CONFLICT_UNRESOLVED`, `BUILD_FAILURE`, or `error` status. Lanes are listed in their merge result order (which is deterministic due to sorted repo groups from `mergeWaveByRepo`).
- When no lane-level failures exist but `mergeResult.failedLane` is non-null, `failedLaneIds` falls back to `lane-<N>`.
- For repo-level setup failures (`failedLane=null`, `status="failed"`, empty `laneResults`), `failedLaneIds` falls back to `repo:<repoId>` labels from `repoResults` entries with non-succeeded status. When no `repoResults` exist (mono-repo mode), `failedLaneIds` is empty string.
- First-failure ordering is deterministic because `mergeWaveByRepo` processes repos in alphabetical order and `firstFailedLane`/`firstFailureReason` capture the first.

**Policy transition rules:**
- `on_merge_failure: "pause"` → `batchState.phase = "paused"`, persist with `"merge-failure-pause"` trigger, set `preserveWorktreesForResume = true`, break wave loop.
- `on_merge_failure: "abort"` → `batchState.phase = "stopped"`, persist with `"merge-failure-abort"` trigger, set `preserveWorktreesForResume = true`, break wave loop.
- Both engine.ts and resume.ts use the shared `computeMergeFailurePolicy()` helper in `messages.ts` to guarantee identical decisions and messages.

**Artifact preservation rules:**
- On pause/abort: lane worktrees are preserved (NOT cleaned up) for manual intervention.
- `.pi/batch-state.json` is persisted BEFORE the cleanup-skip decision (captures phase, error, wave plan, lane records).
- Merge result sidecar files (`.pi/merge-result-*.json`) are left in place by `mergeWave()` (never cleaned up on failure).
- Merge request sidecar files are cleaned up per-lane after each merge attempt.
- Lane state files (`.pi/lane-state-*.json`) and worker conversation files remain for debugging.
- On success: all artifacts are cleaned up in Phase 3 (engine.ts) / step 11 (resume.ts).

- [x] Extract shared `computeMergeFailurePolicy()` pure function in messages.ts
- [x] Refactor engine.ts merge-failure handler to use `computeMergeFailurePolicy()`
- [x] Refactor resume.ts merge-failure handler to use `computeMergeFailurePolicy()` (parity)
- [x] Add tests: pause policy produces correct phase/trigger/message (test 19)
- [x] Add tests: abort policy produces correct phase/trigger/message (test 20)
- [x] Add tests: setup-failure attribution with failedLane=null (test 21)
- [x] Add tests: multi-lane failure attribution (test 22)
- [x] Add tests: engine vs resume parity — same function, same output (test 23)
- [x] Add tests: reason truncation in notifications vs full in errors (test 24)
- [x] Add tests: deterministic first-failure across repos (test 25)
- [x] Add repo-level fallback in `computeMergeFailurePolicy()` for setup failures with `repoResults`
- [x] Add tests: repo-level fallback for single-repo setup failure (test 26)
- [x] Add tests: multi-repo setup failure fallback (test 27)
- [x] Add tests: lane-level priority over repo-level fallback (test 28)
- [x] Add tests: preserveWorktrees contract structural verification (test 29)
- [x] Verify all 207 tests pass (11 files)

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

**Verification matrix (maps to Step 0–2 contracts):**

- **Step 0 contracts verified via `merge-repo-scoped.test.ts`:** repo grouping determinism, status rollup correctness, repoId propagation, setup-failure detection
- **Step 1 contracts verified via `merge-repo-scoped.test.ts`:** repo-divergence partial summary formatting, mono-repo no-summary behavior, engine/resume parity
- **Step 2 contracts verified via `merge-repo-scoped.test.ts`:** `computeMergeFailurePolicy()` pause/abort transitions, repo fallback labeling, engine/resume parity, preserve-worktrees contract

**Failure triage policy:** If targeted suite fails → fix, rerun impacted files, then rerun full suite. Step 3 is NOT complete until full suite is green.

**Evidence requirement:** Record exact commands + pass counts in Execution Log for each checkpoint.

- [x] 3.1 Targeted: `cd extensions && npx vitest run tests/merge-repo-scoped.test.ts` → 1 file, 1 test passed (all 29 internal assertion groups green)
- [x] 3.2 Targeted: `cd extensions && npx vitest run tests/orch-state-persistence.test.ts` → 1 file, 1 test passed
- [x] 3.3 Targeted: `cd extensions && npx vitest run tests/orch-direct-implementation.test.ts` → 1 file, 1 test passed
- [x] 3.4 Full regression: `cd extensions && npx vitest run` → 11 files, 207 tests passed, 0 failures
- [x] 3.5 CLI smoke: `node bin/taskplane.mjs help` — exit 0, clean output, v0.1.17
- [x] 3.6 All failures triaged and fixed (if any) — no failures found, N/A
- [x] 3.7 Final full regression green after any fixes — 3.4 was already the final green run (no fixes needed)

---

### Step 4: Documentation & Delivery
**Status:** 🟨 In Progress

**Must Update:** `.pi/local/docs/taskplane/polyrepo-support-spec.md`
**Check If Affected:** `docs/reference/commands.md`

**Note:** `polyrepo-support-spec.md` is a `.pi/local/` file (gitignored, local-only). It exists at `C:\dev\taskplane\.pi\local\docs\taskplane\polyrepo-support-spec.md` in the main repo. The worktree does not have `.pi/local/`. Update is applied directly to the main repo's local docs.

**R008 REVISE resolution:** R008 findings (deduped review row, CLI command format, execution log cleanup) were addressed in commit `6499df8` during Step 3 iteration. No further action needed — structural fixes already applied.

- [x] 4.1 Update `polyrepo-support-spec.md` Section 9 (Merge): add per-repo merge sequencing, deterministic ordering, non-atomic outcomes, partial/failure rollup semantics as delivered by TP-005
- [x] 4.2 Update `polyrepo-support-spec.md` Section 14 (Phase 2): mark repo-scoped merge flow as delivered (TP-005)
- [x] 4.3 Review `docs/reference/commands.md`: **not updated** — command syntax, flags, and documented behavior are unchanged. TP-005 adds internal merge orchestration changes (repo-scoped grouping) and a new partial-success notification (`⚠️ Merge partially succeeded — repo outcomes diverged`), but this is a runtime notification in workspace mode only, not a change to command surface or documented output format. No operator-facing merge output format change that would require doc updates.
- [x] 4.4 Log discoveries in STATUS.md Discoveries table
- [ ] 4.5 Create `.DONE` in task folder

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | APPROVE | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | APPROVE | .reviews/R004-code-step1.md |
| R004 | code | Step 1 | APPROVE | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R006 | code | Step 2 | APPROVE | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R007 | plan | Step 3 | APPROVE | .reviews/R007-plan-step3.md |
| R008 | code | Step 3 | APPROVE | .reviews/R008-code-step3.md |
| R008 | code | Step 3 | REVISE | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| `mergeWave()` status rollup used lane-level evidence only, missing repo-level setup failures (e.g., temp branch creation failure where `failedLane=null`). Fixed by introducing `anyRepoFailed` tracking flag. | Fixed (TP-005 Step 0, R002) | `merge.ts:mergeWaveByRepo()` |
| Engine.ts and resume.ts had duplicated merge-failure policy logic (phase transitions, error messages, notification formatting). Divergence risk was high. Extracted shared `computeMergeFailurePolicy()` pure function. | Fixed (TP-005 Step 2) | `messages.ts`, `engine.ts`, `resume.ts` |
| `ORCH_MESSAGES.orchMergeStart` had misleading hardcoded text "into develop" even after `integration_branch` was removed in favor of runtime `baseBranch`. Fixed to say "into target branch". | Fixed (TP-005 Step 0) | `messages.ts` |

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-15 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-15 16:49 | Task started | Extension-driven execution |
| 2026-03-15 16:49 | Step 0 started | Partition merge flow by repo |
| 2026-03-15 16:49 | Task started | Extension-driven execution |
| 2026-03-15 16:49 | Step 0 started | Partition merge flow by repo |
| 2026-03-15 16:52 | Review R001 | plan Step 0: UNKNOWN |
| 2026-03-15 17:05 | Step 0 hydrated | Plan expanded per R001 findings |
| 2026-03-15 17:05 | Step 0 impl | groupLanesByRepo + mergeWaveByRepo in merge.ts |
| 2026-03-15 17:05 | Step 0 impl | engine.ts + resume.ts call sites already wired (TP-004) |
| 2026-03-15 17:05 | Step 0 impl | messages.ts "into develop" → "into target branch" |
| 2026-03-15 17:05 | Step 0 tests | merge-repo-scoped.test.ts — all 207 tests pass |
| 2026-03-15 16:53 | Review R001 | plan Step 0: REVISE |
| 2026-03-15 17:04 | Step 0 implemented | groupLanesByRepo + mergeWaveByRepo, engine/resume updated, tests pass (216/216) |
| 2026-03-15 17:04 | Worker iter 1 | done in 672s, ctx: 46%, tools: 84 |
| 2026-03-15 17:09 | Review R002 | code Step 0: REVISE |
| 2026-03-15 17:12 | Worker iter 1 | done in 1233s, ctx: 72%, tools: 132 |
| 2026-03-15 17:12 | R002 fixes committed | repoId propagation, status rollup, tests (d08694e) |
| 2026-03-15 17:13 | Step 0 re-verified | All 207 tests pass (40 merge-repo-scoped assertions) |
| 2026-03-15 17:14 | Worker iter 1 | done in 297s, ctx: 24%, tools: 40 |
| 2026-03-15 17:14 | Step 0 complete | Partition merge flow by repo |
| 2026-03-15 17:14 | Step 1 started | Update outcome modeling |
| 2026-03-15 17:16 | Review R002 | code Step 0: REVISE |
| 2026-03-15 17:16 | Review R003 | plan Step 1: REVISE |
| 2026-03-15 17:20 | Step 1 hydrated | Plan expanded per R003 findings |
| 2026-03-15 17:21 | Step 1 impl | formatRepoMergeSummary + orchMergePartialRepoSummary in messages.ts |
| 2026-03-15 17:21 | Step 1 impl | Wired partial-summary emission in engine.ts + resume.ts (parity) |
| 2026-03-15 17:21 | Step 1 tests | 8 new assertions for repo-divergence summaries |
| 2026-03-15 17:21 | Step 1 verified | All 207 tests pass (11 files) |
| 2026-03-15 17:21 | Step 1 committed | db6e5a1 |
| 2026-03-15 17:19 | R002 iter2 fixes | anyRepoFailed flag + 4 setup-failure tests (f5ae458) |
| 2026-03-15 17:19 | Step 0 re-verified | All 207 tests pass (44 merge-repo-scoped assertions) |
| 2026-03-15 17:21 | Worker iter 1 | done in 277s, ctx: 24%, tools: 31 |
| 2026-03-15 17:21 | Step 0 complete | Partition merge flow by repo |
| 2026-03-15 17:21 | Step 1 started | Update outcome modeling |
| 2026-03-15 17:22 | Review R003 | plan Step 1: APPROVE |
| 2026-03-15 17:23 | Worker iter 2 | done in 376s, ctx: 41%, tools: 47 |
| 2026-03-15 17:25 | Review R004 | code Step 1: APPROVE |
| 2026-03-15 17:25 | Step 1 complete | Update outcome modeling |
| 2026-03-15 17:25 | Step 2 started | Harden failure behavior |
| 2026-03-15 17:27 | Review R004 | code Step 1: APPROVE |
| 2026-03-15 17:27 | Step 1 complete | Update outcome modeling |
| 2026-03-15 17:27 | Step 2 started | Harden failure behavior |
| 2026-03-15 17:27 | Review R005 | plan Step 2: REVISE |
| 2026-03-15 17:33 | Step 2 hydrated | Plan expanded per R005 findings |
| 2026-03-15 17:33 | Step 2 impl | computeMergeFailurePolicy() shared helper in messages.ts |
| 2026-03-15 17:33 | Step 2 impl | Refactored engine.ts + resume.ts to use shared helper (parity) |
| 2026-03-15 17:33 | Step 2 tests | 7 new test sections (19-25) for failure policy determinism + parity |
| 2026-03-15 17:33 | Step 2 verified | All 207 tests pass (11 files) |
| 2026-03-15 17:29 | Review R005 | plan Step 2: REVISE |
| 2026-03-15 17:34 | Worker iter 2 | done in 403s, ctx: 45%, tools: 49 |
| 2026-03-15 17:35 | Step 2 iter3 | Repo-level fallback for setup failures in computeMergeFailurePolicy() |
| 2026-03-15 17:35 | Step 2 tests | 4 new test sections (26-29) for repo fallback + lane priority + preserve contract |
| 2026-03-15 17:35 | Step 2 verified | All 207 tests pass (11 files) |
| 2026-03-15 17:37 | Worker iter 3 | done in 513s, ctx: 52%, tools: 70 |
| 2026-03-15 17:37 | Review R006 | code Step 2: APPROVE |
| 2026-03-15 17:37 | Step 2 complete | Harden failure behavior |
| 2026-03-15 17:37 | Step 3 started | Testing & Verification |
| 2026-03-15 17:39 | Review R007 | plan Step 3: REVISE |
| 2026-03-15 17:40 | Step 3 hydrated | Concrete verification matrix per R007 findings |
| 2026-03-15 17:40 | Step 3.1 | Targeted merge-repo-scoped.test.ts → 1 file, 1 test, all assertions green |
| 2026-03-15 17:40 | Step 3.2 | Targeted orch-state-persistence.test.ts → 1 file, 1 test passed |
| 2026-03-15 17:40 | Step 3.3 | Targeted orch-direct-implementation.test.ts → 1 file, 1 test passed |
| 2026-03-15 17:41 | Step 3.4 | Full regression: 11 files, 207 tests passed, 0 failures |
| 2026-03-15 17:41 | Step 3.5 | CLI smoke: `node bin/taskplane.mjs help` → exit 0, v0.1.17 |
| 2026-03-15 17:41 | Step 3 complete | Testing & Verification — all green, no fixes needed |
| 2026-03-15 17:42 | Review R007 | plan Step 3: APPROVE |
| 2026-03-15 17:42 | Worker iter 3 | done in 177s, ctx: 11%, tools: 23 |
| 2026-03-15 17:44 | Review R008 | code Step 3: APPROVE |
| 2026-03-15 17:44 | Step 3 complete | Testing & Verification |
| 2026-03-15 17:44 | Step 4 started | Documentation & Delivery |
| 2026-03-15 17:45 | Review R008 | code Step 3: REVISE |
| 2026-03-15 17:46 | Step 3 R008 fixes | Deduped R006 review row, fixed CLI command to exact form, cleaned duplicate execution log entries |
| 2026-03-15 17:46 | Worker iter 3 | done in 106s, ctx: 11%, tools: 18 |
| 2026-03-15 17:46 | Step 3 complete | Testing & Verification |
| 2026-03-15 17:46 | Step 4 started | Documentation & Delivery |
| 2026-03-15 17:47 | Review R009 | plan Step 4: REVISE |
| 2026-03-15 17:48 | Review R009 | plan Step 4: REVISE |
| 2026-03-15 17:50 | Worker iter 4 | error (code 3221225786) in 104s, ctx: 16%, tools: 20 |

## Blockers

*None*

## Notes

*Reserved for execution notes*
