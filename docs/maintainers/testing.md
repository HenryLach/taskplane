# Testing

Taskplane uses Vitest for extension-level tests.

## Test location

All tests live under:

- `extensions/tests/`

Key files:

- `orch-pure-functions.test.ts`
- `orch-state-persistence.test.ts`
- `orch-direct-implementation.test.ts`
- `task-runner-orchestration.test.ts`
- `worktree-lifecycle.test.ts`

Fixtures and mocks:

- `extensions/tests/fixtures/`
- `extensions/tests/mocks/`

---

## Install test dependencies

```bash
cd extensions
npm install
```

---

## Run tests

From `extensions/`:

```bash
npx vitest run
```

Watch mode:

```bash
npx vitest
```

Run one file:

```bash
npx vitest run tests/orch-state-persistence.test.ts
```

---

## What the suite covers

### Pure logic

- dependency parsing/normalization
- graph validation
- wave computation
- assignment logic

### State and resume

- state serialization/deserialization
- schema validation and error handling
- resume eligibility/reconciliation paths

### Integration-ish behavior

- orchestrator flow boundaries
- task-runner + orchestrator interaction points
- worktree lifecycle operations

---

## Test runtime model

Tests do not require a real pi UI process.

`vitest.config.ts` aliases pi dependencies to local mocks:

- `@mariozechner/pi-coding-agent` → `tests/mocks/pi-coding-agent.ts`
- `@mariozechner/pi-tui` → `tests/mocks/pi-tui.ts`

This keeps tests deterministic and fast.

---

## Adding new tests

1. Choose closest existing test file pattern
2. Add focused test cases for one behavior at a time
3. Prefer pure-function tests when possible
4. Use fixtures for malformed/edge JSON or state files
5. Keep assertions explicit about status/error codes

---

## Suggested pre-PR checklist

- `npx vitest run` passes
- New functionality includes tests (or rationale if not)
- Docs updated if behavior changed
- Manual sanity check in local pi session for user-facing command changes
