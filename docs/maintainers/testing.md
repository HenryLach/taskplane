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

## Polyrepo fixture usage

### Fixture files

| Fixture | Mode | Purpose |
|---------|------|---------|
| `batch-state-valid.json` | repo | Standard monorepo batch state (no repo fields) |
| `batch-state-v1-valid.json` | repo (v1) | Schema v1 for upconversion testing |
| `batch-state-v2-workspace.json` | workspace | Minimal workspace-mode state (2 repos) |
| `batch-state-v2-polyrepo.json` | workspace | Full polyrepo fixture: 6 tasks, 3 repos, 3 waves |
| `batch-state-v2-bad-repo-fields.json` | workspace | Intentionally malformed repo fields for rejection tests |
| `polyrepo-builder.ts` | workspace | Dynamic fixture builder for end-to-end polyrepo tests |

### When to use polyrepo tests

Use the polyrepo fixture (`polyrepo-builder.ts`) when you need to test:

- **Cross-repo dependency resolution** — tasks routed to different repos with inter-repo deps
- **Workspace-mode orchestration** — lane allocation, naming, and merge across repos
- **Repo-aware persistence** — state serialization/validation with `repoId` and `resolvedRepoId` fields
- **Workspace-mode resume** — reconciliation across multiple repo roots

### When to use monorepo tests

Use `monorepo-compat-regression.test.ts` or existing repo-mode test patterns when you need to test:

- **Repo-mode (single-repo) behavior** — the default mode with no workspace config
- **Backward compatibility** — ensuring workspace-mode additions don't break existing repo-mode contracts
- **v1→v2 schema migration** — upconversion from legacy state files

### Test file organization

| Test file | Scope |
|-----------|-------|
| `polyrepo-fixture.test.ts` | Fixture builder self-tests (topology, routing, wave shape) |
| `polyrepo-regression.test.ts` | End-to-end polyrepo regression: routing, waves, serialization, resume, merge, naming |
| `monorepo-compat-regression.test.ts` | Monorepo non-regression guard: ensures repo-mode behavior is unchanged |
| `discovery-routing.test.ts` | Discovery + routing unit tests (both modes) |
| `orch-state-persistence.test.ts` | State persistence, schema validation, file I/O |
| `naming-collision.test.ts` | Collision-safe naming for sessions, lanes, branches |
| `merge-repo-scoped.test.ts` | Per-repo merge grouping and mergeWaveByRepo |

### How to use the polyrepo fixture

```typescript
import {
  buildPolyrepoFixture,
  buildFixtureParsedTasks,
  buildFixtureDiscovery,
  FIXTURE_TASK_IDS,
  FIXTURE_REPO_IDS,
} from "./fixtures/polyrepo-builder.ts";

let fixture: PolyrepoFixture;

beforeAll(() => { fixture = buildPolyrepoFixture(); });
afterAll(() => { fixture.cleanup(); });
```

The fixture creates:

- A temporary workspace root (NOT a git repo)
- Three git-initialized repos: `docs`, `api`, `frontend`
- Six tasks across 3 areas with cross-repo dependencies spanning 3 waves
- A `taskplane-workspace.yaml` configuration file

### Fixture limitations

1. **Temporary filesystem** — the fixture writes to `os.tmpdir()` and must be cleaned up via `fixture.cleanup()`. Always use `afterAll` for cleanup.
2. **No real git history** — repos have a single initial commit only. Tests that need real commit history or branch operations should use `worktree-lifecycle.test.ts` patterns instead.
3. **No real TMUX sessions** — the fixture only tests data-level contracts (discovery, waves, persistence, naming). Session creation and monitoring are not covered.
4. **Fixed topology** — the fixture has a specific 3-repo, 6-task, 3-wave shape. If you need a different topology, build custom tasks via `buildFixtureParsedTasks()` helpers or create a new fixture.
5. **Static batch-state fixture** — `batch-state-v2-polyrepo.json` is a hand-crafted state file for resume tests. If the schema changes, this fixture must be updated manually.
6. **No network/remote repos** — all repos are local. Remote push/pull behavior is not covered.

---

## Suggested pre-PR checklist

- `npx vitest run` passes
- New functionality includes tests (or rationale if not)
- Docs updated if behavior changed
- Manual sanity check in local pi session for user-facing command changes
