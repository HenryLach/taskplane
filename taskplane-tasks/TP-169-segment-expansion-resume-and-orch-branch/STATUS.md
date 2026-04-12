# TP-169: Segment Expansion Resume Crash and Workspace Orch Branch — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-12
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Preflight and Root Cause Analysis
**Status:** ⬜ Not Started

- [ ] Read resume.ts — task allocation reconstruction from persisted state
- [ ] Read engine.ts — how expanded segments are persisted
- [ ] Read execution.ts — orch branch creation per-repo in workspace mode
- [ ] Trace `allocTask.task.taskFolder undefined` crash
- [ ] Trace workspace orch branch gaps
- [ ] Document findings

---

### Step 1: Fix Segment Expansion Resume Crash
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on root cause analysis in Step 0

- [ ] Populate taskFolder for dynamically-added segments
- [ ] Ensure PersistedSegmentRecord fields complete
- [ ] Run targeted tests

---

### Step 2: Fix Workspace Orch Branch Coverage
**Status:** ⬜ Not Started

> ⚠️ Hydrate: Expand based on analysis in Step 0

- [ ] Ensure all repos get orch branch before execution
- [ ] Verify worktree creation uses orch branch
- [ ] Run targeted tests

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] FULL test suite passing
- [ ] Regression test: resume after segment expansion
- [ ] Regression test: workspace all repos have orch branch
- [ ] All failures fixed

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-12 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

GitHub issues: #441, #458
