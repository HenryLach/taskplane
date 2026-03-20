# TP-031: Force-Resume Policy & Diagnostic Reports — Status

**Current Step:** Step 5: Documentation & Delivery
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-20
**Review Level:** 2
**Review Counter:** 11
**Iteration:** 5
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
- [x] R008 fix: Refactor `assembleDiagnosticInput()` to build tasks from `wavePlan` + `lanes` + `allTaskOutcomes` (like `serializeBatchState`), including pending/blocked tasks and repo attribution fields (`repoId`, `resolvedRepoId`); update both engine.ts and resume.ts call sites to pass `wavePlan` and `lanes`
- [x] R008 fix: Fix `emitDiagnosticReports` docstring — remove incorrect reference to `batchState.errors` (function has no access to batchState)

---

### Step 4: Testing & Verification
**Status:** ✅ Complete
- [x] Force-resume eligibility tests: phase×force matrix (paused/executing/merging normal, stopped/failed with --force, completed always rejected, idle/planning rejected), parseResumeArgs (empty, --force, --help, unknown flag, positional arg)
- [x] Merge failure phase tests: failedTasks>0 yields "paused" not "failed"; completed when 0 failures; engine/resume parity on this behavior
- [x] Diagnostic report tests: buildDiagnosticEvents deterministic ordering, taskExits fallback precedence, workspace per-repo breakdown, sparse/empty data graceful fallback, eventsToJsonl correct format, buildMarkdownReport covers batch overview + per-task table + workspace repo sections + empty events
- [x] Diagnostic emission robustness: emitDiagnosticReports non-fatal on write failure (mock writeFileSync throw)
- [x] Full test suite passes (`cd extensions && npx vitest run`) — 33/35 suites pass, 2 pre-existing failures (cleanup-resilience, worktree-lifecycle) are Windows `git init` temp dir issues unrelated to TP-031; all 59 TP-031 tests pass
- [x] R010 fix: Add `expect(preCleanupIdx).toBeLessThan(cleanupIdx)` ordering assertion in resume.ts parity test
- [x] R010 fix: Add force-resume runtime path tests — diagnostics failure blocks resume, diagnostics success allows forced resume, `resilience.resumeForced` persisted only on success
- [x] R010 fix: Improve emission robustness tests — assert spy call counts for write-failure paths, add success-path emission test verifying both files written with expected filenames
- [x] R010 fix: Deduplicate STATUS.md review rows and execution log entries
- [x] Full test suite green after R010 fixes — 35/35 suites, 1399 tests pass

---

### Step 5: Documentation & Delivery
**Status:** 🟨 In Progress
- [x] Update `docs/reference/commands.md` — `/orch-resume [--force]` syntax, force-only phases, normal phases, completed rejection, example invocations
- [x] Evaluate README.md command table — updated `/orch-resume` row to show `[--force]` flag and expanded description
- [ ] Final delivery: create `.DONE`, mark step complete in STATUS.md, log completion

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | APPROVE | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R008 | code | Step 3 | REVISE | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
| R010 | code | Step 4 | REVISE | .reviews/R010-code-step4.md |
| R011 | plan | Step 5 | REVISE | .reviews/R011-plan-step5.md |

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
| 2026-03-20 02:43 | Review R002 | code Step 0: REVISE |
| 2026-03-20 02:44 | Step 0 complete | Preflight |
| 2026-03-20 02:44 | Step 1 started | Implement Force-Resume Policy |
| 2026-03-20 02:46 | Review R003 | plan Step 1: REVISE |
| 2026-03-20 02:54 | Step 1 complete | Force-resume policy implemented |
| 2026-03-20 03:01 | Review R004 | code Step 1: APPROVE |
| 2026-03-20 03:01 | Step 2 started | Default Merge Failure to Paused |
| 2026-03-20 02:57 | Review R005 | plan Step 2: REVISE |
| 2026-03-20 03:06 | Review R006 | code Step 2: REVISE |
| 2026-03-20 03:11 | Step 2 complete | Default Merge Failure to Paused |
| 2026-03-20 03:11 | Step 3 started | Diagnostic Reports |
| 2026-03-20 03:15 | Review R007 | plan Step 3: REVISE |
| 2026-03-20 03:31 | Review R008 | code Step 3: REVISE |
| 2026-03-20 03:39 | Step 3 complete | Diagnostic Reports |
| 2026-03-20 03:39 | Step 4 started | Testing & Verification |
| 2026-03-20 03:42 | Review R009 | plan Step 4: REVISE |
| 2026-03-20 03:56 | Review R010 | code Step 4: REVISE |
| 2026-03-20 | R010 revisions | Force-resume runtime + emission robustness + dedup fixes |
| 2026-03-20 04:05 | Worker iter 4 | done in 566s, ctx: 39%, tools: 74 |
| 2026-03-20 04:05 | Step 4 complete | Testing & Verification |
| 2026-03-20 04:05 | Step 5 started | Documentation & Delivery |
| 2026-03-20 04:07 | Review R011 | plan Step 5: REVISE |
| 2026-03-20 04:08 | Worker iter 5 | done in 748s, ctx: 37%, tools: 71 |
| 2026-03-20 04:08 | Step 4 complete | Testing & Verification |
| 2026-03-20 04:08 | Step 5 started | Documentation & Delivery |

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
