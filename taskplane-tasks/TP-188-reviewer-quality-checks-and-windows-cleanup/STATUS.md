# TP-188: Reviewer quality checks + Windows worktree cleanup fallback — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-05-06
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** S

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it.
>
> **⚠️ Per TP-186's Order of Operations rule** (which should be live in the base
> worker prompt by the time this task runs): do NOT mark a step `Complete`
> until that step's code review has returned APPROVE.

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] On `main` (lane worktree); TP-186 confirmed merged
- [ ] Baseline test count recorded
- [ ] All Tier 3 context files read
- [ ] Issues #541 and #543 read in full
- [ ] Decision recorded: read commands from `taskRunner.testing.commands` or hardcode defaults

---

### Step 1: Plan both sub-fixes
**Status:** ⬜ Not Started

> ⚠️ Plan-review checkpoint.

- [ ] Sub-fix A: Quality-check section drafted for task-reviewer.md
- [ ] Sub-fix B: Detection logic + retry command + path normalization designed
- [ ] Drafts in Discoveries

---

### Step 2: Implement sub-fix A — reviewer quality checks
**Status:** ⬜ Not Started

- [ ] templates/agents/task-reviewer.md augmented with Quality-check verification
- [ ] Confirm reviewer's existing bash tool is sufficient (it is)

---

### Step 3: Implement sub-fix B — Windows worktree fallback
**Status:** ⬜ Not Started

- [ ] worktree.ts removeWorktree adds Windows + "Filename too long" detection
- [ ] cmd /c "rd /s /q" fallback with backslash path normalization
- [ ] INFO-level log of fallback attempt
- [ ] Other error classes still surface unchanged

---

### Step 4: Add tests
**Status:** ⬜ Not Started

- [ ] reviewer-quality-checks.test.ts created
- [ ] windows-worktree-cleanup-fallback.test.ts created (platform-agnostic via mocks)
- [ ] Targeted run passes

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started

> ZERO test failures allowed.

- [ ] FULL fast suite passing
- [ ] Integration suite passing
- [ ] CLI smoke clean
- [ ] Code-review checkpoint at Step 5
- [ ] Per TP-186's rule: don't mark Step 2/3/4 Complete until APPROVE

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] CHANGELOG.md two Unreleased / Fixed entries (#541, #543)
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
| 2026-05-06 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None — but ideally TP-186 ships first.*

---

## Notes

- Bundles two independent issues from the same postmortem dump. Combined
  size is S; each sub-fix touches a different file with no overlap, so
  parallel implementation within the task is fine.
- The Windows fallback specifically benefits this user (Windows + emailgistics-astro
  with 700+ npm deps). Likely to fire on most batches once shipped.
