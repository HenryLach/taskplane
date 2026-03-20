# TP-033: Transactional Merge Envelope & Retry Matrix — Status

**Current Step:** Step 1: Transaction Envelope
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-20
**Review Level:** 2
**Review Counter:** 3
**Iteration:** 2
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

---

### Step 2: Retry Policy Matrix
**Status:** ⬜ Not Started
- [ ] Implement retry by failure classification
- [ ] Persist retry counters scoped by repo/wave/lane
- [ ] Enforce max attempts and cooldown
- [ ] Exhaustion enters paused

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Transaction record tests
- [ ] Rollback tests
- [ ] Safe-stop tests
- [ ] Retry counter persistence tests
- [ ] Exhaustion tests
- [ ] Workspace-scoped counter tests
- [ ] Full test suite passes

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Config reference docs updated
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | Step 0 | APPROVE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |

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

## Blockers

*None*

## Notes

*Reserved for execution notes*
