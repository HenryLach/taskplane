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

`taskplane init` auto-detects your project layout and runs the appropriate init flow.

### How mode detection works

When you run `taskplane init`, Taskplane examines the current directory:

| Layout | Detected mode | Behavior |
|--------|---------------|----------|
| Inside a git repo, no git repo subdirectories | **Repo mode** | Scaffolds config in `.pi/` (Scenario A) |
| Not a git repo, has git repo subdirectories | **Workspace mode** | Scaffolds config in `<config-repo>/.taskplane/` (Scenario C/D) |
| Inside a git repo **and** has git repo subdirectories | **Ambiguous** | Prompts you to choose repo or workspace mode |
| Not a git repo, no git repo subdirectories | **Error** | Exits with a message to run from a git repo or workspace |

> **Preset/dry-run note:** In non-interactive modes (`--preset`, `--dry-run`), ambiguous layouts default to repo mode without prompting.

### Scenario A — Standard repo init (most common)

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
- `.pi/taskplane-config.json`
- `.pi/agents/task-worker.md`
- `.pi/agents/task-reviewer.md`
- `.pi/agents/task-merger.md`
- `.pi/taskplane.json`
- `taskplane-tasks/CONTEXT.md`
- `taskplane-tasks/EXAMPLE-001-hello-world/{PROMPT.md,STATUS.md}`
- `taskplane-tasks/EXAMPLE-002-parallel-smoke/{PROMPT.md,STATUS.md}`

> **JSON + YAML:** Init now generates a `taskplane-config.json` file alongside the YAML configs. When a JSON config is present it takes precedence and the YAML files are ignored. YAML generation is retained during the transition period. See the [task-runner config reference](../reference/configuration/task-runner.yaml.md#unified-json-config) and [orchestrator config reference](../reference/configuration/task-orchestrator.yaml.md#unified-json-config) for the JSON format.

### Scenario B — Already initialized

If Taskplane detects an existing config (`.pi/task-runner.yaml`, `.pi/task-orchestrator.yaml`, or `.pi/taskplane-config.json`), it shows:

```
Project already initialized (config exists in .pi/).
Run `taskplane doctor` to verify, or use --force to reinitialize.
```

Use `--force` to overwrite existing files.

### Scenario C — Workspace init (multi-repo)

When you run `taskplane init` from a directory that contains multiple git repos as subdirectories (and is not itself a git repo), Taskplane enters workspace mode:

1. Lists discovered git repos
2. Prompts you to choose which repo holds Taskplane config
3. Scaffolds `.taskplane/` in the chosen config repo (config, agents, workspace definition)
4. Creates `.pi/taskplane-pointer.json` in the workspace root pointing to the config repo
5. Adds gitignore entries to the config repo's `.gitignore`
6. Auto-commits the config to the config repo

```bash
cd my-workspace    # contains repo-a/, repo-b/, repo-c/
taskplane init
```

After workspace init, merge the config repo changes to your default branch so other team members can join.

### Scenario D — Workspace join

When workspace mode detects an existing `.taskplane/` directory in one of the subdirectory repos (i.e., another team member already ran Scenario C and merged), it skips scaffolding and only creates the pointer file:

```
Found existing Taskplane config in repo-a/.taskplane/
Using existing configuration.
```

This is the expected flow for the second (and subsequent) developer on a team.

---

## Gitignore Enforcement

During init, Taskplane automatically adds entries to `.gitignore` for runtime artifacts that should never be committed:

- `.pi/batch-state.json` — orchestrator state
- `.pi/batch-history.json` — batch history
- `.pi/lane-state-*` — lane execution state
- `.pi/merge-result-*`, `.pi/merge-request-*` — merge artifacts
- `.pi/worker-conversation-*` — worker conversations
- `.pi/orch-logs/` — orchestrator logs
- `.pi/orch-abort-signal` — abort signal file
- `.pi/settings.json` — pi settings (machine-specific)
- `.worktrees/` — git worktree scratch area
- `.pi/npm/` — project-local pi packages

If any of these artifacts are already tracked by git, Taskplane detects them and offers to untrack them (`git rm --cached`). Files remain on disk but are removed from git tracking.

In workspace mode, these entries are prefixed with `.taskplane/` in the config repo's `.gitignore`.

---

## tmux Detection

During init, Taskplane checks whether tmux is available:

- **tmux found:** `spawn_mode` defaults to `"tmux"` in the orchestrator config. No message shown.
- **tmux not found:** `spawn_mode` defaults to `"subprocess"` and a guidance message is shown:

  ```
  ⚠ tmux not found. Using subprocess mode.
    Run `taskplane install-tmux` for full orchestrator support.
  ```

  The `runner-only` preset suppresses this message since it does not generate orchestrator config.

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
