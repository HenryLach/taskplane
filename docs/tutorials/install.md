# Install Taskplane

This tutorial gets Taskplane running in a project and verifies that `/task` and `/orch` are available in your pi session.

## Prerequisites

- Node.js **22+**
- [pi](https://github.com/badlogic/pi-mono)
- Git
- **tmux** (strongly recommended — required for `/orch` parallel execution)

### Installing tmux

tmux is needed for the orchestrator to spawn parallel worker sessions in isolated worktrees. Without it, `/orch` will not work.

**Windows (Git Bash):**

```bash
taskplane install-tmux
```

This downloads tmux from the official [MSYS2](https://packages.msys2.org/packages/tmux) package repository and installs it into `~/bin/`. No admin rights or external tools needed. To upgrade later, run the same command with `--force`.

**macOS:**

```bash
brew install tmux
```

**Linux (Debian/Ubuntu):**

```bash
sudo apt install tmux
```

Verify tmux is available:

```bash
tmux -V
```

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

If your project already has a task folder, point init at it:

```bash
taskplane init --preset full --tasks-root docs/task-management
```

When `--tasks-root` is provided, Taskplane skips sample task packets by default to avoid polluting an existing task area. Add `--include-examples` if you explicitly want them.

This scaffolds:

- `.pi/task-runner.yaml`
- `.pi/task-orchestrator.yaml`
- `.pi/agents/task-worker.md`
- `.pi/agents/task-reviewer.md`
- `.pi/agents/task-merger.md`
- `.pi/taskplane.json`
- `taskplane-tasks/CONTEXT.md`
- `taskplane-tasks/EXAMPLE-001-hello-world/{PROMPT.md,STATUS.md}`
- `taskplane-tasks/EXAMPLE-002-parallel-smoke/{PROMPT.md,STATUS.md}`

> **Tip:** You can also use a single `.pi/taskplane-config.json` file instead of the two YAML files. When a JSON config is present it takes precedence and the YAML files are ignored. See the [task-runner config reference](../reference/configuration/task-runner.yaml.md#unified-json-config) and [orchestrator config reference](../reference/configuration/task-orchestrator.yaml.md#unified-json-config) for the JSON format.

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
/orch
/orch-plan all
```

This confirms orchestrator commands are registered and shows a plan preview.

Optional single-task check:

```
/task
```

---

## Quick Smoke Test (Orchestrator-First)

Recommended flow:

1. In terminal A, launch the dashboard:

```bash
taskplane dashboard
```

2. In terminal B (inside pi), run:

```text
/orch-plan all
/orch all
/orch-status
```

With a fresh init, this should run both default example tasks and show live progress in the dashboard.

Expected artifacts:

- `hello-taskplane.md`
- `hello-taskplane-2.md`
- `taskplane-tasks/EXAMPLE-001-hello-world/.DONE`
- `taskplane-tasks/EXAMPLE-002-parallel-smoke/.DONE`

Optional single-task mode:

```text
/task taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md
```

---

## Uninstall

### Remove project-scaffolded Taskplane files

```bash
taskplane uninstall
```

Preview first:

```bash
taskplane uninstall --dry-run
```

### Also remove installed package (extensions, skills, dashboard)

```bash
taskplane uninstall --package
```

You can force package scope when needed:

- local install: `taskplane uninstall --package --local`
- global install: `taskplane uninstall --package --global`

If you only want package removal, use:

```bash
taskplane uninstall --package-only
```

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

### tmux missing or not found

tmux is required for `/orch` parallel execution. Install it:

- **Windows:** `taskplane install-tmux`
- **macOS:** `brew install tmux`
- **Linux:** `sudo apt install tmux`

---

## Next Step

Continue to: **[Run Your First Orchestration](run-your-first-orchestration.md)**
