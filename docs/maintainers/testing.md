# Testing

Taskplane uses the Node.js native test runner (`node:test`) for extension-level tests.
Vitest is no longer used as the project test runner.

## Test location

All tests live under:

- `extensions/tests/`

Key files:

- `orch-pure-functions.test.ts`
- `orch-state-persistence.test.ts`
- `orch-direct-implementation.integration.test.ts`
- `task-runner-orchestration.test.ts`
- `worktree-lifecycle.integration.test.ts`
- `polyrepo-fixture.test.ts` — polyrepo fixture topology acceptance
- `polyrepo-regression.test.ts` — end-to-end polyrepo orchestration regression
- `monorepo-compat-regression.test.ts` — monorepo backward-compat guards

Fixtures and mocks:

- `extensions/tests/fixtures/`
- `extensions/tests/fixtures/polyrepo-builder.ts` — runtime polyrepo fixture builder
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
node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts
```

Run one file:

```bash
node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/orch-state-persistence.test.ts
```

Fast suite (`package.json` helper):

```bash
npm run test:fast
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

### Polyrepo / workspace-mode

- runtime polyrepo fixture: multi-repo workspace topology with cross-repo dependencies
- end-to-end polyrepo regression: routing, planning, serialization, merge, resume, naming
- monorepo compatibility: guards that workspace-mode additions don't break repo-mode behavior

### Monorepo compatibility

- v1→v2 persistence upconversion defaults to `mode: "repo"`
- repo-mode discovery skips routing (no `resolvedRepoId`)
- repo-mode naming has no repoId segments
- repo-mode merge grouping collapses to a single group
- resume eligibility is mode-agnostic

---

## Test runtime model

Tests do not require a real pi UI process.

The custom loader (`tests/loader.mjs`) redirects pi package imports to local mocks:

- `@mariozechner/pi-coding-agent` → `tests/mocks/pi-coding-agent.ts`
- `@mariozechner/pi-tui` → `tests/mocks/pi-tui.ts`

This keeps tests deterministic and fast.

---

## Adding new tests

1. Choose the closest existing test file pattern
2. Add focused test cases for one behavior at a time
3. Prefer pure-function tests when possible
4. Use fixtures for malformed/edge JSON or state files
5. Keep assertions explicit about status/error codes

---

## Historical Vitest references

Some historical specifications, task packets, and migration docs may still mention
Vitest commands. Those references are archival context only.

- Do **not** use Vitest commands for current development.
- Use the Node.js runner command(s) in this document.

---

## Suggested pre-PR checklist

- `node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts` passes
- New functionality includes tests (or rationale if not)
- Docs updated if behavior changed
- Manual sanity check in local pi session for user-facing command changes
