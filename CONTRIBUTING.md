# Contributing to Taskplane

Thanks for your interest in contributing! This guide covers how to set up a local development environment, run tests, and submit changes.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Development Setup](#development-setup)
- [Running Tests](#running-tests)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Branch Strategy](#branch-strategy)
- [Pull Request Process](#pull-request-process)
- [Issue Tracking and Triage](#issue-tracking-and-triage)
- [Style Guide](#style-guide)
- [Where to Find Things](#where-to-find-things)

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this code.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 20.0.0
- [Git](https://git-scm.com/)
- [pi](https://github.com/badlogic/pi-mono) (the AI coding agent Taskplane extends)
- [just](https://github.com/casey/just) (optional — task runner for common commands)

### Clone and Install

```bash
git clone https://github.com/HenryLach/taskplane.git
cd taskplane
```

Install test dependencies:

```bash
cd extensions
npm install
cd ..
```

### Load Extensions Locally

Taskplane's extensions can be loaded directly from the repo using pi's `-e` flag:

```bash
pi -e extensions/task-orchestrator.ts

# Or use just (if installed)
just orch
```

### Verify Setup

Once pi starts with the extensions loaded, you should see the `/orch` commands available. You can confirm with:

```
/orch
```

This should print usage information.

## Running Tests

Tests use Node.js native test runner (`node:test`) and live in `extensions/tests/`.

```bash
cd extensions
node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts
# Run a specific test file:
node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/<name>.test.ts
```

> Historical documents and old task artifacts may still mention Vitest commands.
> Those references are archival only; do not use them for current development.

Test files:

| File | What it tests |
|------|---------------|
| `orch-pure-functions.test.ts` | Wave computation, dependency parsing, formatting |
| `orch-state-persistence.test.ts` | Batch state save/load, schema validation |
| `orch-direct-implementation.test.ts` | Orchestrator integration paths |
| `task-runner-orchestration.test.ts` | Task runner + orchestrator interaction |
| `worktree-lifecycle.test.ts` | Git worktree create/cleanup lifecycle |

Tests use mock implementations of pi APIs (see `tests/mocks/`), so they run without a live pi session.

## Project Structure

```
taskplane/
├── bin/
│   └── taskplane.mjs              # CLI (init, doctor, version, dashboard)
├── dashboard/
│   ├── server.cjs                 # Zero-dep Node HTTP server with SSE
│   └── public/                    # Static frontend (vanilla JS/CSS/HTML)
├── extensions/
│   ├── task-orchestrator.ts       # /orch commands (thin facade)
│   ├── taskplane/                 # Orchestrator internals
│   │   ├── types.ts               # All types, interfaces, constants
│   │   ├── discovery.ts           # Task discovery and PROMPT.md parsing
│   │   ├── engine.ts              # Batch execution engine
│   │   ├── execution.ts           # Lane execution and monitoring
│   │   ├── waves.ts               # Dependency DAG and wave computation
│   │   ├── worktree.ts            # Git worktree management
│   │   ├── merge.ts               # Merge agent coordination
│   │   ├── persistence.ts         # Batch state save/load
│   │   ├── resume.ts              # Batch resume logic
│   │   ├── abort.ts               # Abort and cleanup
│   │   ├── sessions.ts            # TMUX session management
│   │   ├── formatting.ts          # TUI display formatting
│   │   ├── messages.ts            # User-facing message strings
│   │   ├── config.ts              # Config loading and defaults
│   │   ├── extension.ts           # Pi extension registration
│   │   ├── git.ts                 # Git helpers
│   │   └── index.ts               # Re-exports
│   └── tests/                     # Test suite
├── skills/
│   └── create-taskplane-task/     # Task creation skill
├── templates/                     # Scaffolding templates (used by CLI)
│   ├── agents/                    # Worker, reviewer, merger prompts
│   ├── config/                    # YAML config templates
│   └── tasks/                     # CONTEXT.md and example task
├── docs/                          # Public documentation
├── package.json                   # npm package manifest with pi config
├── justfile                       # Common dev commands
└── LICENSE
```

## Making Changes

### Before You Start

1. Check [existing issues](https://github.com/HenryLach/taskplane/issues) to see if someone is already working on it
2. For non-trivial changes, open an issue first to discuss the approach
3. Fork the repo and create a feature branch from `main`

### Development Workflow

1. Make your changes
2. Run the tests: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
3. Test manually by loading the extensions in pi: `just orch`
4. Commit with clear messages (see conventions below)

### What to Change Where

| I want to... | Look at... |
|---|---|
| Add/modify a pi command | `extensions/taskplane/extension.ts` |
| Change orchestrator behavior | `extensions/taskplane/` (the relevant module) |
| Change the CLI (`taskplane init`, etc.) | `bin/taskplane.mjs` |
| Update the dashboard | `dashboard/server.cjs` and `dashboard/public/` |
| Change agent behavior | `templates/agents/*.md` |
| Update scaffolding templates | `templates/config/` and `templates/tasks/` |
| Add a skill | `skills/` |

## Branch Strategy

- `main` is the only long-lived branch.
- Create short-lived topic branches from `main`:
  - `feat/<topic>`
  - `fix/<topic>`
  - `docs/<topic>`
  - `chore/<topic>`
  - `refactor/<topic>`
  - `test/<topic>`
- Keep each branch scoped to one logical change.

Merge policy:

- Open a PR into `main`
- Prefer squash merge
- Delete merged branch

## Pull Request Process

1. **Keep PRs focused** — one logical change per PR
2. **Link an issue** (or explain why no issue is needed)
3. **Include tests** for new functionality when applicable
4. **Update documentation** if your change affects user-facing behavior
5. **Run all tests** before submitting
6. **Describe what and why** in the PR description

Current protection baseline for `main`:

- PR required before merge
- CI required (`ci`)
- Conversation resolution required
- Required approvals: `0` (solo-maintainer baseline; may increase as maintainership expands)

Contributor note: maintainer-only operating policies (Dependabot merge cadence, release timing, emergency bypass rules) are documented in [docs/maintainers/repository-governance.md](docs/maintainers/repository-governance.md).
### Commit Message Convention

```
type(scope): short description

Longer explanation if needed.
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

Examples:
- `feat(orch): add load-balanced lane assignment strategy`
- `docs: add troubleshooting guide`
- `test(persistence): add schema validation edge cases`

## Issue Tracking and Triage

Taskplane uses GitHub Issues as the canonical backlog.

- Use issue forms:
  - **Bug Report** for reproducible defects
  - **Feature Request** for new capabilities
  - **Documentation Improvement** for docs gaps/staleness
- Search existing issues before creating a new one.
- For non-trivial implementation work, open an issue before coding.
- Questions and usage help should go to GitHub Discussions.

Maintainers triage with labels for type, area, priority, and status.
See [docs/maintainers/repository-governance.md](docs/maintainers/repository-governance.md) for the current governance model and GitHub settings.

## Style Guide

- **TypeScript** for extensions — use typed interfaces, avoid `any`
- **Vanilla JS/CSS/HTML** for the dashboard — no build step, no frameworks
- **YAML** for configuration — preserve comments and structure
- **Markdown** for documentation and agent prompts
- Keep functions focused and testable
- Prefer descriptive names over comments
- Use existing patterns in the codebase as a reference

## Where to Find Things

| Topic | Location |
|-------|----------|
| Docs index | [docs/README.md](docs/README.md) |
| Architecture overview | [docs/explanation/architecture.md](docs/explanation/architecture.md) |
| Execution model | [docs/explanation/execution-model.md](docs/explanation/execution-model.md) |
| Commands reference | [docs/reference/commands.md](docs/reference/commands.md) |
| Configuration reference | [docs/reference/configuration/](docs/reference/configuration/) |

## Questions?

Open an issue or start a discussion. We're happy to help newcomers find their way around the codebase.
