# Taskplane

Multi-agent AI orchestration for coding with [pi](https://github.com/badlogic/pi-mono) — parallel task execution, mono- and poly-repo support, fresh-context worker loops, cross-model reviews, automated merges and a killer dashboard! 

> **Status:** Initial release.

## What It Does

Taskplane orchesrates batches of task to help you turn ideas into high-quality code using a proven process of:

have an idea >> create a spec >> create tasks >> orchestrate tasks >> evaluate the outcome

For background on Taskplane's creation see [Author's Note on Medium](https://medium.com/@henry_49934/welcome-to-taskplane-authors-note-ad3a0278fdd3).

### Taskplane has:
- A skill for creating tasks that the Taskplane orchestrator can run
- prompt.md/status.md task definitions for persistent memory store
- Support for both monorepo and polyrepo projects
- Complete parallelized worktree isolation with dependency graphing and segment-level repo isolation
- 4 agent types: supervisor, worker, reviewer, and merger
- A deterministic orchestration engine to drive repeatable positive agent outcomes at scale
- A simple file-based mail system so agents can communicate with each other
- A killer locally-run web-based dashboard so you can see everything that's going on

<img src="docs/images/orchrun-wave2of4-2lanes-withstatus.png" alt="image of taskplane dashboard" width="50%">

### STEP 1: Create the tasks
Taskplane turns your coding project into an AI-managed task orchestration system. You simply ask your agent to create tasks using the built-in "create-taskplane-tasks" skill. This skill provides an opinionated task definition template designed to drive successful coding outcomes. Tasks define both the prompt.md and the status.md files that together act as the persistent memory store that allows AI coding agents to survive context resets and succeed with very long running tasks that would typically exhaust an agent's context window.

### STEP 2: Run batches of tasks
Taskplane works out the dependency map for an entire batch of tasks then orchestrates them in waves, lanes, and tasks with appropriate parallelization and serialization. Taskplane can do this for both monorepo and polyrepo projects. For polyrepo projects, Taskplane additionally subdivides tasks into repo-aligned segments and uses a segmentation dependency map (DAG) to manage proper repo/worktree isolation and allow for dynamic segment expansion so worker agents can ask the supervisor agent to add additional segments to the dependency map in real time if required.

### Key Features

- **Task Orchestrator** — Parallel multi-task execution using git worktrees for full filesystem isolation. Dependency-aware wave scheduling. Automated merges into a dedicated orch branch — your working branch stays stable until you choose to integrate.
- **Persistent Worker Context** — Workers handle all steps in a single context, auto-detecting the model's context window. Only iterates on context overflow. Dramatic reduction in spawn count and token cost.
- **Worker-Driven Inline Reviews** — Workers invoke a `review_step` tool at step boundaries. Reviewer agents spawn with full telemetry. REVISE feedback is addressed inline without losing context.
- **Supervisor Agent** — Conversational supervisor monitors batch progress, handles failures, and can invoke orchestrator commands autonomously (resume, integrate, pause, abort).
- **Web Dashboard** — Live browser-based monitoring via `taskplane dashboard`. SSE streaming, lane/task progress, reviewer activity, merge telemetry, batch history.
- **Structured Tasks** — PROMPT.md defines the mission, steps, and constraints. STATUS.md tracks progress. Agents follow the plan, not vibes.
- **Checkpoint Discipline** — Step boundary commits ensure work is never lost, even if a worker crashes mid-task.
- **Cross-Model Review** — Reviewer agent uses a different model than the worker agent (highly recommended, not enforced). Independent quality gate before merge.

## Installation

Taskplane is a pi package. You need Node.js 22+, pi and Git installed first.

### Prerequisites

| Dependency | Required | Notes |
|-----------|----------|-------|
| [Node.js](https://nodejs.org/) ≥ 22 | Yes | Runtime |
| [pi](https://github.com/badlogic/pi-mono) | Yes | Agent framework |
| [Git](https://git-scm.com/) | Yes | Version control, worktrees |

IMPORTANT: If you just installed pi, make sure you've configured at least one model provider and tested before installing Taskplane.

### Option A: Global Install (all projects - recommended)

```bash
pi install npm:taskplane
```

### Option B: Single Project-Local Install

```bash
cd my-project
pi install -l npm:taskplane
```

## Quickstart

### 1. Initialize a project (to scaffold settings)
(NOTE: if 'my-project' is a monorepo, be sure to run git init first. Taskplane uses git worktrees to isolate agent coding until you're ready to merge back to your default branch.)
```bash
cd my-project
taskplane init
```
You'll answer a few questions. You can usually just accept the defaults. 

This creates config files in `.pi/`, agent prompts, two example tasks, and adds `.gitignore` entries for runtime artifacts. On first install, init bootstraps global preferences at `~/.pi/agent/taskplane/preferences.json` with thinking defaults set to `high` for worker & reviewer, and off for merger. Init auto-detects whether you're in a single repo or a multi-repo workspace. See the [install tutorial](docs/tutorials/install.md) for workspace mode and other scenarios.

Already have a task folder (for example `docs/task-management`)? Use:

```bash
taskplane init --preset full --tasks-root docs/task-management
```

When `--tasks-root` is provided, example task packets are skipped by default. Add `--include-examples` if you explicitly want examples in that folder.

### 2. Check your install with taskplane doctor

Verify the installation and scaffolding. You should have all green checkboxes if everything was successful:

```bash
taskplane doctor
```

### 3. Launch the dashboard (recommended)

In a separate terminal:

```bash
taskplane dashboard
```

Opens a live web dashboard at `http://localhost:8099` with real-time batch monitoring.

### 4. Run your first orchestration

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

### 5. Run a single task with isolation

For a single task with full worktree isolation, dashboard, and reviews:

```text
/orch taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md
```

This uses the same orchestrator infrastructure as a full batch — isolated worktree, orch branch, supervisor, dashboard, inline reviews — but for just one task.

## What to do next

When you're in pi, type /taskplane-settings. Near the top you'll see the 4 agents. By default, Taskplane installs with the agent models set to inherit whatever model your pi session is currently using. The best thing you can do is configure the reviewer agent to use a different model provider. If you're using Claude for coding, then consider using OpenAI for the reviews. 

## Commands

### Pi Session Commands

| Command | Description |
|---------|-------------|
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
| `taskplane config --save-as-defaults` | Save current worker/reviewer/merger model + thinking settings as defaults for future `taskplane init` runs |
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
  │ Worker  │ │ Worker │ │ Worker │       (isolated)
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
