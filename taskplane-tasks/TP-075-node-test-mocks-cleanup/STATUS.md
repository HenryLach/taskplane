# TP-075: Migrate Mock Tests + Remove Vitest — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-26
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started
- [ ] Read 5 mock-heavy files and understand mock patterns
- [ ] Verify mock.module() availability in Node.js
- [ ] Identify any unmappable vi.mock patterns

---

### Step 1: Migrate Mock-Heavy Test Files
**Status:** ⬜ Not Started
- [ ] Migrate diagnostic-reports.test.ts (22 mock calls)
- [ ] Migrate non-blocking-engine.test.ts (21 mock calls)
- [ ] Migrate auto-integration-deterministic.integration.test.ts (4 mock calls)
- [ ] Migrate project-config-loader.test.ts (2 mock calls)
- [ ] Migrate supervisor.test.ts (1 mock call)

---

### Step 2: Remove Vitest
**Status:** ⬜ Not Started
- [ ] Delete vitest.config.ts
- [ ] Remove vitest/vite from devDependencies
- [ ] Clean npm lockfile

---

### Step 3: Update CI
**Status:** ⬜ Not Started
- [ ] Update ci.yml test command to node --test

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started
- [ ] ALL tests pass with node --test only
- [ ] vitest fully removed
- [ ] Benchmark recorded

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update maintainer docs
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
