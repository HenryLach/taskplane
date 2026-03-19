# Taskplane CLI — Specification

> **Status:** Draft v0.4 — Implemented  
> **Created:** 2026-03-11  
> **Last Updated:** 2026-03-13  
> **Change from v0.3:** Removed themes (theme-cycler, themeMap, theme JSONs) and damage-control (damage-control.ts, damage-control-rules.yaml) — neither is core orchestration. Aligned package layout with implemented repo structure. CLI (`bin/taskplane.mjs`) implemented with init, doctor, version, dashboard commands.

---

## 1. Problem Statement

Taskplane is an AI agent orchestration system built as a set of [pi](https://github.com/badlogic/pi-mono) extensions. It provides:

- **Task Runner** (`/task`) — Autonomous single-task execution with checkpoint discipline, fresh-context worker loops, and cross-model reviews
- **Task Orchestrator** (`/orch`) — Parallel multi-task execution using git worktrees, dependency-aware wave scheduling, and automated merges
- **Web Dashboard** — Live browser-based monitoring of batch execution with SSE streaming, lane/task progress, wave visualization, and batch history
- **Supporting infrastructure** — Agent personas, skills, config files, and task templates

Today the only way to use Taskplane is to clone the repository and manually copy/adapt files into your project. This limits adoption and makes upgrades painful.

### Goals

1. **Zero-to-running in two commands** — `pi install npm:taskplane` + `taskplane init`
2. **Pi-native distribution** — Ship as a standard pi package; extensions and skills auto-discovered
3. **Project-local config** — YAML configs and agent prompts live in the user's repo (not in the package)
4. **Upgradeable** — `pi update` upgrades extensions/skills; `taskplane upgrade` handles project config
5. **Works with any project type** — Not coupled to Go, React, or any specific stack
6. **Controllable scope** — Users choose global (all projects) or project-local (opt-in) installation

### Non-Goals (v1)

- Cloud-hosted orchestration
- Plugin marketplace / third-party extensions
- Replacing pi itself — Taskplane is always an extension layer on top of pi

---

## 2. Distribution Model

Taskplane ships as a **pi package** — using pi's native `pi install` / `pi update` / `pi remove` system for extension and skill delivery. A separate **CLI** (`taskplane`) handles project scaffolding that the package system can't do (config files, agent prompts, task directories).

### 2.1 Two-layer Architecture

| Layer | What | Delivered via | Lives where |
|---|---|---|---|
| **Package** | Extensions, skills | `pi install npm:taskplane` | Pi package cache (global or project) |
| **Project config** | YAML configs, agent prompts, task dirs | `taskplane init` CLI | User's repo (`.pi/`, `.agents/`, `docs/`) |

The package layer is **stateless** — it provides code and templates. The project config layer is **stateful** — it's customized per-project and committed to git.

### 2.2 Why Two Layers?

Pi's package system auto-discovers extensions and skills from the package directory. But it does **not** scaffold project-local config files. Taskplane needs both:

| File type | Can pi packages deliver? | Needs scaffolding? |
|---|---|---|
| Extensions (`.ts`) | ✅ Yes — auto-discovered from `extensions/` | No |
| Skills (`SKILL.md`) | ✅ Yes — auto-discovered from `skills/` | No |
| Dashboard (`server.cjs` + `public/`) | ✅ Ships in package — launched by CLI or extension, not auto-discovered | No |
| `.pi/task-runner.yaml` | ❌ No — project-specific, user-edited | ✅ Yes |
| `.pi/task-orchestrator.yaml` | ❌ No — project-specific, user-edited | ✅ Yes |
| `.pi/agents/*.md` | ❌ No — must be in `.pi/agents/` to be discoverable | ✅ Yes |
| `taskplane-tasks/` structure | ❌ No — project-specific | ✅ Yes |

---

## 3. NPM Package Structure

### 3.1 Package Layout

```
taskplane/                              ← npm package root (= repo root)
├── bin/
│   └── taskplane.mjs                  # CLI entry point (init, doctor, version, dashboard)
├── dashboard/                          # ← web dashboard (NOT auto-discovered by pi)
│   ├── server.cjs                     # Zero-dep Node HTTP server with SSE streaming
│   └── public/                        # Static frontend (vanilla JS/CSS/HTML)
│       ├── index.html
│       ├── app.js
│       └── style.css
├── extensions/                         # ← pi auto-discovers from here
│   ├── task-runner.ts                 # /task command
│   ├── task-orchestrator.ts           # /orch commands (facade)
│   └── taskplane/                     # Orchestrator internals
│       ├── index.ts
│       ├── types.ts
│       ├── discovery.ts
│       ├── engine.ts
│       ├── execution.ts
│       ├── extension.ts
│       ├── formatting.ts
│       ├── git.ts
│       ├── merge.ts
│       ├── messages.ts
│       ├── persistence.ts
│       ├── resume.ts
│       ├── sessions.ts
│       ├── waves.ts
│       ├── worktree.ts
│       ├── abort.ts
│       └── config.ts
├── skills/                             # ← pi auto-discovers from here
│   └── create-taskplane-task/
│       ├── SKILL.md
│       └── references/
│           ├── context-template.md
│           └── prompt-template.md
├── templates/                          # ← used by CLI only (not auto-discovered)
│   ├── agents/
│   │   ├── task-worker.md
│   │   ├── task-reviewer.md
│   │   └── task-merger.md
│   ├── config/
│   │   ├── task-runner.yaml
│   │   └── task-orchestrator.yaml
│   └── tasks/
│       ├── CONTEXT.md
│       └── EXAMPLE-001-hello-world/
│           ├── PROMPT.md
│           └── STATUS.md
├── package.json
├── LICENSE
└── README.md
```

### 3.2 package.json

```json
{
  "name": "taskplane",
  "version": "0.1.0",
  "description": "AI agent orchestration for pi — parallel task execution with checkpoint discipline",
  "keywords": ["pi-package", "ai", "agent", "orchestration", "task-runner", "parallel"],
  "bin": {
    "taskplane": "./bin/taskplane.mjs"
  },
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"]
  },
  "type": "module",
  "engines": {
    "node": ">=20.0.0"
  },
  "files": [
    "bin/",
    "dashboard/",
    "extensions/task-runner.ts",
    "extensions/task-orchestrator.ts",
    "extensions/taskplane/",
    "skills/",
    "templates/"
  ],
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-tui": "*",
    "@mariozechner/pi-ai": "*",
    "@sinclair/typebox": "*"
  },
  "dependencies": {
    "yaml": "^2.4.0"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/HenryLach/taskplane.git"
  }
}
```

**Key points:**
- `"pi"` manifest tells pi what to auto-discover (extensions, skills)
- `"bin"` exposes the `taskplane` CLI for project scaffolding
- `"files"` whitelist ensures only package content ships (no tests, node_modules, dev configs)
- `"pi-package"` keyword enables gallery discoverability
- `peerDependencies` use `"*"` range per pi package docs — pi bundles these
- `templates/` is intentionally **not** listed in the `pi` manifest — it's only used by the CLI
- `dashboard/` is intentionally **not** listed in the `pi` manifest — it's a standalone Node server launched by the CLI, not a pi extension

---

## 4. File Deployment Maps

### 4.1 Scenario A: Global Install

User runs taskplane commands available to **all projects**. Extensions and skills load in every pi session.

#### Step 1: Install the package

```bash
pi install npm:taskplane
```

**What pi does:**
- Runs `npm install -g taskplane`
- Adds `"npm:taskplane"` to `~/.pi/agent/settings.json` → `packages[]`
- Discovers resources via the `pi` manifest in `package.json`

**Files created by `pi install`:**

```
~/.pi/agent/
├── settings.json                          # ← "npm:taskplane" added to packages[]
└── (pi manages its own package cache)

<npm-global-root>/node_modules/taskplane/  # e.g., C:\Users\<user>\AppData\Roaming\npm\node_modules\taskplane
├── bin/taskplane.mjs                      # CLI available as `taskplane` on PATH
├── dashboard/                             # ← standalone web dashboard (NOT auto-loaded by pi)
│   ├── server.cjs                         #    → launched by `taskplane dashboard`
│   └── public/                            #    → static frontend served by server.cjs
├── extensions/                            # ← pi auto-loads these in every session
│   ├── task-runner.ts                     #    → registers /task, /task-status, /task-pause, /task-resume
│   ├── task-orchestrator.ts               #    → registers /orch, /orch-plan, /orch-status, /orch-pause
│   └── taskplane/...
├── skills/                                # ← pi auto-loads these in every session
│   └── create-taskplane-task/SKILL.md      #    → "create a taskplane task" skill available everywhere
├── templates/...                          # NOT auto-loaded (not in pi manifest)
└── package.json
```

**Result after Step 1:**
- Every `pi` session now has `/task`, `/orch-*` commands and all skills
- But `/task` and `/orch` will error if you try to use them — no project config exists yet

#### Step 2: Scaffold a project

```bash
cd ~/my-project
taskplane init
```

**Files created by `taskplane init`:**

```
~/my-project/
├── .pi/
│   ├── agents/
│   │   ├── task-worker.md                 # Worker agent persona (checkpoint discipline)
│   │   ├── task-reviewer.md               # Reviewer agent persona (cross-model review)
│   │   └── task-merger.md                 # Merge agent persona (conflict resolution)
│   ├── task-runner.yaml                   # Task runner config (project name, test commands, task areas)
│   ├── task-orchestrator.yaml             # Orchestrator config (lanes, merge, failure handling)
│   └── taskplane.json                     # Version tracker (managed by CLI)
├── docs/
│   └── tasks/
│       ├── CONTEXT.md                     # Task area context (next task ID, tech debt)
│       └── EXAMPLE-001-hello-world/       # Example task (skippable with --no-examples)
│           ├── PROMPT.md
│           └── STATUS.md
└── (existing project files untouched)
```

**Complete file map after both steps (global install):**

```
GLOBAL (shared across all projects)
════════════════════════════════════
~/.pi/agent/settings.json                  ← "npm:taskplane" in packages[]
<npm-global>/taskplane/extensions/*.ts     ← auto-loaded: /task, /orch commands
<npm-global>/taskplane/skills/*/SKILL.md   ← auto-loaded: create-taskplane-task
<npm-global>/taskplane/dashboard/          ← web dashboard (launched by CLI)

PROJECT-LOCAL (per-project, committed to git)
══════════════════════════════════════════════
.pi/agents/task-worker.md                  ← worker persona
.pi/agents/task-reviewer.md                ← reviewer persona
.pi/agents/task-merger.md                  ← merger persona
.pi/task-runner.yaml                       ← task areas, test commands, models
.pi/task-orchestrator.yaml                 ← lanes, merge strategy, failure policy
.pi/taskplane.json                         ← version tracker
taskplane-tasks/CONTEXT.md                      ← task area context
taskplane-tasks/EXAMPLE-001-hello-world/        ← example task
```

---

### 4.2 Scenario B: Project-Local Install

Taskplane only loads in **this specific project**. Other projects are unaffected.

#### Step 1: Install the package (project scope)

```bash
cd ~/my-project
pi install -l npm:taskplane
```

**What pi does:**
- Installs taskplane into `.pi/npm/node_modules/taskplane/`
- Adds `"npm:taskplane"` to `.pi/settings.json` → `packages[]`
- Discovers resources via the `pi` manifest
- Teammates who clone the repo get auto-install on `pi` startup (pi reads `.pi/settings.json`)

**Files created by `pi install -l`:**

```
~/my-project/
├── .pi/
│   ├── settings.json                      # ← "npm:taskplane" added to packages[]
│   └── npm/
│       └── node_modules/
│           └── taskplane/                 # Full package installed here
│               ├── bin/taskplane.mjs      # CLI (run via npx or .pi/npm/node_modules/.bin/taskplane)
│               ├── dashboard/             # ← web dashboard (NOT auto-loaded by pi)
│               │   ├── server.cjs
│               │   └── public/
│               ├── extensions/            # ← pi auto-loads ONLY in this project
│               │   ├── task-runner.ts
│               │   ├── task-orchestrator.ts
│               │   └── taskplane/...
│               ├── skills/                # ← pi auto-loads ONLY in this project
│               │   └── create-taskplane-task/
│               ├── templates/...          # NOT auto-loaded
│               └── package.json
└── (existing project files)
```

#### Step 2: Scaffold project config

```bash
npx taskplane init
# or: .pi/npm/node_modules/.bin/taskplane init
```

**Files created by `taskplane init`:** (identical to global scenario)

```
~/my-project/
├── .pi/
│   ├── agents/
│   │   ├── task-worker.md
│   │   ├── task-reviewer.md
│   │   └── task-merger.md
│   ├── task-runner.yaml
│   ├── task-orchestrator.yaml
│   └── taskplane.json
├── docs/
│   └── tasks/
│       ├── CONTEXT.md
│       └── EXAMPLE-001-hello-world/
│           ├── PROMPT.md
│           └── STATUS.md
└── (existing project files untouched)
```

**Complete file map after both steps (project-local install):**

```
PROJECT-LOCAL ONLY (nothing touches global state)
══════════════════════════════════════════════════
.pi/settings.json                          ← "npm:taskplane" in packages[] (shared with team via git)
.pi/npm/node_modules/taskplane/            ← full package (gitignored by pi)
  dashboard/                               ← web dashboard (launched by CLI)
  extensions/*.ts                          ← auto-loaded in this project only
  skills/*/SKILL.md                        ← auto-loaded in this project only
  templates/...                            ← used by CLI only
.pi/agents/task-worker.md                  ← worker persona
.pi/agents/task-reviewer.md                ← reviewer persona
.pi/agents/task-merger.md                  ← merger persona
.pi/task-runner.yaml                       ← task areas, test commands, models
.pi/task-orchestrator.yaml                 ← lanes, merge strategy, failure policy
.pi/taskplane.json                         ← version tracker
taskplane-tasks/CONTEXT.md                      ← task area context
taskplane-tasks/EXAMPLE-001-hello-world/        ← example task
```

---

### 4.3 Scenario Comparison

| Aspect | Global | Project-Local |
|---|---|---|
| **Install command** | `pi install npm:taskplane` | `pi install -l npm:taskplane` |
| **Settings file** | `~/.pi/agent/settings.json` | `.pi/settings.json` |
| **Package location** | `<npm-global>/taskplane/` | `.pi/npm/node_modules/taskplane/` |
| **Extensions load in** | Every pi session | Only this project |
| **Skills available in** | Every pi session | Only this project |
| **Teammates get it** | No — each installs globally | Yes — `.pi/settings.json` in git, pi auto-installs |
| **CLI available as** | `taskplane` (on PATH) | `npx taskplane` or `.pi/npm/node_modules/.bin/taskplane` |
| **Upgrade** | `pi update` (global) | `pi update` (project) |
| **Command namespace** | All projects get `/task`, `/orch`, etc. | Only this project |

### 4.4 Filtering (Hybrid Approach)

Users who install globally but want to suppress commands in non-taskplane projects can use pi's package filtering in the project's `.pi/settings.json`:

```json
{
  "packages": [
    {
      "source": "npm:taskplane",
      "extensions": [],
      "skills": []
    }
  ]
}
```

This overrides the global install for that project, loading nothing.

---

## 5. CLI Commands

The `taskplane` CLI handles what the pi package system cannot: project-local scaffolding, config management, and project health checks.

### 5.1 `taskplane init`

Scaffolds Taskplane project config into the current directory.

```
taskplane init [options]

Options:
  --preset <name>     Use a preset configuration (see §5.1.3)
  --no-examples       Skip example task scaffolding
  --force             Overwrite existing files without prompting
  --dry-run           Show what would be created without writing files
```

#### 5.1.1 What `init` Does

1. **Check prerequisites**
   - Verify pi is installed (`which pi`)
   - Verify taskplane package is installed (check global npm or `.pi/npm/`)
   - If not installed, offer: `pi install -l npm:taskplane` (project) or `pi install npm:taskplane` (global)

2. **Detect project context**
   - Check for existing `.pi/` directory and config files
   - Detect project type heuristics (package.json → Node, go.mod → Go, etc.)
   - Read existing `.pi/settings.json` if present

3. **Interactive prompts** (skipped with `--preset`)
   - Project name and description
   - Primary language / stack (used to pre-populate test commands)
   - Tasks root directory (default: `taskplane-tasks`)
   - Default area name (default: `general`)
   - Default task ID prefix (default: `TP`)
   - Integration branch name (default: `main`)
   - Max parallel lanes (default: 3)
   - Worker model (default: inherit from pi session)
   - Reviewer model (default: `openai/gpt-5.3-codex`)

4. **Scaffold files** (see §5.1.2)

5. **Report next steps**
   ```
   ✅ Taskplane initialized!

   Created:
     .pi/agents/task-worker.md
     .pi/agents/task-reviewer.md
     .pi/agents/task-merger.md
     .pi/task-runner.yaml
     .pi/task-orchestrator.yaml
     .pi/taskplane.json
     taskplane-tasks/CONTEXT.md
     taskplane-tasks/EXAMPLE-001-hello-world/

   Quick start:
     pi                                          # start pi (taskplane auto-loads)
     /task taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md   # run the example task
     /orch all                                    # orchestrate all pending tasks
   ```

#### 5.1.2 Scaffold File Map

| Source (in npm package `templates/`) | Destination (in user's project) | Behavior |
|---|---|---|
| `agents/task-worker.md` | `.pi/agents/task-worker.md` | Copy. Skip if exists (unless `--force`). |
| `agents/task-reviewer.md` | `.pi/agents/task-reviewer.md` | Copy. Skip if exists. |
| `agents/task-merger.md` | `.pi/agents/task-merger.md` | Copy. Skip if exists. |
| `config/task-runner.yaml` | `.pi/task-runner.yaml` | **Generated.** Interpolate project name, test commands, task areas. Skip if exists. |
| `config/task-orchestrator.yaml` | `.pi/task-orchestrator.yaml` | **Generated.** Interpolate integration branch, lane count, prefix. Skip if exists. |
| (generated) | `.pi/taskplane.json` | Create version tracker. Overwrite always. |
| `tasks/CONTEXT.md` | `{{tasks_root}}/CONTEXT.md` | **Template.** Interpolate area name, prefix. Creates the tasks root directory. Skip if exists. |
| `tasks/example/` | `{{tasks_root}}/EXAMPLE-001-hello-world/` | Copy tree. Skip with `--no-examples`. |

#### 5.1.3 Presets

Presets skip interactive prompts and apply opinionated defaults:

| Preset | Description |
|---|---|
| `minimal` | Agents + config only. No examples. |
| `full` | Everything including example tasks. |
| `runner-only` | Task runner config only — no orchestrator YAML. |

```bash
taskplane init --preset full
```

#### 5.1.4 Skip / Conflict Behavior

- **File exists and content is identical** → Skip silently
- **File exists and content differs** → Prompt user: `(s)kip / (o)verwrite / (d)iff / (a)ll`
- **`--force`** → Overwrite all without prompting
- **`--dry-run`** → Print file list, don't write anything

#### 5.1.5 Default Task Area & How It Grows

`taskplane init` creates a single task area as the starting point. The
`create-taskplane-task` skill reads `task_areas` from `task-runner.yaml` and
intelligently selects which area to place a task in — reading each area's
CONTEXT.md to understand its scope.

**Day 1 — single area (right after `taskplane init`):**

```yaml
# .pi/task-runner.yaml
task_areas:
  general:
    path: "taskplane-tasks"
    prefix: "TP"
    context: "taskplane-tasks/CONTEXT.md"
```

```
taskplane-tasks/
├── CONTEXT.md                          # Next Task ID: TP-001
└── EXAMPLE-001-hello-world/
```

**Week 2 — user adds domain areas as the project grows:**

```yaml
task_areas:
  general:
    path: "taskplane-tasks"
    prefix: "TP"
    context: "taskplane-tasks/CONTEXT.md"
  auth:
    path: "taskplane-tasks/auth/tasks"
    prefix: "AUTH"
    context: "taskplane-tasks/auth/CONTEXT.md"
  billing:
    path: "taskplane-tasks/billing/tasks"
    prefix: "BIL"
    context: "taskplane-tasks/billing/CONTEXT.md"
```

```
taskplane-tasks/
├── CONTEXT.md                          # General / cross-cutting tasks
├── auth/
│   ├── CONTEXT.md                      # Auth domain context
│   └── tasks/
│       ├── AUTH-001-login-flow/
│       └── AUTH-002-rbac/
├── billing/
│   ├── CONTEXT.md                      # Billing domain context
│   └── tasks/
│       └── BIL-001-stripe-integration/
├── TP-001-initial-setup/
└── TP-002-ci-pipeline/
```

**Month 2 — mature project with domains and platform areas:**

```yaml
task_areas:
  # Domains
  auth:
    path: "taskplane-tasks/domains/auth/tasks"
    prefix: "AUTH"
    context: "taskplane-tasks/domains/auth/CONTEXT.md"
  billing:
    path: "taskplane-tasks/domains/billing/tasks"
    prefix: "BIL"
    context: "taskplane-tasks/domains/billing/CONTEXT.md"
  # Platform
  infrastructure:
    path: "taskplane-tasks/platform/infrastructure/tasks"
    prefix: "INF"
    context: "taskplane-tasks/platform/infrastructure/CONTEXT.md"
  observability:
    path: "taskplane-tasks/platform/observability/tasks"
    prefix: "OBS"
    context: "taskplane-tasks/platform/observability/CONTEXT.md"
```

Users create new areas by: (1) creating the directory + CONTEXT.md, (2) adding
the entry to `task_areas` in `task-runner.yaml`. The `create-taskplane-task`
skill discovers the new area on the next task creation — no skill changes needed.

---

### 5.2 `taskplane upgrade`

Upgrades Taskplane-managed project files to the latest version while preserving user customizations. This is separate from `pi update` which upgrades the package (extensions/skills).

```
taskplane upgrade [options]

Options:
  --check             Show what would change without applying
  --agents            Upgrade agent prompts only
  --config            Upgrade config templates (adds new fields, preserves existing values)
  --all               Upgrade everything
  --force             Overwrite without prompting
```

#### 5.2.1 Upgrade Strategy

Project files are divided into two categories:

| Category | Files | Upgrade behavior |
|---|---|---|
| **Managed** | Agent prompts (`.pi/agents/*.md`) | Replace with latest version. Not intended for user editing. |
| **Owned** | `task-runner.yaml`, `task-orchestrator.yaml` | **Merge.** Add new fields with defaults, preserve existing values. |

For **owned** files, the upgrade uses a three-way diff:
1. Read the user's current file
2. Read the template from the currently-installed package version
3. Read the template from the new package version
4. Add new keys from (3) that don't exist in (1), using default values
5. Warn about deprecated keys in (1) that were removed in (3)

#### 5.2.2 Full Upgrade Flow

```bash
# Step 1: Upgrade the package (extensions, skills)
pi update

# Step 2: Upgrade project config (agents, YAML configs)
taskplane upgrade --check      # Preview what changes
taskplane upgrade --all        # Apply changes
```

#### 5.2.3 Version Tracking

`taskplane init` writes a version marker to `.pi/taskplane.json`:

```json
{
  "version": "0.1.0",
  "installedAt": "2026-03-11T21:43:00Z",
  "lastUpgraded": "2026-03-11T21:43:00Z",
  "components": {
    "agents": "0.1.0",
    "config": "0.1.0"
  }
}
```

---

### 5.3 `taskplane create`

Creates a new task from the command line (wraps the create-taskplane-task skill).

```
taskplane create [options]

Options:
  --area <name>       Task area (from task-runner.yaml task_areas)
  --name <slug>       Task slug (e.g., "accrual-engine")
  --title <title>     Human-readable task title
  --size <S|M|L>      Task size estimate
  --review <0-3>      Review level
  --deps <ids>        Comma-separated dependency task IDs
  --interactive       Full interactive creation wizard (default if no options)
  --from <file>       Create from a description file (markdown)
```

#### 5.3.1 Interactive Mode

When run with no options (or `--interactive`), prompts for:
1. Task area (select from configured areas)
2. Task title
3. Task slug (auto-generated from title, editable)
4. Size (S/M/L)
5. Review level (with scoring guide)
6. Dependencies (select from existing tasks)
7. Mission description (opens $EDITOR for multi-line input)
8. Steps (repeating prompt: add step → add step → done)

Creates `PROMPT.md` and `STATUS.md` using the prompt template, increments CONTEXT.md counter.

#### 5.3.2 From File Mode

```bash
taskplane create --from task-description.md --area time-off --size M
```

Reads a free-form markdown description and generates a structured PROMPT.md + STATUS.md from it.

---

### 5.4 `taskplane status`

Shows the current state of tasks across all areas.

```
taskplane status [options]

Options:
  --area <name>       Filter to a specific area
  --active            Show only active (non-archived) tasks
  --done              Show only completed tasks
  --json              Output as JSON
  --watch             Refresh every 5 seconds
```

Output:

```
Taskplane Status — Example Project
═══════════════════════════════════════

Active Tasks (6)
  time-off/
    TO-014  Accrual Engine          M  ██████░░░░  Step 3/5  🟢 Running
    TO-015  Carry-Over Rules        S  ░░░░░░░░░░  Step 0/3  ⬜ Ready
  performance-management/
    PM-004  Review Templates        L  ████████░░  Step 4/5  🟡 Review
  task-system/
    TS-017  CLI Distribution        M  ██░░░░░░░░  Step 1/4  🟢 Running
    TS-018  Dashboard Redesign      M  ░░░░░░░░░░  Step 0/3  🔴 Blocked (TS-017)

Completed (14) · Failed (0) · Blocked (1)
```

---

### 5.5 `taskplane doctor`

Validates the Taskplane installation and project configuration.

```
taskplane doctor

Checks:
  ✅ pi installed (v0.4.2)
  ✅ Node.js >= 20.0.0 (v22.3.0)
  ✅ git installed (2.44.0)
  ✅ tmux installed (3.4)        — required for orchestrator spawn_mode: tmux
  ✅ taskplane package installed (v0.1.0, project-local)
  ✅ .pi/task-runner.yaml exists and is valid
  ✅ .pi/task-orchestrator.yaml exists and is valid
  ✅ .pi/agents/task-worker.md exists
  ✅ .pi/agents/task-reviewer.md exists
  ✅ .pi/agents/task-merger.md exists
  ✅ task_areas: 3 areas configured, all paths exist
  ✅ CONTEXT.md found for 3/3 areas
  ❌ task_areas.billing.path "taskplane-tasks/billing/tasks" does not exist
      → Run: mkdir -p taskplane-tasks/billing/tasks
```

---

### 5.6 `taskplane version`

Shows version information for both the package and project config.

```
taskplane version

taskplane v0.1.0
  Package:  npm:taskplane@0.1.0 (project-local: .pi/npm/node_modules/taskplane/)
  Config:   .pi/taskplane.json (v0.1.0, initialized 2026-03-11)
  Pi:       v0.57.1
  Node:     v22.3.0
```

---

### 5.7 `taskplane dashboard`

Launches the web-based orchestrator dashboard. The dashboard is a zero-dependency Node HTTP server that reads `batch-state.json` and STATUS.md files, streaming live updates to the browser via Server-Sent Events (SSE).

```
taskplane dashboard [options]

Options:
  --port <number>     Port to listen on (default: 8099)
  --no-open           Don't auto-open browser
  --root <path>       Project root directory (default: current directory)
```

#### 5.7.1 How It Works

The dashboard server:
1. Locates `dashboard/server.cjs` inside the installed taskplane package
2. Spawns it with `--root` pointing to the current project directory
3. Serves the static frontend at `http://localhost:<port>`
4. Streams batch state via SSE (`/api/stream`) — polls `batch-state.json` + STATUS.md files
5. Auto-opens the browser (unless `--no-open`)

The server reads:
- `.pi/batch-state.json` — orchestrator batch state (tasks, lanes, waves, merge results)
- `STATUS.md` files in task folders and worktrees — per-task progress
- `.pi/lane-state-*.json` — per-lane sidecar state from task-runner
- `.pi/batch-history.json` — completed batch summaries

#### 5.7.2 Dashboard Features

- **Live batch monitoring** — wave progress, lane assignments, task status with progress bars
- **Task drill-down** — STATUS.md parsing shows current step, iteration count, checkbox progress
- **Tmux pane capture** — live terminal output from worker sessions (when `spawn_mode: tmux`)
- **Worker conversation viewer** — JSONL conversation logs from worker agents
- **Batch history** — browse completed batches with per-task timing and token usage
- **SSE streaming** — no polling from the browser; server pushes state changes

#### 5.7.3 Launch Methods

The dashboard is accessible two ways:

| Method | When to use |
|---|---|
| `taskplane dashboard` | From any terminal — primary launch method |
| `node <pkg>/dashboard/server.cjs --root .` | Direct invocation — development or CI |

#### 5.7.4 `--root` Resolution ✅ IMPLEMENTED

`server.cjs` accepts `--root <path>` to locate `.pi/batch-state.json` and task folders:

- `taskplane dashboard` passes `--root $CWD` automatically
- Default when no `--root` is provided: `process.cwd()`

---

## 6. Config Templating

### 6.1 Template Variables

`task-runner.yaml` and `task-orchestrator.yaml` are generated from templates using user-provided values:

| Variable | Source | Default |
|---|---|---|
| `{{project_name}}` | Interactive prompt or `--preset` | Directory name |
| `{{project_description}}` | Interactive prompt | `""` |
| `{{max_lanes}}` | Interactive prompt | `3` |
| `{{worktree_prefix}}` | Derived from project name | Slugified project name |
| `{{worker_model}}` | Interactive prompt | `""` (inherit) |
| `{{reviewer_model}}` | Interactive prompt | `openai/gpt-5.3-codex` |
| `{{test_unit}}` | Stack detection | `npm test` / `go test ./...` / etc. |
| `{{test_build}}` | Stack detection | `npm run build` / `go build ./...` / etc. |
| `{{tasks_root}}` | Interactive prompt | `taskplane-tasks` |
| `{{default_area}}` | Interactive prompt | `general` |
| `{{default_prefix}}` | Interactive prompt | `TP` |

### 6.2 Stack Detection Heuristics

| File detected | Stack | Test command default | Build command default |
|---|---|---|---|
| `package.json` | Node.js | `npm test` | `npm run build` |
| `go.mod` | Go | `go test ./...` | `go build ./...` |
| `Cargo.toml` | Rust | `cargo test` | `cargo build` |
| `pyproject.toml` | Python | `pytest` | — |
| `pom.xml` | Java/Maven | `mvn test` | `mvn package` |
| `build.gradle` | Java/Gradle | `gradle test` | `gradle build` |
| None | Unknown | `echo "TODO: configure test command"` | `echo "TODO: configure build command"` |

---

## 7. File Ownership Model

Clear ownership prevents upgrade conflicts:

| File | Owner | Can user edit? | Upgraded by |
|---|---|---|---|
| Extensions (`.ts`) | Taskplane | ❌ No (in package) | `pi update` |
| Skills (`SKILL.md`) | Taskplane | ❌ No (in package) | `pi update` |
| Dashboard (`dashboard/`) | Taskplane | ❌ No (in package) | `pi update` |
| `.pi/agents/*.md` | Taskplane | Not recommended | `taskplane upgrade --agents` |
| `.pi/task-runner.yaml` | User | ✅ Yes | `taskplane upgrade --config` (merge) |
| `.pi/task-orchestrator.yaml` | User | ✅ Yes | `taskplane upgrade --config` (merge) |
| `.pi/taskplane.json` | Taskplane | ❌ No | Auto-managed |
| `.pi/settings.json` | User / Pi | ✅ Yes | Not touched by taskplane |
| `taskplane-tasks/**` | User | ✅ Yes | Never touched |
| `PROMPT.md` / `STATUS.md` | User | ✅ Yes | Never touched |

---

## 8. Implementation Plan

### Phase 1: Package + Init + Dashboard (MVP) ✅ IMPLEMENTED

- [x] Restructure repo into pi package layout (`extensions/`, `skills/`, `templates/`, `dashboard/`)
- [x] Create `package.json` with `pi` manifest, `bin` entry, and `files` whitelist
- [x] Refactor `server.cjs` — replace hardcoded `REPO_ROOT` with `--root` CLI arg (default: `process.cwd()`)
- [x] Move `taskplane-dashboard/` to `dashboard/` in package layout
- [x] Move `create-taskplane-task` skill to `skills/` (tracked, ships in npm)
- [x] `taskplane init` — interactive scaffolding with template interpolation
- [x] `taskplane init --preset minimal|full|runner-only`
- [x] `taskplane init --dry-run`
- [x] `taskplane dashboard` — locate `dashboard/server.cjs` in package, spawn with `--root $CWD`
- [x] Stack detection heuristics
- [x] Version marker file (`.pi/taskplane.json`)
- [x] `taskplane doctor` — installation and config validation
- [x] `taskplane version` — version info
- [ ] README with install instructions for both scenarios
- [ ] Publish to npm as `taskplane`
- [ ] Test: `pi install npm:taskplane` → `taskplane init` → `pi` → `/task` works
- [ ] Test: `taskplane dashboard` opens browser with live batch monitoring

### Phase 2: Status + Create

- [ ] `taskplane status` — task status overview
- [ ] `taskplane status --watch` — live refresh
- [ ] `taskplane status --json` — machine-readable output
- [ ] `taskplane create --interactive` — task creation wizard
- [ ] `taskplane create --from <file>` — file-based creation

### Phase 3: Upgrade

- [ ] `taskplane upgrade --check` — dry-run upgrade
- [ ] `taskplane upgrade --all` — full upgrade with merge
- [ ] Three-way config merge for owned files
- [ ] Deprecation warnings for removed config keys

### Phase 4: Polish

- [ ] `taskplane init` — auto-detect existing pi config and offer migration
- [ ] Shell completions (bash, zsh, fish)
- [ ] `taskplane help <command>` — per-command help
- [ ] CI/CD: automated npm publish on GitHub release
- [ ] Gallery metadata (video/image for pi package gallery — dashboard demo video)

---

## 9. Open Questions

| # | Question | Options | Leaning |
|---|---|---|---|
| 1 | **Recommended install scope?** | Global vs project-local as default guidance | Project-local — less pollution, team-friendly via `.pi/settings.json` in git |
| 2 | **Config format: YAML or JSON?** | YAML (current) vs JSON (easier to parse) | YAML — already established, human-friendly, comments supported |
| 3 | **Should skills ship in the package or be scaffolded?** | In-package (auto-discovered) vs copied to `.agents/skills/` | In-package — auto-discovered, no copy needed, upgraded via `pi update` |
| 4 | **Task area setup: interactive vs manual?** | Wizard creates dirs + CONTEXT.md vs user does it | Interactive for first area, manual for rest (show template) |
| 5 | **How to handle pi version compatibility?** | `peerDependencies` vs runtime check | Both — peerDep for npm warning + runtime check in `taskplane doctor` |
| 6 | **Monorepo support?** | Single taskplane.json at root vs per-workspace | Single root config — orchestrator already handles multiple task areas |
| 7 | **Should `taskplane init` auto-run `pi install -l`?** | Auto-install if not found vs require manual install first | Auto-install with confirmation prompt |
| 8 | **What to .gitignore?** | `.pi/npm/` is auto-gitignored by pi? Need to verify | Verify pi behavior; document explicitly |

---

## 10. Dependencies

### Runtime (CLI only)

| Dependency | Purpose | Notes |
|---|---|---|
| `yaml` | Parse/serialize YAML config | Already used by task-runner extension |

> **Note:** The CLI uses Node built-in `readline` for prompts and ANSI escape codes for colors — no external dependencies needed beyond `yaml`.

### Peer (Extensions)

| Dependency | Range | Purpose |
|---|---|---|
| `@mariozechner/pi-coding-agent` | `*` | Pi extension runtime |
| `@mariozechner/pi-tui` | `*` | TUI components for widgets |
| `@mariozechner/pi-ai` | `*` | AI utilities (StringEnum) |
| `@sinclair/typebox` | `*` | Schema definitions for tool parameters |

### Dev

| Dependency | Purpose |
|---|---|
| `vitest` | Testing (already used in extensions) |

---

## 11. Example Workflows

### New Project (Project-Local)

```bash
mkdir my-project && cd my-project
git init

# Install taskplane as a pi package (project-local)
pi install -l npm:taskplane

# Scaffold project config
npx taskplane init
# Answer prompts...

# Start pi — taskplane extensions auto-load
pi
# Inside pi:
/task taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md
```

### New Project (Global)

```bash
# One-time global setup
pi install npm:taskplane

# Any project, any time
cd my-project
taskplane init --preset full

# Open the web dashboard to monitor batch execution
taskplane dashboard

# In another terminal, start pi and kick off orchestration
pi
/orch all
```

### Existing Project Adoption

```bash
cd existing-project
pi install -l npm:taskplane

npx taskplane init --preset full
npx taskplane doctor
# Fix any issues...

pi
/task path/to/my-task/PROMPT.md
```

### Team Onboarding

```bash
# .pi/settings.json is committed to git with "npm:taskplane" in packages[]
git clone https://github.com/team/project.git
cd project

# Pi auto-installs taskplane on first run
pi
# Taskplane commands immediately available
/task taskplane-tasks/FEAT-001-new-feature/PROMPT.md
```

### Upgrade

```bash
# Upgrade extensions, skills
pi update

# Upgrade project config (agents, YAML)
npx taskplane upgrade --check    # Preview changes
npx taskplane upgrade --all      # Apply
```

### Monitoring a Batch with the Dashboard

```bash
# Terminal 1: Start the web dashboard
taskplane dashboard                    # opens http://localhost:8099

# Terminal 2: Start pi and launch orchestration
pi
/orch all                              # dashboard updates live via SSE

# OR: In a separate terminal alongside an active pi session
taskplane dashboard                    # monitors the same batch
```
