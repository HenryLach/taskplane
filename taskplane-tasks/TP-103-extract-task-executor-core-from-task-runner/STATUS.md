# TP-103: Extract Task Executor Core from task-runner — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-30
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Map the current task-runner execution path: parsing, status mutation, worker loop, reviewer integration, quality gate, and `.DONE` semantics
- [ ] Identify which helpers can move unchanged and which need new runtime-facing interfaces

---

### Step 1: Extract Headless Executor Core
**Status:** ⬜ Not Started

- [ ] Create a new headless executor module that owns task execution semantics without Pi UI/session assumptions
- [ ] Move STATUS parsing/mutation, worker iteration bookkeeping, and completion checks behind explicit interfaces
- [ ] Move review orchestration and quality-gate helpers behind explicit runtime-facing interfaces where practical

---

### Step 2: Thin task-runner Wrapper
**Status:** ⬜ Not Started

- [ ] Refactor `task-runner.ts` to delegate to the shared core instead of owning the logic directly
- [ ] Keep the deprecated `/task` surface as a wrapper only if needed for interim compatibility, not as the architectural owner
- [ ] Ensure Runtime V2 callers can invoke the shared core without `TASK_AUTOSTART` or session-start coupling

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Add or update behavioral tests proving execution semantics are preserved after extraction
- [ ] Run the full suite
- [ ] Fix all failures

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update execution architecture docs if extracted module boundaries differ from the spec
- [ ] Log discoveries in STATUS.md

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
| 2026-03-30 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
