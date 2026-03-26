# Task: TP-075 - Migrate Mock Tests + Remove Vitest

**Created:** 2026-03-26
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Migrates the 5 remaining mock-heavy test files from vi.mock/vi.fn to node:test mock.module/mock.fn. Then removes vitest dependency entirely. Higher review level because mock migration can subtly change test behavior.
**Score:** 4/8 — Blast radius: 2, Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-075-node-test-mocks-cleanup/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Complete the vitest → node:test migration by:
1. Migrating the 5 mock-heavy test files that TP-074 skipped
2. Removing vitest, vite, and esbuild from devDependencies
3. Removing vitest.config.ts
4. Updating CI to use node --test

## Dependencies

- **Task:** TP-074 (bulk migration must be done first)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/migrate-to-node-test-runner.md` — spec section 3.4 on mock usage
- `extensions/tests/diagnostic-reports.test.ts` — heaviest mock user (22 vi.mock/vi.fn calls)
- `extensions/tests/non-blocking-engine.test.ts` — 21 mock calls
- Node.js docs on `mock.module()` and `mock.fn()`: https://nodejs.org/api/test.html#mocking

## Environment

- **Workspace:** `extensions/`
- **Services required:** None

## File Scope

- `extensions/tests/diagnostic-reports.test.ts`
- `extensions/tests/non-blocking-engine.test.ts`
- `extensions/tests/auto-integration-deterministic.integration.test.ts`
- `extensions/tests/project-config-loader.test.ts`
- `extensions/tests/supervisor.test.ts`
- `extensions/vitest.config.ts` (deleted)
- `extensions/package.json` (remove vitest deps)
- `.github/workflows/ci.yml` (update test command)

## Steps

### Step 0: Preflight

- [ ] Read each of the 5 mock-heavy files — understand what they mock and why
- [ ] Read Node.js `mock.module()` and `mock.fn()` docs
- [ ] Verify `mock.module()` is available: `node -e "import { mock } from 'node:test'; console.log(typeof mock.module)"`
- [ ] Determine if any vi.mock patterns can't be mapped to mock.module

### Step 1: Migrate Mock-Heavy Test Files

For each of the 5 files:

1. Replace `import { vi } from "vitest"` with `import { mock } from "node:test"`
2. Replace `vi.fn()` → `mock.fn()`
3. Replace `vi.mock("module", () => ({ ... }))` → `mock.module("module", { namedExports: { ... } })`
4. Replace `vi.spyOn()` → `mock.method()` if applicable
5. Replace `vi.clearAllMocks()` / `vi.restoreAllMocks()` → `mock.restoreAll()` in afterEach
6. Replace vitest imports with node:test + expect wrapper (same as TP-074)

**If `mock.module()` can't handle a specific pattern:** Refactor the test to not need module mocking. Many vi.mock uses can be replaced with dependency injection (pass the function as a parameter instead of importing it).

**Artifacts:**
- 5 test files modified

### Step 2: Remove Vitest

1. Delete `extensions/vitest.config.ts`
2. Remove from `extensions/package.json`:
   - `vitest` from devDependencies
   - `vite` if present
   - Any `@vitest/*` packages
3. Remove `test:vitest` npm script (added in TP-074 as fallback)
4. Run `npm install` to clean lockfile

**Artifacts:**
- `extensions/vitest.config.ts` (deleted)
- `extensions/package.json` (modified)

### Step 3: Update CI

Update `.github/workflows/ci.yml`:

```yaml
- name: Run tests
  run: cd extensions && node --experimental-strip-types --no-warnings --test tests/*.test.ts tests/*.integration.test.ts
```

Ensure CI still reports pass/fail correctly (node --test exits with non-zero on failure).

**Artifacts:**
- `.github/workflows/ci.yml` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed.

- [ ] Run ALL tests with node --test (no vitest fallback): `cd extensions && node --experimental-strip-types --no-warnings --test tests/*.test.ts tests/*.integration.test.ts`
- [ ] Verify vitest is gone: `npx vitest run` should fail with "command not found" or "not installed"
- [ ] Build passes: `node bin/taskplane.mjs help`
- [ ] Benchmark: record total test time and compare with vitest baseline

### Step 5: Documentation & Delivery

- [ ] Update `docs/maintainers/development-setup.md` — remove all vitest references
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/maintainers/development-setup.md` — final test command documentation
- `.github/workflows/ci.yml` — CI test command

**Do NOT Update:**
- Any shipped templates or skills (same boundary as TP-074)

## Completion Criteria

- [ ] All 5 mock-heavy files migrated to node:test mock API
- [ ] vitest.config.ts deleted
- [ ] vitest removed from devDependencies
- [ ] CI uses node --test
- [ ] ALL 2690 tests pass with node --test (zero vitest dependency)
- [ ] Build passes
- [ ] Test time benchmark recorded

## Git Commit Convention

- **Step completion:** `perf(TP-075): complete Step N — description`

## Do NOT

- Modify shipped templates or skills
- Change test logic — only migration infrastructure
- Skip tests that can't be easily migrated — refactor them instead
- Leave vitest as a fallback — this task fully removes it

---

## Amendments
