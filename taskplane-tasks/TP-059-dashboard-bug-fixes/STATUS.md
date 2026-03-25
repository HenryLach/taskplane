# TP-059: Dashboard Bug Fixes — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-25
**Review Level:** 1
**Review Counter:** 1
**Iteration:** 2
**Size:** S

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read formatting.ts:687 — hardcoded "develop"
- [x] Read app.js:631+ — merge session filter and telemetry lookups
- [x] Confirm two failing tests in supervisor-merge-monitoring.test.ts

---

### Step 1: Fix Merge Message (#201)
**Status:** ✅ Complete

- [x] Replace hardcoded "develop" with actual orch branch name
- [x] Thread orch branch through to formatting function if needed

---

### Step 2: Fix Merge Agents Section (#202)
**Status:** ✅ Complete

- [x] Fix session filter at line 631 to match actual naming pattern
- [x] Fix telemetry lookups at lines 657, 661, 721

---

### Step 3: Fix Test Failures (#193)
**Status:** 🟨 In Progress

- [ ] Fix test 9.3 to match current implementation
- [ ] Fix test 10.5 to match current implementation

---

### Step 4: Testing & Verification
**Status:** 🟨 In Progress

- [ ] Previously failing tests now pass
- [ ] Full test suite passing
- [ ] Build passes

---

### Step 5: Documentation & Delivery
**Status:** 🟨 In Progress

- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 1 | APPROVE | .reviews/R001-plan-step1.md |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-25 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-25 03:42 | Task started | Extension-driven execution |
| 2026-03-25 03:42 | Step 0 started | Preflight |
| 2026-03-25 03:42 | Step 1 started | Fix Merge Message (#201) |
| 2026-03-25 03:42 | Step 2 started | Fix Merge Agents Section (#202) |
| 2026-03-25 03:42 | Step 3 started | Fix Test Failures (#193) |
| 2026-03-25 03:42 | Step 4 started | Testing & Verification |
| 2026-03-25 03:42 | Step 5 started | Documentation & Delivery |
| 2026-03-25 03:42 | Task started | Extension-driven execution |
| 2026-03-25 03:42 | Step 0 started | Preflight |
| 2026-03-25 03:42 | Step 1 started | Fix Merge Message (#201) |
| 2026-03-25 03:42 | Step 2 started | Fix Merge Agents Section (#202) |
| 2026-03-25 03:42 | Step 3 started | Fix Test Failures (#193) |
| 2026-03-25 03:42 | Step 4 started | Testing & Verification |
| 2026-03-25 03:42 | Step 5 started | Documentation & Delivery |
| 2026-03-25 03:45 | Review R001 | plan Step 1: APPROVE |

---

## Blockers

*None*

---

## Notes

*This batch also serves as a production test for TP-058 (supervisor template pattern). The supervisor should be loading its prompt from templates/agents/supervisor.md with project-specific customization from .pi/agents/supervisor.md.*
