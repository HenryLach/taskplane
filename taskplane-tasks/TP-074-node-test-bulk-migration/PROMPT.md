# Task: TP-074 - Migrate Tests to Node.js Native Test Runner (Bulk)

**Created:** 2026-03-26
**Size:** L

## Review Level: 1 (Plan Only)

**Assessment:** Mechanical migration of 52 test files from vitest to node:test. No logic changes — only imports and assertion syntax. Low risk per file, high volume.
**Score:** 2/8 — Blast radius: 1, Pattern novelty: 1, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-074-node-test-bulk-migration/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Migrate the 52 non-mock test files from vitest to Node.js native test runner (`node:test` + `node:assert`). This eliminates the vitest/esbuild transform pipeline that adds 100-230 seconds of overhead per test run.

**Design spec:** `docs/specifications/taskplane/migrate-to-node-test-runner.md`

**Target:** Full suite under 15 seconds, fast suite under 5 seconds.

## Dependencies

- **None**

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/migrate-to-node-test-runner.md` — full migration spec with assertion mapping table, loader strategy, and conventions
- `extensions/vitest.config.ts` — current config (aliases, plugins)
- `extensions/tests/` — existing test files to migrate

## Environment

- **Workspace:** `extensions/`
- **Services required:** None

## File Scope

- `extensions/tests/expect.ts` (new — expect() compatibility wrapper)
- `extensions/tests/loader.mjs` (new — module alias resolver)
- `extensions/tests/*.test.ts` (52 files — all non-mock test files)
- `extensions/tests/*.integration.test.ts` (9 files)
- `extensions/vitest.config.ts` (keep for now — removed in TP-075)

## Steps

### Step 0: Preflight

- [ ] Read the migration spec at `docs/specifications/taskplane/migrate-to-node-test-runner.md`
- [ ] Verify `node --test` works: `node --experimental-strip-types --no-warnings --test extensions/tests/_any-file.ts`
- [ ] Identify which 5 files use `vi.mock()`/`vi.fn()` — these are excluded from this task (handled in TP-075)
- [ ] Verify Node.js version supports all needed features: `node:test` describe/it/before/after/mock

### Step 1: Create Expect Compatibility Wrapper

Create `extensions/tests/expect.ts` — a lightweight `expect()` function that mimics vitest's API using `node:assert`:

```typescript
import assert from "node:assert";

export function expect(actual: unknown) {
    return {
        toBe: (expected: unknown) => assert.strictEqual(actual, expected),
        toContain: (needle: unknown) => { /* string.includes or array.includes */ },
        toEqual: (expected: unknown) => assert.deepStrictEqual(actual, expected),
        toHaveLength: (n: number) => assert.strictEqual((actual as any).length, n),
        toBeDefined: () => assert.notStrictEqual(actual, undefined),
        toBeUndefined: () => assert.strictEqual(actual, undefined),
        toBeNull: () => assert.strictEqual(actual, null),
        toBeGreaterThan: (n: number) => assert.ok((actual as number) > n),
        toBeGreaterThanOrEqual: (n: number) => assert.ok((actual as number) >= n),
        toBeLessThan: (n: number) => assert.ok((actual as number) < n),
        toMatch: (re: RegExp) => assert.match(actual as string, re),
        toBeInstanceOf: (cls: any) => assert.ok(actual instanceof cls),
        toHaveProperty: (key: string) => assert.ok(key in (actual as object)),
        toThrow: (expected?: string | RegExp) => { /* assert.throws wrapper */ },
        not: {
            toBe: (expected: unknown) => assert.notStrictEqual(actual, expected),
            toContain: (needle: unknown) => { /* negated */ },
            toEqual: (expected: unknown) => assert.notDeepStrictEqual(actual, expected),
            toBeDefined: () => assert.strictEqual(actual, undefined),
            toBeNull: () => assert.notStrictEqual(actual, null),
            toThrow: () => { /* assert.doesNotThrow */ },
        },
    };
}
```

Cover ALL assertion patterns found in the spec's usage table. Test the wrapper itself with a small self-test.

**Artifacts:**
- `extensions/tests/expect.ts` (new)

### Step 2: Create Module Alias Loader

Create `extensions/tests/loader.mjs` to handle the two package aliases currently in vitest.config.ts:

```javascript
export function resolve(specifier, context, nextResolve) {
    if (specifier === "@mariozechner/pi-coding-agent") {
        // Resolve to mock file
    }
    if (specifier === "@mariozechner/pi-tui") {
        // Resolve to mock file
    }
    return nextResolve(specifier, context);
}
```

Test that it works: `node --experimental-strip-types --loader tests/loader.mjs --test tests/some-file.ts`

Handle Windows path quirks (file:// URLs with drive letters).

**Artifacts:**
- `extensions/tests/loader.mjs` (new)

### Step 3: Migrate Non-Mock Test Files

For each of the ~52 test files that do NOT use `vi.mock()` or `vi.fn()`:

1. Replace `import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest"` with:
   ```typescript
   import { describe, it, before, after, beforeEach, afterEach } from "node:test";
   import { expect } from "./expect.ts";
   ```
2. Rename `beforeAll` → `before`, `afterAll` → `after`
3. No assertion changes needed (expect wrapper handles them)

**Skip these 5 files** (they use vi.mock/vi.fn — handled in TP-075):
- `diagnostic-reports.test.ts`
- `non-blocking-engine.test.ts`
- `auto-integration-deterministic.integration.test.ts`
- `project-config-loader.test.ts`
- `supervisor.test.ts`

Also migrate the 9 `*.integration.test.ts` files (same mechanical change).

**Artifacts:**
- 52+ test files modified (import lines only)

### Step 4: Add npm Scripts and Test Runner Config

Add to `extensions/package.json` (or create a script):

```json
{
    "scripts": {
        "test": "node --experimental-strip-types --no-warnings --test tests/*.test.ts tests/*.integration.test.ts",
        "test:fast": "node --experimental-strip-types --no-warnings --test tests/*.test.ts",
        "test:vitest": "npx vitest run"
    }
}
```

Keep `test:vitest` as fallback for the 5 unmigrated files.

Update `.pi/task-runner.yaml` test commands (project-level, NOT shipped templates):
```yaml
testing:
    commands:
        test: "cd extensions && node --experimental-strip-types --no-warnings --test tests/*.test.ts tests/*.integration.test.ts"
        test_fast: "cd extensions && node --experimental-strip-types --no-warnings --test tests/*.test.ts"
```

**Important:** Do NOT modify `templates/config/task-runner.yaml` or any shipped templates. The test runner choice is project-specific. Shipped templates use generic placeholders.

**Artifacts:**
- `extensions/package.json` (modified)
- `.pi/task-runner.yaml` (modified — project-level only)

### Step 5: Testing & Verification

> **SKIP full automated test suite for this task.** The vitest → node:test
> migration changes the test infrastructure itself. Running vitest on migrated
> files will fail. Tests will be validated manually after integration.

- [ ] Build passes: `node bin/taskplane.mjs help`
- [ ] Verify a few migrated files work with node:test: `node --experimental-strip-types --no-warnings --test tests/supervisor-template.test.ts tests/context-pressure-cache.test.ts`
- [ ] Verify expect.ts wrapper loads without errors

### Step 6: Documentation & Delivery

- [ ] Update `docs/maintainers/development-setup.md` with new test commands
- [ ] Discoveries logged in STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/maintainers/development-setup.md` — new test commands for developers
- `.pi/task-runner.yaml` — project-level test commands

**Do NOT Update:**
- `templates/agents/task-worker.md` — generic, references project test command
- `templates/config/task-runner.yaml` — generic, users fill in their own command
- `skills/create-taskplane-task/` — generic, uses `[test command]` placeholder

## Completion Criteria

- [ ] 52+ test files migrated to node:test + expect wrapper
- [ ] expect.ts wrapper covers all assertion patterns
- [ ] Module alias loader works on Windows
- [ ] Migrated tests pass with node --test
- [ ] Unmigrated 5 files still pass with vitest
- [ ] Build passes

## Git Commit Convention

- **Step completion:** `perf(TP-074): complete Step N — description`

## Do NOT

- Modify any shipped templates (task-worker.md, task-runner.yaml template, skills)
- Change test logic or assertions — only change the runner infrastructure
- Remove vitest yet — that happens in TP-075 after mock files are migrated
- Rewrite expect() calls to assert — the wrapper handles this; bulk rewrite is not worth the effort

---

## Amendments
