# TP-059: Dashboard Bug Fixes — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-25
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 0
**Size:** S

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read formatting.ts:687 — hardcoded "develop"
- [ ] Read app.js:631+ — merge session filter and telemetry lookups
- [ ] Confirm two failing tests in supervisor-merge-monitoring.test.ts

---

### Step 1: Fix Merge Message (#201)
**Status:** ⬜ Not Started

- [ ] Replace hardcoded "develop" with actual orch branch name
- [ ] Thread orch branch through to formatting function if needed

---

### Step 2: Fix Merge Agents Section (#202)
**Status:** ⬜ Not Started

- [ ] Fix session filter at line 631 to match actual naming pattern
- [ ] Fix telemetry lookups at lines 657, 661, 721

---

### Step 3: Fix Test Failures (#193)
**Status:** ⬜ Not Started

- [ ] Fix test 9.3 to match current implementation
- [ ] Fix test 10.5 to match current implementation

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Previously failing tests now pass
- [ ] Full test suite passing
- [ ] Build passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Discoveries logged
- [ ] `.DONE` created

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
| 2026-03-25 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*This batch also serves as a production test for TP-058 (supervisor template pattern). The supervisor should be loading its prompt from templates/agents/supervisor.md with project-specific customization from .pi/agents/supervisor.md.*
