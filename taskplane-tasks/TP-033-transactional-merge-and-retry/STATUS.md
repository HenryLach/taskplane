# TP-033: Transactional Merge Envelope & Retry Matrix — Status

**Current Step:** Step 4: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-03-20
**Review Level:** 2
**Review Counter:** 10
**Iteration:** 5
**Size:** L

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read merge flow end-to-end
- [x] Read v3 state retry fields
- [x] Read roadmap Phase 4 sections
- [x] R002: Fix Reviews table structure (separator after header) and normalize Execution Log timestamps

---

### Step 1: Transaction Envelope
**Status:** ✅ Complete
- [x] Define TransactionRecord interface in types.ts with required fields: opId, batchId, waveIndex, laneNumber, repoId, baseHEAD, laneHEAD, mergedHEAD, status, rollbackAttempted, rollbackResult, recoveryCommands, timestamps
- [x] Capture baseHEAD (temp branch HEAD before lane merge) and laneHEAD (source branch tip) at merge start; capture mergedHEAD after successful merge commit
- [x] On verification_new_failure: rollback to baseHEAD (existing TP-032 logic); record rollback result in transaction record
- [x] On rollback failure: implement safe-stop — set MergeWaveResult flag `rollbackFailed`, emit recovery commands in transaction record, signal engine to force `paused` regardless of on_merge_failure policy, preserve merge worktree and temp branch (skip cleanup)
- [x] Engine integration: detect rollbackFailed flag in MergeWaveResult and force paused phase + preserveWorktreesForResume regardless of config policy
- [x] Persist transaction record JSON to `.pi/verification/{opId}/txn-b{batchId}-repo-{repoId}-wave-{n}-lane-{k}.json` after each lane merge completes (success, failure, or safe-stop)
- [x] Handle repo-mode (repoId undefined): sanitize filename to use "default" when repoId is absent
- [x] R004-1: Short-circuit mergeWaveByRepo repo-group loop on rollbackFailed — stop processing subsequent repo groups when anyRollbackFailed becomes true; leave unprocessed repo groups untouched
- [x] R004-2: Surface transaction record persistence failure in merge outcome — add persistenceErrors to MergeWaveResult and include warning when txn write fails so recovery guidance remains actionable
- [x] R004-3: All tests pass after R004 revisions

---

### Step 2: Retry Policy Matrix
**Status:** ✅ Complete
- [x] Define MergeFailureClassification type and per-class retry policy matrix (verification_new_failure: max 1/0s, merge_conflict_unresolved: no retry, cleanup_post_merge_failed: max 1/2s + wave gate, git_worktree_dirty: max 1/2s, git_lock_file: max 2/3s) as a centralized pure lookup in types.ts
- [x] Implement classifyMergeFailure helper to map MergeWaveResult + lane errors to MergeFailureClassification
- [x] Update retryCountByScope key format to `{repoId}:w{N}:l{K}` with "default" fallback for repo mode; add migration/compat note in JSDoc
- [x] Implement computeMergeRetryDecision pure helper in messages.ts: given classification + current retry count + policy matrix → returns retry-allowed, cooldown, or exhaustion-pause action
- [x] Integrate retry decision into engine.ts merge failure handling: before applying pause/abort policy, check retry matrix; if retriable and under max, sleep cooldown then re-invoke mergeWaveByRepo; persist incremented retry counter to batch state
- [x] Mirror retry integration in resume.ts for execution/resume parity
- [x] Ensure cleanup_post_merge_failed remains a hard wave gate (no advancement to next wave) — existing computeCleanupGatePolicy already handles this; verify no bypass
- [x] On retry exhaustion: enter paused with diagnostic message including classification, attempt count, and scope key
- [x] R006-1: Extract shared `applyMergeRetryLoop` helper used by both engine.ts and resume.ts; wrap retry in a loop that re-classifies after each failed attempt, supports maxAttempts>1 (e.g. git_lock_file), and returns structured outcome
- [x] R006-2: On retry exhaustion, force `paused` phase regardless of `on_merge_failure` config (do not route through computeMergeFailurePolicy); emit matrix-specific diagnostics
- [x] R006-3: Improve repo-scoped key extraction for setup failures (failedLane===null) by falling back to repoResults metadata
- [x] R006-4: All tests pass after R006 revisions

---

### Step 3: Testing & Verification
**Status:** ✅ Complete
- [x] Transaction record tests: successful merge captures pre/post refs (baseHEAD, laneHEAD, mergedHEAD) in record
- [x] Rollback tests: verification failure triggers rollback to baseHEAD
- [x] Safe-stop tests: rollback failure enters safe-stop with preserved state, recovery commands emitted, engine/resume force paused
- [x] Non-retriable class test: merge_conflict_unresolved immediately enters paused with no retry
- [x] Multi-attempt retry test: git_lock_file retries up to maxAttempts=2, then exhaustion-pauses
- [x] Cooldown delay test: retry enforces cooldown delay (non-zero) between attempts
- [x] Retry counter persistence tests: counters persist and increment in batch state scoped by repoId:w{N}:l{K}
- [x] Exhaustion tests: max attempts exhaustion forces paused regardless of on_merge_failure config
- [x] Engine/resume parity test: same failure classification leads to same phase transition and counter updates in both engine.ts and resume.ts code paths
- [x] Transaction persistence warning test: persistence failure surfaces in merge outcome with recovery guidance
- [x] Workspace-scoped counter tests: retry counters scoped by repoId in workspace mode
- [x] Full test suite passes (all existing + new tests)

---

### Step 4: Documentation & Delivery
**Status:** ✅ Complete
- [x] Document merge retry policy in task-orchestrator.yaml.md: failure classifications table, retriable vs non-retriable behavior, max attempts/cooldowns, exhaustion behavior, scope key format, and precedence with on_merge_failure
- [x] Assess commands.md impact — no update needed: TP-033 changes are internal to the merge flow (MergeWaveResult fields, retry logic, transaction records). No new commands, changed flags, or user-facing command output format changes. The retry/safe-stop behavior surfaces through existing pause/status mechanisms.
- [x] Completion gate: docs reflect implemented behavior, impact check done, STATUS/review entries current → `.DONE` created
- [x] R010-1: Fix non-retriable failure behavior description — non-retriable classes fall through to standard `on_merge_failure` policy (pause or abort), NOT forced pause. Update "Retry behavior" step 5 and `merge_conflict_unresolved` exhaustion action column. Add explicit note: forced pause overrides config only on retry exhaustion and rollback safe-stop.
- [x] R010-2: Remove stale `.DONE` and re-create after fixes verified

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | Step 0 | APPROVE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R008 | code | Step 3 | APPROVE | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
| R010 | code | Step 4 | REVISE | .reviews/R010-code-step4.md |

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| TP-032 already captures `preLaneHead` and rolls back on `verification_new_failure` with `blockAdvancement` flag. TP-033 must formalize this into a transaction record with `laneHEAD` and `mergedHEAD`, add safe-stop semantics (force `paused` + preserve all state + emit recovery commands), and persist the transaction record JSON. | Inform Step 1 design | `extensions/taskplane/merge.ts:420-480` |
| `ResilienceState.retryCountByScope` already exists in v3 types, keyed by `{taskId}:w{waveIndex}:l{laneNumber}`. PROMPT specifies `{repoId}:w{N}:l{K}` scoping. Must align scope key format with the roadmap's `(repoId, wave, lane)` tuple. | Inform Step 2 design | `extensions/taskplane/types.ts` |
| Retry policy matrix from roadmap §4c defines 15 failure classes. Only merge-related classes are in scope for TP-033: `verification_new_failure`, `merge_conflict_unresolved`, `cleanup_post_merge_failed`, `git_worktree_dirty`, `git_lock_file`. Task-level classes (api_error, context_overflow, etc.) are Phase 1/3 concerns. | Scope clarification | Roadmap §4c |

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-19 00:00 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-20 12:13 | Task started | Extension-driven execution |
| 2026-03-20 12:13 | Step 0 started | Preflight |
| 2026-03-20 12:14 | Review R001 | plan Step 0: APPROVE |
| 2026-03-20 12:16 | Step 0 complete | Read merge.ts (1770 lines), engine.ts (580 lines), types.ts (2257 lines), roadmap Phase 4 §4b/§4c. Identified TP-032 overlap, scope key format alignment needed, merge-related retry classes scoped. |
| 2026-03-20 12:16 | Worker iter 1 | done in 107s, ctx: 45%, tools: 19 |
| 2026-03-20 12:18 | Review R002 | code Step 0: REVISE |
| 2026-03-20 12:20 | R002 fixes applied | Fixed Reviews table separator order, normalized Execution Log timestamps to date+time |
| 2026-03-20 12:19 | Worker iter 1 | done in 73s, ctx: 10%, tools: 15 |
| 2026-03-20 12:19 | Step 0 complete | Preflight |
| 2026-03-20 12:19 | Step 1 started | Transaction Envelope |
| 2026-03-20 12:21 | Review R003 | plan Step 1: REVISE |
| 2026-03-20 08:35 | Step 1 complete | TransactionRecord interface + baseHEAD/laneHEAD/mergedHEAD capture + rollback tracking + safe-stop with worktree preservation + engine/resume force-paused on rollbackFailed + persistTransactionRecord to .pi/verification/ + mergeWaveByRepo propagation. All 1564 tests pass. |
| 2026-03-20 12:35 | Worker iter 2 | done in 828s, ctx: 35%, tools: 77 |
| 2026-03-20 12:39 | Review R004 | code Step 1: REVISE |
| 2026-03-20 12:46 | Worker iter 2 | done in 374s, ctx: 21%, tools: 46 |
| 2026-03-20 12:46 | Step 1 complete | Transaction Envelope |
| 2026-03-20 12:46 | Step 2 started | Retry Policy Matrix |
| 2026-03-20 12:48 | Review R005 | plan Step 2: REVISE |
| 2026-03-20 09:05 | Step 2 complete | Retry policy matrix: MergeFailureClassification type + MERGE_RETRY_POLICY_MATRIX (5 classes) + classifyMergeFailure + computeMergeRetryDecision + buildMergeRetryScopeKey. Engine/resume parity: both check retry before pause/abort. Scope key format {repoId}:w{N}:l{K} with "default" fallback. cleanup_post_merge_failed wave gate verified. All 1564 tests pass. |
| 2026-03-20 13:06 | Worker iter 3 | done in 1062s, ctx: 47%, tools: 106 |
| 2026-03-20 13:11 | Review R006 | code Step 2: REVISE |
| 2026-03-20 09:18 | R006 fixes applied | Extracted shared applyMergeRetryLoop helper (messages.ts), added MergeRetryLoopOutcome/MergeRetryCallbacks types, extractFailedRepoId with repoResults fallback. Engine+resume now use shared loop: supports maxAttempts>1, forces paused on exhaustion regardless of on_merge_failure, proper repo scoping for setup failures. All 1564 tests pass. |
| 2026-03-20 13:18 | Worker iter 3 | done in 429s, ctx: 28%, tools: 45 |
| 2026-03-20 13:18 | Step 2 complete | Retry Policy Matrix |
| 2026-03-20 13:18 | Step 3 started | Testing & Verification |
| 2026-03-20 13:20 | Review R007 | plan Step 3: REVISE |
| 2026-03-20 13:33 | Worker iter 4 | done in 727s, ctx: 44%, tools: 75 |
| 2026-03-20 13:38 | Review R008 | code Step 3: APPROVE |
| 2026-03-20 13:38 | Step 3 complete | Testing & Verification |
| 2026-03-20 13:38 | Step 4 started | Documentation & Delivery |
| 2026-03-20 13:41 | Review R009 | plan Step 4: REVISE |
| 2026-03-20 13:46 | Worker iter 5 | done in 333s, ctx: 20%, tools: 27 |
| 2026-03-20 13:48 | Review R010 | code Step 4: REVISE |
| 2026-03-20 09:58 | R010 fixes applied | Fixed non-retriable failure docs: merge_conflict_unresolved uses on_merge_failure policy (not forced pause). Added forced-pause-vs-policy note. Removed/re-created .DONE. All 1661 tests pass. |

## Blockers

*None*

## Notes

*Reserved for execution notes*
