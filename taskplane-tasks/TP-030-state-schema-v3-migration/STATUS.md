# TP-030: State Schema v3 & Migration — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read current v2 schema
- [ ] Read persistence read/write flow
- [ ] Read resume validation
- [ ] Read roadmap Phase 3 section 3a

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
|---|------|------|---------|------|

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-19 | Task staged | PROMPT.md and STATUS.md created |

## Blockers

*None*

## Notes

*Reserved for execution notes*
