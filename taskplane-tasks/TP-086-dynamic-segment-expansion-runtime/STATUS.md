# TP-086: Dynamic Segment Expansion Protocol and Supervisor Decisions — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-28
**Review Level:** 3
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read current worker→engine IPC contracts and supervisor alert flow
- [ ] Define structured request/decision payload schemas before implementation
- [ ] Identify minimal validation needed before supervisor sees a request

---

### Step 1: Expansion request protocol
**Status:** ⬜ Not Started

- [ ] Add `segment-expansion-request` contract (taskId, fromRepo, requestedRepoIds, rationale, optional suggested edges)
- [ ] Wire request emission path from worker/runtime context
- [ ] Add deterministic payload validation (shape + known repo IDs when available)

---

### Step 2: Supervisor decision plumbing
**Status:** ⬜ Not Started

- [ ] Surface requests to supervisor as structured actionable alerts/messages
- [ ] Add decision response contract: `approve | modify | reject`
- [ ] Persist/emit decision metadata sufficient for TP-087 graph mutation stage

---

### Step 3: Playbook and observability hooks
**Status:** ⬜ Not Started

- [ ] Update supervisor primer for expansion request handling
- [ ] Ensure user-visible reporting includes request summary + decision outcome

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Add/adjust tests for request payload validation
- [ ] Add/adjust tests for approve/modify/reject decision plumbing
- [ ] Run full suite: `cd extensions && npx vitest run`
- [ ] Fix all failures

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update spec wording if protocol details are finalized/renamed
- [ ] Log discoveries in STATUS.md
- [ ] Create `.DONE`

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
| 2026-03-28 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
