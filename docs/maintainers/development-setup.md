# Development Setup

This guide is for contributors working on Taskplane itself.

## Prerequisites

- Node.js 20+
- Git
- pi
- Optional: `just` for convenience commands

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

### Load both task-runner and orchestrator

```bash
pi -e extensions/task-orchestrator.ts -e extensions/task-runner.ts
```

Or with just:

```bash
just orch
```

### Load task-runner only

```bash
pi -e extensions/task-runner.ts
```

Or:

```bash
just task
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

## Recommended local dev loop

1. Edit extension/CLI/template code
2. Run tests (`cd extensions && npx vitest run`)
3. Run pi with local extension flags
4. Execute manual smoke flows:
   - `/orch-plan all`
   - `/orch all`
   - `/task ...` (single-task mode)
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
/task taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md
```

---

## File map for core implementation

- `extensions/task-runner.ts` — single-task engine
- `extensions/task-orchestrator.ts` — orchestrator facade export
- `extensions/taskplane/discovery.ts` — task discovery + dependency parsing
- `extensions/taskplane/waves.ts` — DAG + wave computation + lane assignment
- `extensions/taskplane/execution.ts` — lane spawning/monitoring
- `extensions/taskplane/merge.ts` — merge orchestration
- `extensions/taskplane/persistence.ts` — batch state persistence
- `extensions/taskplane/resume.ts` — resume reconciliation and continuation
- `extensions/taskplane/worktree.ts` — worktree lifecycle
