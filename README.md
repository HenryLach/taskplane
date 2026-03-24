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

- **Task Orchestrator** — Parallel multi-task execution using git worktrees for full filesystem isolation. Dependency-aware wave scheduling. Automated merges into a dedicated orch branch — your working branch stays stable until you choose to integrate.
- **Persistent Worker Context** — Workers handle all steps in a single context, auto-detecting the model's context window (1M for Claude 4.6 Opus, 200K for Bedrock). Only iterates on context overflow. Dramatic reduction in spawn count and token cost.
- **Worker-Driven Inline Reviews** — Workers invoke a `review_step` tool at step boundaries. Reviewer agents spawn in tmux sessions with full telemetry. REVISE feedback is addressed inline without losing context.
- **Supervisor Agent** — Conversational supervisor monitors batch progress, handles failures, and can invoke orchestrator commands autonomously (resume, integrate, pause, abort).
- **Web Dashboard** — Live browser-based monitoring via `taskplane dashboard`. SSE streaming, lane/task progress, reviewer activity, merge telemetry, batch history.
- **Structured Tasks** — PROMPT.md defines the mission, steps, and constraints. STATUS.md tracks progress. Agents follow the plan, not vibes.
- **Checkpoint Discipline** — Step boundary commits ensure work is never lost, even if a worker crashes mid-task.
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
/orch               # Detect project state — guides onboarding or offers to start a batch
/orch-plan all      # Preview waves, lanes, and dependencies
/orch all           # Execute all pending tasks in parallel
/orch-status        # Monitor batch progress
```

`/orch` with no arguments is the universal entry point — it detects your project state and activates the supervisor for guided interaction (onboarding, batch planning, health checks, or retrospective). The default scaffold includes two independent example tasks, so `/orch all` gives you an immediate orchestrator + dashboard experience.

### 4. Run a single task with isolation

For a single task with full worktree isolation, dashboard, and reviews:

```text
/orch taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md
```

This uses the same orchestrator infrastructure as a full batch — isolated worktree, orch branch, supervisor, dashboard, inline reviews — but for just one task.

> **Note:** The `/task` command still exists for direct single-task execution in the current branch, but `/orch` is recommended for all workflows. `/task` does not provide worktree isolation, dashboard, or inline reviews.

## Commands

### Pi Session Commands

| Command | Description |
|---------|-------------|
| `/task <path/to/PROMPT.md>` | Execute one task in the current branch/worktree |
| `/task-status` | Show current task progress |
| `/task-pause` | Pause after current worker iteration finishes |
| `/task-resume` | Resume a paused task |
| `/orch [<areas\|paths\|all>]` | No args: detect state & guide (onboarding, batch planning, etc.); with args: execute tasks via isolated worktrees |
| `/orch-plan <areas\|paths\|all>` | Preview execution plan without running |
| `/orch-status` | Show batch progress |
| `/orch-pause` | Pause batch after current tasks finish |
| `/orch-resume [--force]` | Resume a paused batch (or force-resume from stopped/failed) |
| `/orch-abort [--hard]` | Abort batch (graceful or immediate) |
| `/orch-deps <areas\|paths\|all>` | Show dependency graph |
| `/orch-sessions` | List active worker sessions |
| `/orch-integrate` | Integrate completed orch batch into your working branch |
| `/taskplane-settings` | View and edit taskplane configuration interactively |

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
          │ Orch Branch │      & verification
          └──────┬──────┘
                 │
          ┌──────▼──────┐
          │ /orch-      │    ← User integrates into
          │  integrate  │      working branch
          └─────────────┘
```

**How it works:** Tasks are sorted into dependency waves. Each wave runs in parallel across lanes (git worktrees). Workers handle all steps in a single context, calling `review_step` at step boundaries for inline reviews. Completed lanes merge into a dedicated orch branch. A supervisor agent monitors progress and can autonomously resume, integrate, or abort. When the batch completes, use `/orch-integrate` to bring the results into your working branch (or configure auto-integration).

## Documentation

📖 **[Full Documentation](docs/README.md)**

Start at the docs index for tutorials, how-to guides, reference docs, and architecture explanations.

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for development setup, testing, and contribution guidelines.

Maintainers: GitHub governance and branch protection guidance is in [docs/maintainers/repository-governance.md](docs/maintainers/repository-governance.md).

## License

[MIT](LICENSE) © Henry Lach
