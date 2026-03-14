# Install Taskplane

This tutorial gets Taskplane running in a project and verifies that `/task` and `/orch` are available in your pi session.

## Prerequisites

- Node.js **20+**
- [pi](https://github.com/badlogic/pi-mono)
- Git

Optional (for tmux-based orchestration visibility):
- tmux

---

## Choose an Install Scope

Taskplane can be installed globally (all projects) or project-local (current project only).

### Option A — Global install

Use this if you want Taskplane commands available in every pi session.

```bash
pi install npm:taskplane
```

> You can also install the CLI directly with `npm install -g taskplane`, but the recommended path is `pi install npm:taskplane` because it also registers the package for pi extension/skill auto-discovery.

### Option B — Project-local install (recommended for teams)

Use this when you only want Taskplane in one repository.

```bash
cd my-project
pi install -l npm:taskplane
```

This writes package config to `.pi/settings.json` in the project.

---

## Initialize the Project

From the project root:

```bash
taskplane init
```

If `taskplane` is not on your PATH (common with project-local installs), run:

```bash
npx taskplane init
```

Or:

```bash
.pi/npm/node_modules/.bin/taskplane init
```

For a non-interactive default setup:

```bash
taskplane init --preset full
```

This scaffolds:

- `.pi/task-runner.yaml`
- `.pi/task-orchestrator.yaml`
- `.pi/agents/task-worker.md`
- `.pi/agents/task-reviewer.md`
- `.pi/agents/task-merger.md`
- `.pi/taskplane.json`
- `taskplane-tasks/CONTEXT.md`
- `taskplane-tasks/EXAMPLE-001-hello-world/{PROMPT.md,STATUS.md}`

---

## Validate the Installation

Run:

```bash
taskplane doctor
```

You should see checks for:

- pi installed
- Node.js version
- git installed
- taskplane package installed
- required `.pi/` files present
- task area paths and CONTEXT files present

---

## Verify Commands in a pi Session

Start pi in the project:

```bash
pi
```

Inside pi, run:

```
/task
/orch
```

Both should show usage/help text (confirming command registration).

You can also run:

```
/orch-plan all
```

If you just initialized the project, this should discover the example task and show a plan.

---

## Quick Smoke Test

Run the included example task:

```
/task taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md
```

If successful, Taskplane will create:

- `hello-taskplane.md` in your project root
- `.DONE` in the example task folder

---

## Troubleshooting

### `taskplane: command not found`

Use `npx taskplane <command>` or `.pi/npm/node_modules/.bin/taskplane <command>`.

### `/task` is unknown inside pi

You likely installed via `npm` but not via `pi`. Run:

```bash
pi install npm:taskplane
```

### `taskplane doctor` reports missing `.pi/task-*.yaml`

Run `taskplane init` from the project root.

### tmux warning in doctor

tmux is optional unless you use `spawn_mode: tmux` in orchestrator config.

---

## Next Step

Continue to: **[Run Your First Task](run-your-first-task.md)**
