# TP-063: Add Additive Upgrade Migrations on /orch — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-25
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read orch preflight/start paths in extension.ts
- [ ] Locate taskplane.json read/write path
- [ ] Confirm supervisor local template path

---

### Step 1: Add Migration Runner
**Status:** ⬜ Not Started
- [ ] Create migrations.ts registry + runner
- [ ] Persist applied migration IDs in .pi/taskplane.json
- [ ] Ensure idempotent, additive-only behavior

---

### Step 2: Wire Trigger Points
**Status:** ⬜ Not Started
- [ ] Trigger on /orch preflight
- [ ] Add extension-load safety trigger
- [ ] Non-fatal warning behavior on failure

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
