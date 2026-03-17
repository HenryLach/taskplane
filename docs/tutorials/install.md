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

### Mode Auto-Detection

`taskplane init` automatically detects your project layout:

| Layout | Mode | What happens |
|--------|------|-------------|
| Single git repo (or monorepo) | **Repo mode** | Config scaffolded into `.pi/` in the current directory |
| Directory with git repo subdirectories | **Workspace mode** | Config scaffolded into `.taskplane/` inside a chosen config repo; pointer file created in workspace root |
| Git repo **and** git repo subdirectories | **Ambiguous** | Interactive prompt asks you to choose repo or workspace mode (defaults to repo with `--preset`) |
| No git repo found | **Error** | Init exits with a message asking you to run from a git repo |

In ambiguous cases, preset/dry-run/non-interactive modes default to repo mode without prompting.

### Repo Mode (Standard)

For a single repo or monorepo:

```bash
taskplane init --preset full
```

This scaffolds:

- `.pi/task-runner.yaml` — task runner config
- `.pi/task-orchestrator.yaml` — orchestrator config
- `.pi/taskplane-config.json` — unified JSON config (takes precedence when present)
- `.pi/taskplane.json` — version tracker
- `.pi/agents/task-worker.md`, `task-reviewer.md`, `task-merger.md` — agent prompts
- `taskplane-tasks/CONTEXT.md` — task area context
- `taskplane-tasks/EXAMPLE-001-hello-world/{PROMPT.md,STATUS.md}` — example tasks
- `taskplane-tasks/EXAMPLE-002-parallel-smoke/{PROMPT.md,STATUS.md}` — example tasks

If your project already has a task folder, point init at it:

```bash
taskplane init --preset full --tasks-root docs/task-management
```

When `--tasks-root` is provided, Taskplane skips sample task packets by default to avoid polluting an existing task area. Add `--include-examples` if you explicitly want them.

### Workspace Mode

For multi-repo workspaces (e.g., a parent directory containing several independent git repos):

```bash
cd my-workspace    # contains repo-a/, repo-b/, repo-c/ as git repos
taskplane init
```

Init detects the subdirectory repos and prompts you to choose which one holds the shared Taskplane config. The selected repo gets a `.taskplane/` directory with all config, and the workspace root gets a pointer file (`.pi/taskplane-pointer.json`) that tells Taskplane where to find it.

Files created in the config repo (e.g., `repo-a`):

- `repo-a/.taskplane/task-runner.yaml`
- `repo-a/.taskplane/task-orchestrator.yaml`
- `repo-a/.taskplane/taskplane-config.json`
- `repo-a/.taskplane/taskplane.json`
- `repo-a/.taskplane/workspace.json` — lists all discovered repos
- `repo-a/.taskplane/agents/task-worker.md`, `task-reviewer.md`, `task-merger.md`
- `repo-a/taskplane-tasks/CONTEXT.md`

Files created in the workspace root:

- `.pi/taskplane-pointer.json` — points to the config repo

> **Important:** After workspace init, merge the `.taskplane/` directory in the config repo to its default branch before other team members run `taskplane init`. Team members joining later will see the existing config and get Scenario D (pointer-only) instead of a full re-init.

### Joining an Existing Workspace (Scenario D)

If you run `taskplane init` in a workspace where `.taskplane/` already exists in one of the subdirectory repos, Taskplane detects this and creates only the pointer file — no config prompts, no scaffolding. This is the intended flow for team members joining an already-initialized workspace.

### Presets

All presets work in both repo and workspace modes:

| Preset | What it includes |
|--------|------------------|
| `--preset full` | Task runner + orchestrator + examples |
| `--preset minimal` | Task runner + orchestrator, no examples |
| `--preset runner-only` | Task runner only (no orchestrator config) |

### Gitignore Enforcement

During init, Taskplane automatically adds entries to `.gitignore` for runtime artifacts that should not be committed:

- `.pi/batch-state.json`, `.pi/batch-history.json` — orchestrator state
- `.pi/lane-state-*`, `.pi/merge-result-*`, `.pi/merge-request-*` — lane/merge artifacts
- `.pi/worker-conversation-*` — worker conversation logs
- `.pi/orch-logs/`, `.pi/orch-abort-signal` — orchestrator logs/signals
- `.pi/settings.json` — machine-local pi settings
- `.worktrees/` — git worktree directories
- `.pi/npm/` — project-local npm packages

If any of these files are already tracked in git, init detects them and offers to untrack them with `git rm --cached` (interactive mode only).

In workspace mode, these entries are prefixed with `.taskplane/` and added to the config repo's `.gitignore`.

### tmux Detection

Init checks for tmux availability and sets the orchestrator's `spawn_mode` accordingly:

- **tmux found** → `spawn_mode: "tmux"` (parallel execution via tmux sessions)
- **tmux not found** → `spawn_mode: "subprocess"` with a guidance message suggesting `taskplane install-tmux`

This is silent when tmux is present. The `runner-only` preset skips this check since no orchestrator config is generated.

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

To review or customize your configuration interactively:

```
/settings
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
