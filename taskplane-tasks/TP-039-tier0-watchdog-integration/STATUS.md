# TP-039: Tier 0 Watchdog Engine Integration — Status

**Current Step:** Step 2: Tier 0 Event Logging
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-22
**Review Level:** 2
**Review Counter:** 3
**Iteration:** 4
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read engine wave loop failure handling
- [x] Read retry matrix from TP-033
- [x] Read partial progress code from TP-028
- [x] Read spec Sections 5.1-5.4

---

### Step 1: Wire Automatic Recovery into Engine
**Status:** ✅ Complete
- [x] Define Tier 0 retry scope keys and retryable classification set in types.ts (non-merge retry scopes distinct from merge scopes)
- [x] Add `classifyAndRetryWorkerCrash()` helper in engine.ts: after wave execution, for each failed task, populate exitDiagnostic via classifyExit(), check if retryable (api_error, process_crash, session_vanished), preserve partial progress, then re-execute the lane if budget allows
- [x] Add `retryStaleWorktreeAllocation()` helper: when executeWave returns allocation failure with ALLOC_WORKTREE_FAILED, force cleanup + prune + retry allocation once before marking wave failed
- [x] Add cleanup gate retry: when post-merge cleanup gate fires, retry force cleanup once before pausing
- [x] Persist non-merge retry counters in resilience.retryCountByScope after each attempt
- [x] R002-1: Fix worker-failure classification — use outcome.exitDiagnostic.classification when available; when unavailable, skip auto-retry instead of synthesizing null input that always yields session_vanished
- [x] R002-2: Fix blocked task reconciliation — move retry before blocked task accumulation, or recompute blockedTaskIds from remaining failures after retries
- [x] R002-3: Fix stale-worktree recovery to scope cleanup to workspace repos (not just primary repoRoot) using encounteredRepoRoots or parsing allocation error
- [x] R002-4: Fix stop-wave pause gate — allow Tier 0 retry before policy-induced pause takes effect

---

### Step 2: Tier 0 Event Logging
**Status:** ✅ Complete
- [x] Define Tier0Event type and `emitTier0Event()` utility in persistence.ts — write to `stateRoot/.pi/supervisor/events.jsonl` with best-effort semantics (mkdir + append, failures logged but don't crash batch)
- [x] Instrument worker crash retry (attemptWorkerCrashRetry) with tier0_recovery_attempt / tier0_recovery_success / tier0_recovery_exhausted events
- [x] Instrument stale worktree recovery (attemptStaleWorktreeRecovery) with tier0_recovery_attempt / tier0_recovery_success / tier0_recovery_exhausted events
- [x] Instrument cleanup gate retry (inline in engine wave loop) with tier0_recovery_attempt / tier0_recovery_success / tier0_recovery_exhausted events
- [x] Instrument merge retry loop (applyMergeRetryLoop integration point in engine.ts) with tier0 events — emit attempt/success/exhausted at the engine caller site
- [x] Include full context in each event: timestamp, batchId, waveIndex, laneNumber, pattern, attempt, classification/error, and escalation-ready fields in exhausted events

---

### Step 3: Escalation Interface
**Status:** ⬜ Not Started
- [ ] Define EscalationContext interface
- [ ] Emit escalation event on retry exhaustion
- [ ] Fall through to pause behavior

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Auto-retry test
- [ ] Exhaustion-pauses test
- [ ] Partial progress save test
- [ ] Worktree cleanup retry test
- [ ] Event logging test
- [ ] Happy path unaffected test
- [ ] Full test suite passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 1 | REVISE | .reviews/R001-plan-step1.md |
| R001 | plan | Step 1 | REVISE | .reviews/R001-plan-step1.md |
| R002 | code | Step 1 | REVISE | .reviews/R002-code-step1.md |
| R002 | code | Step 1 | REVISE | .reviews/R002-code-step1.md |
| R003 | plan | Step 2 | REVISE | .reviews/R003-plan-step2.md |
| R003 | plan | Step 2 | REVISE | .reviews/R003-plan-step2.md |
|---|------|------|---------|------|

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-21 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-22 17:49 | Task started | Extension-driven execution |
| 2026-03-22 17:49 | Step 0 started | Preflight |
| 2026-03-22 17:49 | Skip plan review | Step 0 (Preflight) — low-risk |
| 2026-03-22 17:49 | Task started | Extension-driven execution |
| 2026-03-22 17:49 | Step 0 started | Preflight |
| 2026-03-22 17:49 | Skip plan review | Step 0 (Preflight) — low-risk |
| 2026-03-22 17:51 | Worker iter 2 | done in 87s, ctx: 37%, tools: 15 |
| 2026-03-22 17:51 | Skip code review | Step 0 (Preflight) — low-risk |
| 2026-03-22 17:51 | Step 0 complete | Preflight |
| 2026-03-22 17:51 | Step 1 started | Wire Automatic Recovery into Engine |
| 2026-03-22 17:51 | Worker iter 1 | done in 89s, ctx: 46%, tools: 20 |
| 2026-03-22 17:51 | Skip code review | Step 0 (Preflight) — low-risk |
| 2026-03-22 17:51 | Step 0 complete | Preflight |
| 2026-03-22 17:51 | Step 1 started | Wire Automatic Recovery into Engine |
| 2026-03-22 17:54 | Review R001 | plan Step 1: REVISE |
| 2026-03-22 17:55 | Review R001 | plan Step 1: REVISE |
| 2026-03-22 18:06 | Worker iter 3 | done in 743s, ctx: 48%, tools: 94 |
| 2026-03-22 18:07 | Worker iter 2 | done in 731s, ctx: 44%, tools: 86 |
| 2026-03-22 18:12 | Review R002 | code Step 1: REVISE |
| 2026-03-22 18:12 | Review R002 | code Step 1: REVISE |
| 2026-03-22 18:21 | Worker iter 3 | done in 528s, ctx: 33%, tools: 64 |
| 2026-03-22 18:21 | Step 1 complete | Wire Automatic Recovery into Engine |
| 2026-03-22 18:21 | Step 2 started | Tier 0 Event Logging |
| 2026-03-22 18:21 | Worker iter 2 | done in 535s, ctx: 32%, tools: 83 |
| 2026-03-22 18:21 | Step 1 complete | Wire Automatic Recovery into Engine |
| 2026-03-22 18:21 | Step 2 started | Tier 0 Event Logging |
| 2026-03-22 18:25 | Review R003 | plan Step 2: REVISE |
| 2026-03-22 18:25 | Review R003 | plan Step 2: REVISE |
| 2026-03-22 18:35 | Worker iter 3 | done in 642s, ctx: 36%, tools: 76 |

## Blockers

*None*

## Notes

### Preflight Findings

**Engine wave loop (engine.ts):**
- Merge failure handling already uses `applyMergeRetryLoop()` from TP-033 with classification-based retry matrix
- `preserveWorktreesForResume` flag guards worktree cleanup for failed batches
- Post-merge cleanup gate (`cleanupGateFailures`) pauses on stale worktrees after inter-wave reset
- Worker session crash: currently marks task as failed via executeLane(), no automatic retry
- Merge timeout: handled by retry loop, but only for merge-phase failures

**Retry matrix (types.ts TP-033):**
- `MERGE_RETRY_POLICY_MATRIX` covers 5 merge failure classifications
- `ResilienceState.retryCountByScope` persists retry counts in batch state
- Scope key format: `{taskId}:w{waveIndex}:l{laneNumber}`
- `MergeRetryDecision` is the decision output type

**Partial progress (TP-028):**
- `preserveFailedLaneProgress()` in worktree.ts saves failed task commits as named branches
- `applyPartialProgressToOutcomes()` stamps outcomes with saved branch/commit data
- Called both at inter-wave reset and at terminal cleanup

**R001 Suggestions (advisory, not blocking):**
- Merge-timeout auto-recovery is already partially covered by TP-038 + applyMergeRetryLoop; keep Step 1 focused on worker crash + stale provisioning + cleanup gate retry, not reworking existing merge retry behavior.

**What TP-039 needs to wire in (from spec §5.1-5.4):**
- Pattern 1 (merge timeout): Already partially handled by TP-033/TP-038 retry loop. Need to ensure the engine auto-invokes this instead of immediate pause.
- Pattern 2 (worker session crash): Need to add partial progress save + exit classification + conditional retry in the execution path. Currently execution.ts just marks failed.
- Pattern 4 (stale worktree): Need force cleanup + retry before failing during provisioning.
- Pattern 6 (cleanup failure): Need retry-once + wave gate on post-merge cleanup failure. Inter-wave cleanup gate already exists but may need enhancement.
- Tier 0 event logging: New `.pi/supervisor/events.jsonl` file with structured JSONL events
- Escalation interface: New `EscalationContext` type + event emission on retry exhaustion
