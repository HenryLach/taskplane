# TP-031: Force-Resume Policy & Diagnostic Reports — Status

**Current Step:** Step 3: Diagnostic Reports
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-20
**Review Level:** 2
**Review Counter:** 7
**Iteration:** 3
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read resume eligibility logic
- [x] Read /orch-resume command handler
- [x] Read phase transition logic
- [x] Read roadmap Phase 3 sections
- [x] Read CONTEXT.md and verify TP-030 dependency contracts (resilience/diagnostics types, persistence serialization)
- [x] Read messages.ts computeMergeFailurePolicy and identify merge failure phase transition insertion points
- [x] Record preflight findings: insertion points, force-resume contract, and resume eligibility matrix in Notes
- [x] R002 fix: Deduplicate Reviews table — keep one canonical row per review ID with correct verdict
- [x] R002 fix: Deduplicate Execution Log — single chronological sequence, no duplicate events
- [x] R002 fix: Make status header consistent with step completion state

---

### Step 1: Implement Force-Resume Policy
**Status:** ✅ Complete
- [x] Add `parseResumeArgs()` in extension.ts with --force flag parsing, unknown-flag rejection, and usage guidance
- [x] Update `checkResumeEligibility()` in resume.ts to accept `force: boolean` — stopped/failed become eligible with force, completed always rejected
- [x] Add pre-resume diagnostics function in resume.ts: worktree health, branch consistency, state coherence (repo-aware for workspace mode); block resume if diagnostics fail with operator-facing reason
- [x] Wire up: extension.ts handler calls parseResumeArgs → passes force to resumeOrchBatch → checkResumeEligibility(state, force) → run diagnostics → set resilience.resumeForced → reset phase to paused → continue
- [x] Update ORCH_MESSAGES for force-resume notifications (force started, diagnostics failed, etc.)

---

### Step 2: Default Merge Failure to Paused
**Status:** ✅ Complete
- [x] Change engine.ts end-of-batch finalization: `failedTasks > 0` → `"paused"` (not `"failed"`) when phase is `"executing"`/`"merging"`, add `preserveWorktreesForResume = true` so worktrees survive for resume
- [x] Change resume.ts end-of-batch finalization (parity): same `failedTasks > 0` → `"paused"` transition with worktree preservation
- [x] Reserve `"failed"` for future unrecoverable invariant violations — add code comments documenting this intent at both sites
- [x] Verify downstream: `isTerminalPhase` checks, completion banners, state cleanup, auto-integration gates all handle new `"paused"` outcome correctly (no functional change needed if they already handle paused)
- [x] Add expected final-phase matrix to STATUS.md Notes section
- [x] R006 fix: Move `failedTasks > 0 → paused` + `preserveWorktreesForResume = true` determination BEFORE cleanup in engine.ts so worktrees are preserved when tasks fail
- [x] R006 fix: Same ordering fix in resume.ts — compute preservation intent before section 11 cleanup

---

### Step 3: Diagnostic Reports
**Status:** ✅ Complete
- [x] Create `extensions/taskplane/diagnostic-reports.ts` with JSONL event log generator and human-readable markdown summary generator; resolve opId via `resolveOperatorId(orchConfig)`; create `.pi/diagnostics/` dir; write failures are non-fatal (log + don't crash)
- [x] JSONL events: one JSON line per task from `state.tasks[]` enriched with `state.diagnostics.taskExits{}`; fallback to task record fields when taskExits entry missing; deterministic sort by taskId; fields: batchId, taskId, phase, mode, status, classification, cost, durationSec, retries, repoId, exitReason
- [x] Human-readable summary: markdown with batch overview (batchId, phase, duration, total cost), per-task table, per-repo breakdown when `mode === "workspace"`; graceful fallback when diagnostic data is sparse/empty
- [x] Wire emission into engine.ts and resume.ts after `persistRuntimeState("batch-terminal", ...)` — call report generator with orchConfig, batchState, allTaskOutcomes, stateRoot; engine/resume parity

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Force resume tests
- [ ] Resume rejection tests
- [ ] Merge failure phase tests
- [ ] Diagnostic report tests
- [ ] Full test suite passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Commands reference updated
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | UNAVAILABLE | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R004 | code | Step 1 | APPROVE | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | UNAVAILABLE | .reviews/R007-plan-step3.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-19 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-20 02:36 | Task started | Extension-driven execution |
| 2026-03-20 02:36 | Step 0 started | Preflight |
| 2026-03-20 02:38 | Review R001 | plan Step 0: REVISE |
| 2026-03-20 02:41 | Worker iter 1 | done in 159s, ctx: 47%, tools: 29 |
| 2026-03-20 02:43 | Review R002 | code Step 0: REVISE |
| 2026-03-20 | Step 0 cleanup | R002 revisions — STATUS.md bookkeeping fixed |
| 2026-03-20 02:44 | Worker iter 1 | done in 85s, ctx: 11%, tools: 15 |
| 2026-03-20 02:44 | Step 0 complete | Preflight |
| 2026-03-20 02:44 | Step 1 started | Implement Force-Resume Policy |
| 2026-03-20 02:44 | Worker iter 1 | done in 81s, ctx: 11%, tools: 16 |
| 2026-03-20 02:44 | Step 0 complete | Preflight |
| 2026-03-20 02:44 | Step 1 started | Implement Force-Resume Policy |
| 2026-03-20 02:46 | Review R003 | plan Step 1: REVISE |
| 2026-03-20 | Step 1 complete | Force-resume policy: parseResumeArgs, eligibility matrix, pre-resume diagnostics, force wiring |
| 2026-03-20 02:47 | Review R003 | plan Step 1: REVISE |
| 2026-03-20 02:54 | Worker iter 2 | done in 492s, ctx: 30%, tools: 58 |
| 2026-03-20 02:55 | Reviewer R004 | code review — reviewer did not produce output |
| 2026-03-20 02:55 | Review R004 | code Step 1: UNAVAILABLE |
| 2026-03-20 02:55 | Step 1 complete | Implement Force-Resume Policy |
| 2026-03-20 02:55 | Step 2 started | Default Merge Failure to Paused |
| 2026-03-20 02:55 | Worker iter 2 | done in 521s, ctx: 48%, tools: 48 |
| 2026-03-20 02:57 | Review R005 | plan Step 2: REVISE |
| 2026-03-20 03:01 | Review R004 | code Step 1: APPROVE |
| 2026-03-20 03:01 | Step 1 complete | Implement Force-Resume Policy |
| 2026-03-20 03:01 | Step 2 started | Default Merge Failure to Paused |
| 2026-03-20 03:03 | Review R005 | plan Step 2: REVISE |
| 2026-03-20 03:04 | Worker iter 3 | done in 377s, ctx: 18%, tools: 44 |
| 2026-03-20 03:06 | Review R006 | code Step 2: REVISE |
| 2026-03-20 03:07 | Review R006 | code Step 2: REVISE |
| 2026-03-20 03:11 | Worker iter 2 | done in 287s, ctx: 17%, tools: 28 |
| 2026-03-20 03:11 | Step 2 complete | Default Merge Failure to Paused |
| 2026-03-20 03:11 | Step 3 started | Diagnostic Reports |
| 2026-03-20 03:11 | Worker iter 3 | done in 262s, ctx: 16%, tools: 27 |
| 2026-03-20 03:11 | Step 2 complete | Default Merge Failure to Paused |
| 2026-03-20 03:11 | Step 3 started | Diagnostic Reports |
| 2026-03-20 03:15 | Reviewer R007 | plan review — reviewer did not produce output |
| 2026-03-20 03:15 | Review R007 | plan Step 3: UNAVAILABLE |
| 2026-03-20 03:15 | Review R007 | plan Step 3: REVISE |
| 2026-03-20 03:26 | Worker iter 4 | done in 679s, ctx: 49%, tools: 65 |

## Blockers

*None*

## Notes

### Preflight Findings (Step 0)

**Insertion Points:**

1. **Force-resume gating:** `/orch-resume` handler in `extension.ts` (line ~549). Currently passes no `force` flag. Add `--force` parsing and pass boolean into `resumeOrchBatch()`.
2. **Resume eligibility override:** `checkResumeEligibility()` in `resume.ts` (line ~119). Add `force: boolean` parameter. When force=true, `stopped` and `failed` phases become eligible.
3. **Force intent recording:** In `resumeOrchBatch()` after eligibility check passes, set `batchState.resilience.resumeForced = true` before persisting.
4. **Diagnostic report emission:** In `engine.ts` at batch terminal (line ~993-1033) and in `resume.ts` at terminal (same pattern). After `persistRuntimeState("batch-terminal", ...)`, call new diagnostic report generator.
5. **Merge failure phase transition:** `computeMergeFailurePolicy()` in `messages.ts` already returns `targetPhase: "paused"` for `on_merge_failure: "pause"` (the default). The batch-end logic in `engine.ts` (line 993-999) sets `phase = "failed"` when `failedTasks > 0` — this is where merge-caused failures lead to terminal `failed` state.

**Resume Eligibility Matrix (Current vs Required):**

| Phase | Current | TP-031 Required |
|---|---|---|
| `paused` | ✅ eligible | ✅ eligible (normal) |
| `executing` | ✅ eligible | ✅ eligible (normal) |
| `merging` | ✅ eligible | ✅ eligible (normal) |
| `stopped` | ❌ rejected | ⚠️ `--force` only |
| `failed` | ❌ rejected | ⚠️ `--force` only |
| `completed` | ❌ rejected | ❌ rejected (always) |
| `idle` | ❌ rejected | ❌ rejected |
| `planning` | ❌ rejected | ❌ rejected |

**Force-resume contract:** `/orch-resume --force` → parse flag in extension.ts → pass `force: boolean` to `resumeOrchBatch()` → `checkResumeEligibility(state, force)` → if force && (stopped|failed), return eligible → run pre-resume diagnostics → set `resilience.resumeForced = true` → reset phase to `paused` → continue normal resume flow.

**TP-030 Dependency Status:** Verified. `ResilienceState` type exists with `resumeForced: boolean`. `BatchDiagnostics` type exists with `taskExits` and `batchCost`. `serializeBatchState()` serializes both with defaults. State validation in `loadBatchState()` validates v3 schema.

### Final-Phase Matrix (After Step 2 — TP-031)

| Scenario | Phase Before | Phase After | Resumable? |
|---|---|---|---|
| All tasks succeed, no errors | `executing` | `completed` | N/A (done) |
| Some tasks failed (execution failures) | `executing` | `paused` | ✅ normal resume |
| Merge failure + `on_merge_failure: pause` (default) | `executing` → merge | `paused` | ✅ normal resume |
| Merge failure + `on_merge_failure: abort` | `executing` → merge | `stopped` | ⚠️ `--force` only |
| Operator pause signal | `executing` | `paused` | ✅ normal resume |
| Cleanup gate failure | `executing` → cleanup | `stopped` | ⚠️ `--force` only |
| Unrecoverable invariant violation (future) | any | `failed` | ⚠️ `--force` only |
| All tasks complete successfully | `executing` | `completed` | ❌ rejected |
