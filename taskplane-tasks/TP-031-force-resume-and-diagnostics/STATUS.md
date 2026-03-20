# TP-031: Force-Resume Policy & Diagnostic Reports — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-20
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** 🟨 In Progress
- [x] Read resume eligibility logic
- [x] Read /orch-resume command handler
- [x] Read phase transition logic
- [x] Read roadmap Phase 3 sections
- [ ] Read CONTEXT.md and verify TP-030 dependency contracts (resilience/diagnostics types, persistence serialization)
- [ ] Read messages.ts computeMergeFailurePolicy and identify merge failure phase transition insertion points
- [ ] Record preflight findings: insertion points, force-resume contract, and resume eligibility matrix in Notes

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

## Blockers

*None*

## Notes

*Reserved for execution notes*
