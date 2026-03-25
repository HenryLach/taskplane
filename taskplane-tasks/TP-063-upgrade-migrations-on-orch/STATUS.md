# TP-063: Add Additive Upgrade Migrations on /orch — Status

**Current Step:** Step 3: Implement First Migration
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-25
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 2
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read orch preflight/start paths in extension.ts
- [x] Locate taskplane.json read/write path
- [x] Confirm supervisor local template path

---

### Step 1: Add Migration Runner
**Status:** ✅ Complete
- [x] Create migrations.ts registry + runner
- [x] Persist applied migration IDs in .pi/taskplane.json
- [x] Ensure idempotent, additive-only behavior

---

### Step 2: Wire Trigger Points
**Status:** ⬜ Not Started
- [x] Trigger on /orch preflight
- [x] Add extension-load safety trigger
- [x] Non-fatal warning behavior on failure

---

### Step 3: Implement First Migration
**Status:** ⬜ Not Started
- [ ] add-supervisor-local-template-v1 migration
- [ ] Copy missing .pi/agents/supervisor.md only
- [ ] Skip if file already exists

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Add migration tests
- [ ] Full test suite passes
- [ ] CLI smoke passes

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update docs if needed
- [ ] Discoveries logged
- [ ] .DONE created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 1 | REVISE | .reviews/R001-plan-step1.md |
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
| 2026-03-25 15:13 | Task started | Extension-driven execution |
| 2026-03-25 15:13 | Step 0 started | Preflight |
| 2026-03-25 15:13 | Task started | Extension-driven execution |
| 2026-03-25 15:13 | Step 0 started | Preflight |
| 2026-03-25 15:18 | Review R001 | plan Step 1: REVISE |

---

## Blockers

*None*
