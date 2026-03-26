# TP-075: Migrate Mock Tests + Remove Vitest — Status

**Current Step:** Step 1: Migrate Mock-Heavy Test Files
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-26
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read 5 mock-heavy files and understand mock patterns
- [x] Verify mock.module() availability in Node.js (requires --experimental-test-module-mocks)
- [x] Verify mock.timers availability
- [x] Verify mock.fn() and mock.method() APIs
- [x] Identify unmappable patterns — none found, all patterns mappable

**Discoveries:**
- `mock.module()` requires `--experimental-test-module-mocks` flag
- `mock.timers.enable()` + `mock.timers.tick(ms)` + `await setImmediate` replaces `vi.useFakeTimers` + `vi.advanceTimersByTimeAsync(ms)`
- `mock.fn()` has same `.mock.calls` structure but calls contain `{arguments, result}` objects (expect.ts already handles this)
- `mock.method(obj, key, impl)` replaces `vi.spyOn(obj, key).mockImplementation(impl)`
- `mock.module("mod", { namedExports: {...} })` replaces `vi.mock("mod", ...)` but must be called before dynamic import of consumer

**Mock pattern mapping:**
| vitest | node:test |
|--------|-----------|
| `vi.fn()` | `mock.fn()` |
| `vi.fn().mockResolvedValue(v)` | `mock.fn(async () => v)` |
| `vi.spyOn(obj, key)` | `mock.method(obj, key)` |
| `vi.mock("mod", impl)` | `mock.module("mod", { namedExports })` (before import) |
| `vi.hoisted(() => ...)` | top-level declaration (no hoisting needed) |
| `vi.mocked(fn).mockReset()` | `fn.mock.resetCalls()` |
| `vi.mocked(fn).mockReturnValue(v)` | `fn.mock.mockImplementation(() => v)` |
| `vi.mocked(fn).mockImplementation(impl)` | `fn.mock.mockImplementation(impl)` |
| `vi.useFakeTimers()` | `mock.timers.enable()` |
| `vi.useRealTimers()` | `mock.timers.reset()` |
| `vi.advanceTimersByTime(ms)` | `mock.timers.tick(ms)` |
| `vi.advanceTimersByTimeAsync(ms)` | `mock.timers.tick(ms)` + `await setImmediate` |
| `expect.stringContaining(s)` | manual assertion on `.mock.calls` |

---

### Step 1: Migrate Mock-Heavy Test Files
**Status:** ✅ Complete
- [x] Migrate diagnostic-reports.test.ts (22 mock calls)
- [x] Migrate non-blocking-engine.test.ts (21 mock calls)
- [x] Migrate auto-integration-deterministic.integration.test.ts (4 mock calls)
- [x] Migrate project-config-loader.test.ts (2 mock calls)
- [x] Migrate supervisor.test.ts (1 mock call)

---

### Step 2: Remove Vitest
**Status:** 🟡 In Progress
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
| 2026-03-26 | Step 0 started | Reading 5 mock-heavy files, testing node:test mock APIs |

---

## Blockers

*None*
