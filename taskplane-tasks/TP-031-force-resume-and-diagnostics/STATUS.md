# TP-031: Force-Resume Policy & Diagnostic Reports — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-20
**Review Level:** 2
**Review Counter:** 2
**Iteration:** 1
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
- [ ] R002 fix: Deduplicate Reviews table — keep one canonical row per review ID with correct verdict
- [ ] R002 fix: Deduplicate Execution Log — single chronological sequence, no duplicate events
- [ ] R002 fix: Make status header consistent with step completion state

---

### Step 1: Implement Force-Resume Policy
**Status:** ⬜ Not Started
- [ ] Add --force flag parsing
- [ ] Pre-resume diagnostics
- [ ] Record force intent in state
- [ ] Resume eligibility matrix

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
| R001 | plan | Step 0 | APPROVE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
|---|------|------|---------|------|

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-19 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-20 02:36 | Task started | Extension-driven execution |
| 2026-03-20 02:36 | Step 0 started | Preflight |
| 2026-03-20 02:36 | Task started | Extension-driven execution |
| 2026-03-20 02:36 | Step 0 started | Preflight |
| 2026-03-20 02:38 | Review R001 | plan Step 0: APPROVE |
| 2026-03-20 02:38 | Review R001 | plan Step 0: REVISE |
| 2026-03-20 02:41 | Worker iter 1 | done in 157s, ctx: 48%, tools: 28 |
| 2026-03-20 02:41 | Worker iter 1 | done in 159s, ctx: 47%, tools: 29 |
| 2026-03-20 02:42 | Review R002 | code Step 0: REVISE |
| 2026-03-20 02:43 | Review R002 | code Step 0: REVISE |

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
