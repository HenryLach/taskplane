# TP-031: Force-Resume Policy & Diagnostic Reports — Status

**Current Step:** Step 1: Implement Force-Resume Policy
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-20
**Review Level:** 2
**Review Counter:** 3
**Iteration:** 2
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
**Status:** ⬜ Not Started
- [ ] Change merge failure to paused
- [ ] Reserve failed for unrecoverable states
- [ ] Verify existing resume handles paused from merge

---

### Step 3: Diagnostic Reports
**Status:** ⬜ Not Started
- [ ] JSONL event log generation
- [ ] Human-readable summary generation
- [ ] Per-task diagnostics, costs, timing
- [ ] Per-repo breakdown in workspace mode

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
