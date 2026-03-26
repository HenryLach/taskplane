# TP-074: Migrate Tests to Node.js Native Test Runner (Bulk) — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-26
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read migration spec
- [ ] Verify node --test works
- [ ] Identify 5 mock-heavy files to skip

---

### Step 1: Create Expect Compatibility Wrapper
**Status:** ⬜ Not Started
- [ ] Create expect.ts covering all assertion patterns
- [ ] Self-test the wrapper

---

### Step 2: Create Module Alias Loader
**Status:** ⬜ Not Started
- [ ] Create loader.mjs for pi package aliases
- [ ] Verify Windows path handling

---

### Step 3: Migrate Non-Mock Test Files
**Status:** ⬜ Not Started
- [ ] Migrate ~52 unit/source test files (import changes only)
- [ ] Migrate 9 integration test files
- [ ] Skip 5 mock-heavy files

---

### Step 4: Add npm Scripts and Test Runner Config
**Status:** ⬜ Not Started
- [ ] Add test/test:fast/test:vitest npm scripts
- [ ] Update .pi/task-runner.yaml (project-level only)

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started
- [ ] All migrated tests pass with node --test
- [ ] Unmigrated 5 files pass with vitest
- [ ] Build passes

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update docs/maintainers/development-setup.md
- [ ] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-26 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*
