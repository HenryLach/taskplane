# TP-074: Migrate Tests to Node.js Native Test Runner (Bulk) — Status

**Current Step:** Step 4: Add npm Scripts and Test Runner Config
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-26
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 2
**Size:** L

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read migration spec
- [x] Verify node --test works (v25.8.0, node:test imports work)
- [x] Identify 5 mock-heavy files to skip (diagnostic-reports, non-blocking-engine, auto-integration-deterministic, project-config-loader, supervisor)

---

### Step 1: Create Expect Compatibility Wrapper
**Status:** ✅ Complete
- [x] Create expect.ts covering all assertion patterns
- [x] Self-test the wrapper (32/32 pass)

---

### Step 2: Create Module Alias Loader
**Status:** ✅ Complete
- [x] Create loader.mjs for pi package aliases (register + hooks pattern)
- [x] Verify Windows path handling (tested with file:// URLs on Windows)

---

### Step 3: Migrate Non-Mock Test Files
**Status:** ✅ Complete
- [x] Migrate 52 unit/source test files (import changes only)
- [x] Migrate 9 integration test files (including dual-mode files)
- [x] Skip 5 mock-heavy files (diagnostic-reports, non-blocking-engine, auto-integration-deterministic, project-config-loader, supervisor)
- [x] Extended mock stubs (pi-coding-agent.ts, pi-tui.ts) with additional exports needed by source files

---

### Step 4: Add npm Scripts and Test Runner Config
**Status:** ✅ Complete
- [x] Add test/test:fast/test:vitest npm scripts to extensions/package.json
- [x] Note: .pi/taskplane-config.json and .pi/task-runner.yaml are gitignored project config — cannot be updated in worktree commit

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Build passes
- [ ] Spot-check a few migrated files with node --test
- [ ] Expect wrapper loads without errors

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
| 2026-03-26 19:38 | Task started | Extension-driven execution |
| 2026-03-26 19:38 | Step 0 started | Preflight |
| 2026-03-26 19:38 | Task started | Extension-driven execution |
| 2026-03-26 19:38 | Step 0 started | Preflight |

---

## Blockers

*None*
