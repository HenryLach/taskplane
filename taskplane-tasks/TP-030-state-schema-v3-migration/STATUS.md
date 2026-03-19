# TP-030: State Schema v3 & Migration — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** 🟨 In Progress
- [ ] Read CONTEXT.md (Tier 2 context)
- [ ] Read current v2 schema in types.ts
- [ ] Read persistence read/write flow
- [ ] Read resume validation
- [ ] Read roadmap Phase 3 section 3a
- [ ] Verify TP-025 dependency: confirm TaskExitDiagnostic exists in diagnostics.ts
- [ ] Record key migration constraints in Discoveries/Notes

---

### Step 1: Define v3 Schema
**Status:** ⬜ Not Started
- [ ] Add resilience section
- [ ] Add diagnostics section
- [ ] Promote exitDiagnostic alongside legacy exitReason
- [ ] Preserve v2 fields, preserve unknown fields

---

### Step 2: Implement Migration
**Status:** ⬜ Not Started
- [ ] Auto-detect schema version on read
- [ ] v1/v2 → v3 migration with conservative defaults
- [ ] Corrupt state handling (paused + diagnostic)
- [ ] Version mismatch error for old runtimes

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started
- [ ] v1 → v3 migration test
- [ ] v2 → v3 migration test
- [ ] v3 clean read test
- [ ] Unknown field preservation test
- [ ] Corrupt state test
- [ ] Full test suite passes

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] JSDoc for v3 schema
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-19 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-19 22:16 | Task started | Extension-driven execution |
| 2026-03-19 22:16 | Step 0 started | Preflight |
| 2026-03-19 22:17 | Review R001 | plan Step 0: REVISE |
| 2026-03-19 22:17 | Review R001 | plan Step 0: REVISE |

## Blockers

*None*

## Notes

*Reserved for execution notes*
