# Development Setup

This guide is for contributors working on Taskplane itself.

## Prerequisites

- Node.js 22+
- Git
- pi

---

## Clone and install

```bash
git clone https://github.com/HenryLach/taskplane.git
cd taskplane
```

Install extension test/dev dependencies:

```bash
cd extensions
npm install
cd ..
```

---

## Run extensions locally

### Load the orchestrator

```bash
pi -e extensions/task-orchestrator.ts
```

---

## Work on the CLI

CLI entrypoint:

- `bin/taskplane.mjs`

Typical manual checks:

```bash
node bin/taskplane.mjs help
node bin/taskplane.mjs version
node bin/taskplane.mjs init --dry-run
node bin/taskplane.mjs doctor
```

---

## Work on the dashboard

Dashboard files:

- `dashboard/server.cjs`
- `dashboard/public/index.html`
- `dashboard/public/app.js`
- `dashboard/public/style.css`

Launch via CLI:

```bash
taskplane dashboard
```

Or direct server invocation:

```bash
node dashboard/server.cjs --root . --port 8099 --no-open
```

---

## Work on skills/templates

- Skills: `skills/`
- Templates: `templates/`

Template changes affect `taskplane init` output and must be tested by running init in a scratch repo.

---

## Running tests

Tests use the Node.js native test runner (`node:test`) exclusively — no vitest or vite dependency.

```bash
cd extensions

# Full suite (unit + integration)
npm test

# Fast suite (unit only, skip integration)
npm run test:fast

# Single file
node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/some-file.test.ts
```

Key flags:
- `--experimental-strip-types` — run TypeScript directly without transpilation
- `--experimental-test-module-mocks` — enable `mock.module()` for ESM module mocking
- `--import ./tests/loader.mjs` — register module resolution hooks

The custom loader (`tests/loader.mjs`) redirects `@mariozechner/pi-coding-agent`
and `@mariozechner/pi-tui` to local mock stubs so tests don't need the real packages.

### Test authoring patterns

- Use `import { describe, it, mock, beforeEach, afterEach } from "node:test"` for test structure
- Use `import { expect } from "./expect.ts"` for a familiar matcher API (legacy Vitest-style surface backed by `node:assert`)
- Use `mock.fn()` for function mocks, `mock.method(obj, key)` for spies
- Use `mock.module("mod", { namedExports: {...} })` for ESM module mocking (must be before `await import()` of consumer)
- Use `mock.timers.enable()` / `mock.timers.tick(ms)` / `mock.timers.reset()` for fake timers

---

## Recommended local dev loop

1. Edit extension/CLI/template code
2. Run tests (`cd extensions && npm test`)
3. Run pi with local extension flags
4. Execute manual smoke flows:
   - `/orch-plan all`
   - `/orch all`
   - `taskplane doctor`

---

## Suggested scratch-repo smoke test

```bash
mkdir ../tp-scratch && cd ../tp-scratch
git init
pi install -l npm:taskplane
npx taskplane init --preset full
pi
```

Inside pi:

```text
/orch-plan all
/orch all
/orch taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md
```

---

## File map for core implementation

- `extensions/task-orchestrator.ts` — orchestrator facade export
- `extensions/taskplane/discovery.ts` — task discovery + dependency parsing
- `extensions/taskplane/waves.ts` — DAG + wave computation + lane assignment
- `extensions/taskplane/execution.ts` — lane spawning/monitoring
- `extensions/taskplane/merge.ts` — merge orchestration
- `extensions/taskplane/persistence.ts` — batch state persistence
- `extensions/taskplane/resume.ts` — resume reconciliation and continuation
- `extensions/taskplane/worktree.ts` — worktree lifecycle
