# TP-033: Transactional Merge Envelope & Retry Matrix — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-20
**Review Level:** 2
**Review Counter:** 2
**Iteration:** 1
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
**Status:** ⬜ Not Started
- [ ] Capture pre/post merge refs
- [ ] Rollback on verification failure
- [ ] Safe-stop on rollback failure
- [ ] Persist transaction record

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

## Blockers

*None*

## Notes

*Reserved for execution notes*
