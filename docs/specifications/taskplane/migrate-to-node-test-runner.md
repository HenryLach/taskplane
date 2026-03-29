# Migrate from Vitest to Node.js Native Test Runner — Specification

**Status:** Implemented (historical migration record)  
**Created:** 2026-03-26  
**Author:** Supervisor session

> **Historical note:** This document describes the completed migration away from
> Vitest. Taskplane now uses Node.js native `node:test` for active test runs.

---

## 1. Problem

Vitest test runs take 70-165 seconds for 2690 tests. The vast majority of this
time (~85%) is spent in Vite's module transformation and import pipeline, not
running actual test logic. The same tests executed with Node.js native test
runner complete in under a second.

### Benchmark Evidence

| Approach | Import + transform | Test execution | Total |
|----------|-------------------|----------------|-------|
| **Vitest (--pool=threads)** | 98-228s | 33-309s | 70-156s wall |
| **Node.js native (node:test)** | ~0.4s | ~0.02s | ~0.4s wall |

The 350-780x difference exists because:
- Vitest uses **esbuild** to fully transform every TypeScript file
- Vitest builds a **Vite module graph** with plugin resolution, alias mapping, and HMR scaffolding
- Each test file is evaluated in Vite's **module evaluation context** (not Node's native ESM)
- Node.js v22+ has **native TypeScript type stripping** — near-instant, no transformation needed

### Why This Matters for Taskplane

Worker agents run tests during task execution. A 2+ minute test suite means:
- Workers waste context and tokens waiting for test results
- Workers may exit prematurely during the test step (observed in TP-065, TP-067, TP-072)
- Interactive development feedback loops are slow
- Merge agents re-run the full suite, adding another 2+ minutes per merge

---

## 2. Goal

Migrate all tests from Vitest to Node.js native test runner (`node:test`).
Target: **full suite under 15 seconds**, fast suite under 5 seconds.

### Non-Goals

- Changing test logic or coverage
- Adding new tests (migration only)
- Changing CI pipeline (node:test produces TAP output natively)

---

## 3. Current Test Infrastructure

### 3.1 Test Files

- **66 test files** in `extensions/tests/`
- **2690 tests** across unit, source-based, and integration categories
- **9 integration tests** (renamed to `*.integration.test.ts`) do real git/fs operations
- **57 unit/source tests** do string matching on source files and/or import modules

### 3.2 Vitest Features Used

| Feature | Usage Count | node:test Equivalent |
|---------|-------------|---------------------|
| `describe`, `it` | Every file | `describe`, `it` from `node:test` |
| `expect(x).toBe(y)` | 2530 | `assert.strictEqual(x, y)` |
| `expect(x).toContain(y)` | 2342 | `assert.ok(x.includes(y))` |
| `expect(x).toHaveLength(n)` | 352 | `assert.strictEqual(x.length, n)` |
| `expect(x).not.toBe(y)` | 327 | `assert.notStrictEqual(x, y)` |
| `expect(x).toEqual(y)` | 199 | `assert.deepStrictEqual(x, y)` |
| `expect(x).toBeGreaterThan(n)` | 118 | `assert.ok(x > n)` |
| `expect(x).toBeDefined()` | 117 | `assert.ok(x !== undefined)` |
| `expect(x).toBeUndefined()` | 116 | `assert.strictEqual(x, undefined)` |
| `expect(x).toBeNull()` | 96 | `assert.strictEqual(x, null)` |
| `expect(x).toMatch(re)` | 30 | `assert.match(x, re)` |
| `expect(x).toThrow()` | ~50 | `assert.throws(() => x())` |
| `beforeAll/afterAll` | 171 total | `before`, `after` from `node:test` |
| `beforeEach/afterEach` | (included above) | `beforeEach`, `afterEach` from `node:test` |
| `vi.mock()` | 22 (1 file) | `mock.module()` from `node:test` (v22.3+) |
| `vi.fn()` | 28 (5 files) | `mock.fn()` from `node:test` |
| Parameterized tests (`it.each`) | 0 | N/A |
| `it.skip`, `it.only` | 0 | `{ skip: true }`, `{ only: true }` options |

### 3.3 Vitest Config Dependencies

```typescript
// vitest.config.ts
plugins: [stripShebang()],      // Strip #! from .mjs files
resolve: {
    alias: {
        "@mariozechner/pi-coding-agent": "tests/mocks/pi-coding-agent.ts",
        "@mariozechner/pi-tui": "tests/mocks/pi-tui.ts",
    },
},
```

**`stripShebang` plugin:** Only needed for `bin/rpc-wrapper.mjs`. Most tests
don't import this file. Tests that do can read it as text (readFileSync) and
strip the shebang manually, or we add a one-line shebang guard.

**Module aliases:** Mock `@mariozechner/pi-coding-agent` (2 type exports) and
`@mariozechner/pi-tui` (1 function). These mocks are trivial — they export
`type ExtensionAPI = any` and a passthrough `truncateToWidth`. For node:test,
use a custom loader or Node.js import maps.

### 3.4 Mock Usage

Only **5 test files** use `vi.mock()` or `vi.fn()`:
- `diagnostic-reports.test.ts` — 22 calls (heaviest mock user)
- `non-blocking-engine.test.ts` — 21 calls
- `auto-integration-deterministic.integration.test.ts` — 4 calls
- `project-config-loader.test.ts` — 2 calls
- `supervisor.test.ts` — 1 call

Node.js v22.3+ has `mock.module()` and `mock.fn()` in `node:test` that cover
these use cases. The migration for these 5 files requires more care than the
other 61.

---

## 4. Migration Strategy

### Phase 1: Create assertion helper library

Create `tests/assert-helpers.ts` that wraps common vitest `expect()` patterns
as thin functions over `node:assert`:

```typescript
import assert from "node:assert";

export function toBe(actual: unknown, expected: unknown, msg?: string) {
    assert.strictEqual(actual, expected, msg);
}

export function toContain(haystack: string, needle: string, msg?: string) {
    assert.ok(haystack.includes(needle), msg ?? `Expected to contain: ${needle}`);
}

export function toHaveLength(actual: { length: number }, expected: number) {
    assert.strictEqual(actual.length, expected);
}

// ... etc for all patterns
```

Alternatively: create an `expect()` wrapper that mimics vitest's API using
node:assert underneath. This would minimize the diff per test file:

```typescript
export function expect(actual: unknown) {
    return {
        toBe: (expected: unknown) => assert.strictEqual(actual, expected),
        toContain: (needle: unknown) => {
            if (typeof actual === "string") assert.ok(actual.includes(needle as string));
            else if (Array.isArray(actual)) assert.ok(actual.includes(needle));
        },
        toEqual: (expected: unknown) => assert.deepStrictEqual(actual, expected),
        not: {
            toBe: (expected: unknown) => assert.notStrictEqual(actual, expected),
            toContain: (needle: unknown) => {
                if (typeof actual === "string") assert.ok(!actual.includes(needle as string));
            },
        },
        // ... etc
    };
}
```

**Recommendation:** The `expect()` wrapper approach minimizes the migration diff.
Each test file only needs to change its imports (remove vitest, add our helper),
not every assertion line.

### Phase 2: Create custom loader for module aliases

Create `tests/loader.mjs` to handle the two package aliases:

```javascript
export function resolve(specifier, context, nextResolve) {
    if (specifier === "@mariozechner/pi-coding-agent") {
        return nextResolve("./tests/mocks/pi-coding-agent.ts", context);
    }
    if (specifier === "@mariozechner/pi-tui") {
        return nextResolve("./tests/mocks/pi-tui.ts", context);
    }
    return nextResolve(specifier, context);
}
```

Tests run with: `node --experimental-strip-types --loader tests/loader.mjs`

**Alternative:** Node.js import maps (`--experimental-policy` or `--import-map`)
if available in v25. Investigate during implementation.

### Phase 3: Migrate test files (mechanical)

For each test file:

1. Replace `import { describe, it, expect, beforeEach, ... } from "vitest"`
   with `import { describe, it, before, after, beforeEach, afterEach } from "node:test"`
   and `import { expect } from "../tests/assert-helpers.ts"` (or the custom expect wrapper)

2. Replace `vi.fn()` with `mock.fn()` from `node:test` (5 files only)

3. Replace `vi.mock()` with `mock.module()` from `node:test` (5 files only)

4. Rename lifecycle hooks:
   - `beforeAll` → `before`
   - `afterAll` → `after`
   - `beforeEach` / `afterEach` stay the same

5. Handle `expect().toThrow()` patterns:
   - `expect(() => fn()).toThrow()` → `assert.throws(() => fn())`
   - `expect(() => fn()).toThrow("msg")` → `assert.throws(() => fn(), { message: /msg/ })`

**Migration order:** Start with simple source-based tests (no mocks, no fs),
then unit tests with fs, then the 5 mock-heavy files, then integration tests.

### Phase 4: Test runner configuration

Create `tests/run.sh` (or npm scripts) for the test commands:

```bash
# Fast suite (unit/source only)
node --experimental-strip-types --no-warnings \
     --test tests/*.test.ts

# Full suite (including integration)
node --experimental-strip-types --no-warnings \
     --test tests/*.test.ts tests/*.integration.test.ts

# Single file
node --experimental-strip-types --no-warnings \
     --test tests/supervisor.test.ts
```

Node's `--test` flag auto-discovers and runs test files matching the glob.

### Phase 5: Update CI and config

- Update `.github/workflows/ci.yml` to use `node --test` instead of `npx vitest run`
- Remove `vitest` and `vite` from devDependencies
- Remove `vitest.config.ts`
- Update `task-runner.yaml` test commands
- Update worker template test command references

---

## 5. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `mock.module()` doesn't cover all vi.mock patterns | Medium | Only 5 files use mocks; can keep vitest as fallback for those |
| Custom loader breaks on Windows paths | Medium | Test on Windows during Phase 2; use file:// URLs |
| `expect()` wrapper missing edge cases | Low | Build wrapper incrementally, validate each pattern |
| node:test output format differs from vitest | Low | CI just needs pass/fail; TAP output works with most CI |
| Some tests rely on vitest's module isolation | Medium | Thread pool already broke that assumption; node:test has `--test-isolation` flag |
| Test discovery differs from vitest | Low | `--test` glob handles *.test.ts and *.integration.test.ts |

---

## 6. Effort Estimate

| Phase | Files | Effort |
|-------|-------|--------|
| Phase 1: Assert helpers | 1 new file | Small — mechanical wrapper |
| Phase 2: Custom loader | 1 new file | Small — 2 aliases |
| Phase 3a: Simple tests (no mocks) | ~52 files | Medium — mechanical import changes |
| Phase 3b: Mock-heavy tests | 5 files | Medium — mock.module/mock.fn migration |
| Phase 3c: Integration tests | 9 files | Medium — same patterns, just more lifecycle hooks |
| Phase 4: Runner config | Scripts + npm | Small |
| Phase 5: CI + cleanup | CI yml, package.json | Small |

**Total: 2-3 tasks.** One for Phases 1-3a (bulk migration), one for Phase 3b-3c
(mocks + integration), one for Phase 4-5 (config + CI). Or combine into 2 tasks
if the first one handles the bulk cleanly.

---

## 7. Expected Results

| Metric | Vitest (current) | node:test (projected) |
|--------|------------------|-----------------------|
| Full suite (66 files, 2690 tests) | 156s | **5-10s** |
| Fast suite (57 files, 2304 tests) | 70s | **2-5s** |
| Single test file | 3-5s | **0.2-0.5s** |
| CI run | ~180s | **15-20s** (includes git checkout overhead) |
| Import phase | 98-228s | **< 1s** |
| devDependencies removed | — | vitest, vite, @vitest/*, esbuild |

**15-30x improvement on full suite. 350x improvement on single file.**

---

## 8. Post-Migration: New Test Conventions

After migration, **all new tests** should use `node:test` and `node:assert`
natively — NOT the `expect()` compatibility wrapper. The wrapper exists only
to minimize the migration diff for existing tests.

### New test file template

```typescript
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

describe("feature X", () => {
    it("does Y", () => {
        assert.strictEqual(actual, expected);
        assert.ok(str.includes("needle"));
        assert.deepStrictEqual(obj, { key: "value" });
    });
});
```

### Docs and agent files to update

These files must be updated to reference `node:test` + `assert` instead of
vitest/expect, so workers and reviewers don't regress to the old pattern:

| File | What to change |
|------|----------------|
| `templates/agents/task-worker.md` | Test execution commands, test file conventions |
| `templates/agents/task-reviewer.md` | Review criteria for test quality |
| `skills/create-taskplane-task/SKILL.md` | Testing step conventions, test command references |
| `skills/create-taskplane-task/references/prompt-template.md` | Testing step template (npx vitest → node --test) |
| `templates/config/task-runner.yaml` | Default test commands |
| `.pi/task-runner.yaml` (project-level) | Local test commands |
| `docs/maintainers/development-setup.md` | How to run tests |

### Convention rules for new tests

1. **Import from `node:test`**, not vitest — `import { describe, it } from "node:test"`
2. **Use `assert` directly**, not expect wrapper — `assert.strictEqual(x, y)`, not `expect(x).toBe(y)`
3. **Lifecycle hooks:** `before`/`after` (not `beforeAll`/`afterAll`)
4. **Mocks:** `import { mock } from "node:test"` — use `mock.fn()`, `mock.module()`
5. **No vitest dependency** — do not import from "vitest" in new files
6. **File naming:** `*.test.ts` for unit/source, `*.integration.test.ts` for git/fs-heavy

## 9. Open Questions

1. **Can `mock.module()` handle all our `vi.mock()` patterns?** The 22-call
   `diagnostic-reports.test.ts` may need refactoring if mock.module doesn't
   support the same dynamic mock factories.

2. **Windows loader compatibility.** The custom loader needs to handle Windows
   `C:\` paths correctly. Test during Phase 2 before bulk migration.

3. **Parallel test execution.** Node's `--test` runs tests concurrently by
   default. Our integration tests may need `--test-concurrency=1` or the
   isolation flag to prevent git repo collisions.

4. **Reporter output.** Vitest's dot/verbose reporters produce familiar output.
   Node's TAP output can be piped through `--test-reporter=spec` for similar
   formatting. Verify this works in CI.

5. **Should we keep vitest as a fallback?** During migration, we could maintain
   both runners (vitest for the 5 mock-heavy files, node:test for the rest).
   Clean removal happens when all files are migrated.
