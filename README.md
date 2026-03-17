# Taskplane

Multi-agent AI orchestration for [pi](https://github.com/badlogic/pi-mono) — parallel task execution with checkpoint discipline, fresh-context worker loops, cross-model reviews, and automated merges.

> **Status:** Experimental / Early — APIs and config formats may change between releases.

## What It Does

### STEP 1: Create the tasks
Taskplane turns your coding project into an AI-managed task orchestration system. You simply ask your agent to create tasks using the built-in "create-taskplane-tasks" skill. This skill provides an opinionated task definition template designed to drive successful coding outcomes. Tasks define both the prompt.md and the status.md files that together act as the persistent memory store that allows AI coding agents to survive context resets and succeed with very long running tasks that would typically exhaust an agent's context window.

### STEP 2: Run batches of tasks
The system works out the dependancy map for the entire batch of tasks then orchestrates them in waves, with appropriate parallelization and serialization. 

The taskplane dashboard runs on a local port on your system and gives you elegant visibility into everything that's going on (a stark improvement over TUI-based dashboards).

<img src="docs/images/orchrun-wave2of4-2lanes-withstatus.png" alt="image of taskplane dashboard" width="50%">

### Key Features

- **Task Orchestrator** — Parallel multi-task execution using git worktrees for full filesystem isolation. Dependency-aware wave scheduling. Automated merges with conflict resolution.
- **Task Runner** — What the Orchestrator uses for autonomous single-task execution. Worker agents run in fresh-context loops with STATUS.md as persistent memory. Every checkbox gets a git checkpoint. Cross-model reviewer agents catch what the worker agents missed.
- **Web Dashboard** — Live browser-based monitoring via `taskplane dashboard`. SSE streaming, lane/task progress, wave visualization, batch history.
- **Structured Tasks** — PROMPT.md defines the mission, steps, and constraints. STATUS.md tracks progress. Agents follow the plan, not vibes.
- **Checkpoint Discipline** — Every completed checkbox item triggers a git commit. Work is never lost, even if a worker crashes mid-task.
- **Cross-Model Review** — Reviewer agent uses a different model than the worker agent (highly recommended, not enforced). Independent quality gate before merge.

## Install

Taskplane is a [pi package](https://github.com/badlogic/pi-mono). You need [Node.js](https://nodejs.org/) ≥ 22 and [pi](https://github.com/badlogic/pi-mono) installed first.

### Prerequisites

| Dependency | Required | Notes |
|-----------|----------|-------|
| [Node.js](https://nodejs.org/) ≥ 22 | Yes | Runtime |
| [pi](https://github.com/badlogic/pi-mono) | Yes | Agent framework |
| [Git](https://git-scm.com/) | Yes | Version control, worktrees |
| **tmux** | **Strongly recommended** | Required for `/orch` parallel execution |

**tmux** is needed for the orchestrator to spawn parallel worker sessions. Without it, `/orch` will not work. On Windows, Taskplane can install it for you:

```bash
taskplane install-tmux
```

On macOS: `brew install tmux` · On Linux: `sudo apt install tmux` (or your distro's package manager)

### Option A: Global Install (all projects)

```bash
pi install npm:taskplane
```

### Option B: Project-Local Install (recommended for teams)

```bash
cd my-project
pi install -l npm:taskplane
```

Then scaffold your project:

```bash
taskplane init
```

Verify the installation:

```bash
taskplane doctor
```

## Quickstart

### 1. Initialize a project

```bash
cd my-project
taskplane init --preset full
```

This creates config files in `.pi/`, agent prompts, two example tasks, and adds `.gitignore` entries for runtime artifacts. Init auto-detects whether you're in a single repo or a multi-repo workspace. See the [install tutorial](docs/tutorials/install.md) for workspace mode and other scenarios.

Already have a task folder (for example `docs/task-management`)? Use:

```bash
taskplane init --preset full --tasks-root docs/task-management
```

When `--tasks-root` is provided, example task packets are skipped by default. Add `--include-examples` if you explicitly want examples in that folder.

### 2. Launch the dashboard (recommended)

In a separate terminal:

```bash
taskplane dashboard
```

Opens a live web dashboard at `http://localhost:8099` with real-time batch monitoring.

### 3. Run your first orchestration

```bash
pi
```

Inside the pi session:

```
/orch-plan all     # Preview waves, lanes, and dependencies
/orch all          # Execute all pending tasks in parallel
/orch-status       # Monitor batch progress
```

The default scaffold includes two independent example tasks, so `/orch all` gives you an immediate orchestrator + dashboard experience.

### 4. Optional: run one task directly

`/task` is still useful for single-task execution and focused debugging:

```
/task taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md
/task-status
```

Important distinction:

- `/task` runs in your **current branch/worktree**.
- `/orch` runs tasks in **isolated worktrees** and merges back.

Because workers checkpoint with git commits, `/task` can capture unrelated local edits if you're changing files in parallel. For safer isolation (even with one task), prefer:

```text
/orch taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md
```

Orchestrator lanes execute tasks through task-runner under the hood, so `/task` and `/orch` share the same core task execution model.

## Commands

### Pi Session Commands

| Command | Description |
|---------|-------------|
| `/task <path/to/PROMPT.md>` | Execute one task in the current branch/worktree |
| `/task-status` | Show current task progress |
| `/task-pause` | Pause after current worker iteration finishes |
| `/task-resume` | Resume a paused task |
| `/orch <areas\|paths\|all>` | Execute tasks via isolated worktrees (recommended default) |
| `/orch-plan <areas\|paths\|all>` | Preview execution plan without running |
| `/orch-status` | Show batch progress |
| `/orch-pause` | Pause batch after current tasks finish |
| `/orch-resume` | Resume a paused batch |
| `/orch-abort [--hard]` | Abort batch (graceful or immediate) |
| `/orch-deps <areas\|paths\|all>` | Show dependency graph |
| `/orch-sessions` | List active worker sessions |
| `/settings` | View and edit taskplane configuration interactively |

### CLI Commands

| Command | Description |
|---------|-------------|
| `taskplane init` | Scaffold project config (interactive or `--preset`) |
| `taskplane doctor` | Validate installation and config |
| `taskplane install-tmux` | Install or upgrade tmux for Git Bash (Windows) |
| `taskplane version` | Show version info |
| `taskplane dashboard` | Launch the web dashboard |
| `taskplane uninstall` | Remove Taskplane project files and optionally uninstall package (`--package`) |

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    ORCHESTRATOR (/orch)                      │
│  Parse tasks → Build dependency DAG → Compute waves         │
│  Assign lanes → Spawn workers → Monitor → Merge             │
└──────┬──────────┬──────────┬────────────────────────────────┘
       │          │          │
  ┌────▼────┐ ┌──▼─────┐ ┌──▼─────┐
  │ Lane 1  │ │ Lane 2 │ │ Lane 3 │    ← Git worktrees
  │ /task   │ │ /task  │ │ /task  │       (isolated)
  │ Worker  │ │ Worker │ │ Worker │
  │ Review  │ │ Review │ │ Review │
  └────┬────┘ └──┬─────┘ └──┬─────┘
       │         │          │
       └─────────┼──────────┘
                 │
          ┌──────▼──────┐
          │ Merge Agent │    ← Conflict resolution
          │ Integration │      & verification
          │   Branch    │
          └─────────────┘
```

**Single task** (`/task`): Worker iterates in fresh-context loops. STATUS.md is persistent memory. Each checkbox → git checkpoint. Reviewer validates on completion.

**Parallel batch** (`/orch`): Tasks are sorted into dependency waves. Each wave runs in parallel across lanes (git worktrees). Completed lanes merge into the integration branch before the next wave starts.

## Documentation

📖 **[Full Documentation](docs/README.md)**

Start at the docs index for tutorials, how-to guides, reference docs, and architecture explanations.

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for development setup, testing, and contribution guidelines.

Maintainers: GitHub governance and branch protection guidance is in [docs/maintainers/repository-governance.md](docs/maintainers/repository-governance.md).

## License

[MIT](LICENSE) © Henry Lach
