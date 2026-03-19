# TP-028: Partial Progress Preservation — Status

**Current Step:** Step 4: Documentation & Delivery
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 9
**Iteration:** 6
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read worktree cleanup logic
- [x] Read task outcome recording
- [x] Read roadmap Phase 2 section 2a
- [x] Understand existing saved-branch logic
- [x] R001: Read CONTEXT.md (Tier 2) and persistence.ts serialization contract
- [x] R001: Read naming.ts and diagnostics.ts partialProgress fields for naming alignment
- [x] R001: Identify all cleanup call sites and document insertion points for Steps 1-2
- [x] R002: Fix Reviews table format and remove inconsistent duplicate entries
- [x] R002: Fix top-level metadata to reflect actual state

---

### Step 1: Detect and Save Partial Progress
**Status:** ✅ Complete

- [x] Implement `savePartialProgress()` helper in worktree.ts: counts commits on lane branch vs target, creates saved branch with task-ID naming, handles collisions via resolveSavedBranchCollision, returns partial progress info
- [x] Add `preserveFailedLaneProgress()` orchestration function in worktree.ts: iterates task outcomes, finds failed tasks with lane branches, calls savePartialProgress for each, returns set of preserved branch names
- [x] Insert preservation call before inter-wave reset in engine.ts (R003 critical: prevents commit loss during between-wave resets)
- [x] Insert preservation call before terminal cleanup in engine.ts removeAllWorktrees
- [x] Insert preservation call before terminal cleanup in resume.ts removeAllWorktrees
- [x] Pass preserved branch names to cleanup so ensureBranchDeleted skips them (R003: exemption mechanism) — Design decision: NOT NEEDED. savePartialProgress() creates a separate saved branch (saved/{opId}-{taskId}-{batchId}) at the lane branch SHA BEFORE cleanup. The lane branch can be safely deleted during cleanup since the saved branch preserves the commits independently. Existing ensureBranchDeleted may also create saved/task/... which is redundant but harmless.
- [x] R004: Log explicit warnings for failed preservation attempts (per-task: taskId, laneBranch, repoId, error, commitCount) at all call sites in engine.ts and resume.ts
- [x] R004: Handle failed-preservation-with-commits in inter-wave reset: skip worktree reset for lanes where preservation failed but commits existed (prevents commit loss)
- [x] R004: Fix `preservedBranches` contract mismatch — update comments/interface to document that lane branches ARE still deleted (saved branch independently preserves commits), removing misleading "should NOT be deleted" language

---

### Step 2: Record Partial Progress in Task Outcome
**Status:** ✅ Complete

- [x] Add optional `partialProgressCommits` (number) and `partialProgressBranch` (string|null) to `LaneTaskOutcome` and `PersistedTaskRecord` in types.ts, with backward-compat defaults (0 / undefined)
- [x] Update `upsertTaskOutcome()` change detection in persistence.ts to include the new fields
- [x] Update all outcome construction sites (seedPendingOutcomesForAllocatedLanes, syncTaskOutcomesFromMonitor, resume.ts reconstitution) to carry/default the new fields
- [x] Update `serializeBatchState()` in persistence.ts to map the new fields from `LaneTaskOutcome` → `PersistedTaskRecord`
- [x] Add validation for the new optional fields in the state-file validation block in persistence.ts (backward-compatible: allow undefined)
- [x] Populate fields at all 4 `preserveFailedLaneProgress()` call sites: engine.ts inter-wave, engine.ts terminal, resume.ts inter-wave, resume.ts terminal — update task outcomes with ppResult data after preservation
- [x] R006: Fix nullability contract mismatch — normalize `partialProgressBranch` to `string | undefined` across LaneTaskOutcome, PersistedTaskRecord, serialization, and validation (currently typed as `string | null` in LaneTaskOutcome but validation rejects null)
- [x] R006: Ensure serialization skips writing `partialProgressBranch` when undefined, and validate round-trip correctness at all boundaries

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

- [x] Branch preservation behavior tests: savePartialProgress (repo/workspace naming, no-commits skip, collision idempotency same-SHA, collision different-SHA suffixed), preserveFailedLaneProgress (happy path, unsafeBranches for failed preservation with commits, error handling for missing branches)
- [x] State contract tests: persistence round-trip with partialProgress fields present/absent, validation accepts/rejects correct types, serialization skips undefined fields
- [x] Full test suite passes (`cd extensions && npx vitest run`) — 997/997 tests, 25/25 files
- [x] R008: Fix flaky "no change when fields are identical" test — use fixed timestamps instead of Date.now()
- [x] R008: Add integration tests with disposable git repos for savePartialProgress and preserveFailedLaneProgress (lane with commits → saved branch, no commits → skip, collision handling, unsafeBranches population)
- [x] R008: Update STATUS.md test count evidence to match actual output

---

### Step 4: Documentation & Delivery
**Status:** 🟨 In Progress

- [x] Inline comments updated in worktree.ts, engine.ts, resume.ts, types.ts, persistence.ts for partial progress preservation
- [x] Docs-impact decision: `/orch-status` output is summary-only (counts, phase, wave, elapsed) — does NOT expose saved branch names or per-task partial progress data. No docs/reference/commands.md update needed.
- [x] Closeout evidence note recorded in Execution Log
- [x] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R008 | code | Step 3 | REVISE | .reviews/R008-code-step3.md |
| R008 | code | Step 3 | REVISE | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |

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
| 2026-03-19 19:08 | Worker iter 1 | done in 163s, ctx: 36%, tools: 33 |
| 2026-03-19 19:09 | Worker iter 1 | done in 228s, ctx: 45%, tools: 42 |
| 2026-03-19 19:10 | Worker iter 2 | done in 149s, ctx: 19%, tools: 30 |
| 2026-03-19 19:11 | Review R002 | code Step 0: REVISE |
| 2026-03-19 | R002 revisions | Fixed Reviews table format, removed duplicate R001 entry, updated metadata |
| 2026-03-19 19:12 | Worker iter 1 | done in 78s, ctx: 10%, tools: 15 |
| 2026-03-19 19:12 | Step 0 complete | Preflight |
| 2026-03-19 19:12 | Step 1 started | Detect and Save Partial Progress |
| 2026-03-19 19:12 | Review R002 | code Step 0: REVISE |
| 2026-03-19 19:13 | Worker iter 2 | done in 18s, ctx: 7%, tools: 3 |
| 2026-03-19 19:13 | Step 0 complete | Preflight |
| 2026-03-19 19:13 | Step 1 started | Detect and Save Partial Progress |
| 2026-03-19 19:16 | Review R003 | plan Step 1: REVISE |
| 2026-03-19 19:16 | Review R003 | plan Step 1: REVISE |
| 2026-03-19 19:24 | Worker iter 3 | done in 445s, ctx: 36%, tools: 57 |
| 2026-03-19 19:26 | Worker iter 2 | done in 638s, ctx: 45%, tools: 77 |
| 2026-03-19 19:30 | Review R004 | code Step 1: REVISE |
| 2026-03-19 19:33 | Review R004 | code Step 1: REVISE |
| 2026-03-19 19:37 | Worker iter 3 | done in 414s, ctx: 23%, tools: 46 |
| 2026-03-19 19:37 | Step 1 complete | Detect and Save Partial Progress |
| 2026-03-19 19:37 | Step 2 started | Record Partial Progress in Task Outcome |
| 2026-03-19 19:38 | Worker iter 2 | done in 320s, ctx: 24%, tools: 52 |
| 2026-03-19 19:38 | Step 1 complete | Detect and Save Partial Progress |
| 2026-03-19 19:38 | Step 2 started | Record Partial Progress in Task Outcome |
| 2026-03-19 19:41 | Review R005 | plan Step 2: REVISE |
| 2026-03-19 19:41 | Review R005 | plan Step 2: REVISE |
| 2026-03-19 19:49 | Worker iter 3 | done in 439s, ctx: 30%, tools: 76 |
| 2026-03-19 19:49 | Worker iter 4 | done in 517s, ctx: 31%, tools: 86 |
| 2026-03-19 19:53 | Review R006 | code Step 2: REVISE |
| 2026-03-19 19:53 | Review R006 | code Step 2: REVISE |
| 2026-03-19 19:57 | Worker iter 3 | done in 221s, ctx: 13%, tools: 28 |
| 2026-03-19 19:57 | Step 2 complete | Record Partial Progress in Task Outcome |
| 2026-03-19 19:57 | Step 3 started | Testing & Verification |
| 2026-03-19 19:57 | Worker iter 4 | done in 240s, ctx: 15%, tools: 34 |
| 2026-03-19 19:57 | Step 2 complete | Record Partial Progress in Task Outcome |
| 2026-03-19 19:57 | Step 3 started | Testing & Verification |
| 2026-03-19 20:00 | Review R007 | plan Step 3: REVISE |
| 2026-03-19 20:00 | Review R007 | plan Step 3: REVISE |
| 2026-03-19 20:07 | Worker iter 4 | done in 428s, ctx: 27%, tools: 57 |
| 2026-03-19 20:09 | Worker iter 5 | done in 568s, ctx: 30%, tools: 59 |
| 2026-03-19 20:13 | Review R008 | code Step 3: REVISE |
| 2026-03-19 20:17 | Review R008 | code Step 3: REVISE |
| 2026-03-19 20:22 | Worker iter 4 | done in 566s, ctx: 33%, tools: 38 |
| 2026-03-19 20:22 | Step 3 complete | Testing & Verification |
| 2026-03-19 20:22 | Step 4 started | Documentation & Delivery |
| 2026-03-19 20:23 | Worker iter 5 | done in 334s, ctx: 11%, tools: 14 |
| 2026-03-19 20:23 | Step 3 complete | Testing & Verification |
| 2026-03-19 20:23 | Step 4 started | Documentation & Delivery |
| 2026-03-19 20:24 | Review R009 | plan Step 4: REVISE |
| 2026-03-19 | Step 4 closeout | Inline comments verified across worktree.ts (savePartialProgress, preserveFailedLaneProgress, computePartialProgressBranchName, resolveSavedBranchCollision, interfaces), engine.ts (inter-wave + terminal preservation blocks with TP-028 markers), resume.ts (matching preservation blocks + carry-forward), types.ts (LaneTaskOutcome + PersistedTaskRecord field docs), persistence.ts (applyPartialProgressToOutcomes, serialization, validation). /orch-status docs unchanged — output is summary-only, no saved branch exposure. |
| 2026-03-19 20:25 | Review R009 | plan Step 4: REVISE |

---

## Blockers

*None*

---

## Notes

### Preflight Findings (Step 0)

**Cleanup call sites (Step 1 insertion points):**
1. `engine.ts:726` — `removeAllWorktrees()` in post-batch cleanup (end-of-batch). Uses `orchBranch` as targetBranch. This is the PRIMARY insertion point — partial progress save should happen BEFORE this cleanup.
2. `resume.ts:1410` — `removeAllWorktrees()` in resume terminal cleanup (section 11). Per-repo with per-repo targetBranch. Same pattern — save before cleanup.
3. `engine.ts:557` — `forceCleanupWorktree()` in inter-wave worktree reset failure path. This is for BETWEEN waves, not end-of-batch — partial progress save not needed here (task will be retried).
4. `resume.ts:1365` — `forceCleanupWorktree()` in resume pre-execution reset. Same as #3 — between-wave, not relevant.

**Key insight:** Partial progress preservation should happen BEFORE `removeAllWorktrees()` calls at batch end (sites #1 and #2), not during. We need to iterate over failed task outcomes, check each lane branch for commits ahead of base, and create saved branches BEFORE cleanup deletes them.

**Existing branch preservation compatibility:**
- `removeAllWorktrees()` already calls `removeWorktree()` → `ensureBranchDeleted()` → `preserveBranch()` which preserves branches with unmerged commits vs `targetBranch` as `saved/{originalBranch}`.
- TP-028 adds a DIFFERENT preservation: saving branches for FAILED tasks specifically, with task-ID-based naming (`saved/{opId}-{taskId}-{batchId}`).
- These are complementary, not conflicting. The existing merge-aware preservation handles success-path branch safety; TP-028 handles failure-path progress recovery.

**Naming alignment:**
- `diagnostics.ts` already has `partialProgressCommits: number` and `partialProgressBranch: string | null` in `TaskExitDiagnostic`.
- New fields on `LaneTaskOutcome` and `PersistedTaskRecord` should use the same names.
- Saved branch naming: `saved/{opId}-{taskId}-{batchId}` (repo mode) or `saved/{opId}-{repoId}-{taskId}-{batchId}` (workspace mode) per roadmap spec.

**Serialization path (Step 2):**
- `persistence.ts:serializeBatchState()` maps `LaneTaskOutcome` → `PersistedTaskRecord`.
- Add `partialProgressCommits` and `partialProgressBranch` to both types.
- The mapping in `serializeBatchState()` at line ~721 already handles optional fields pattern (see `repoId`, `resolvedRepoId`).
