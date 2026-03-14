# Package and Template Model

Taskplane uses a two-layer distribution model:

1. **npm/pi package** for executable logic (extensions, skills, CLI, dashboard)
2. **project templates/config** scaffolded into each repository

This separates upgradeable runtime code from user-owned project settings.

---

## Layer 1: Package (installed)

Installed via:

```bash
pi install npm:taskplane
# or project-local
pi install -l npm:taskplane
```

Package includes:

- `bin/taskplane.mjs`
- `extensions/` (task-runner + orchestrator)
- `skills/`
- `dashboard/`
- `templates/` (used by CLI scaffolding)

pi discovers extensions/skills using the `pi` manifest in `package.json`.

---

## Layer 2: Project files (scaffolded)

Created by:

```bash
taskplane init
```

Scaffolded files include:

- `.pi/task-runner.yaml`
- `.pi/task-orchestrator.yaml`
- `.pi/agents/*.md`
- `taskplane-tasks/CONTEXT.md`
- `taskplane-tasks/EXAMPLE-*/...` example task folders (unless disabled)

These files are edited per project and are part of local workflow semantics.

---

## Ownership model

### Package-owned

- extension code
- skill definitions
- CLI code
- dashboard server/frontend

Upgraded via `pi update` (package lifecycle).

### Project-owned

- YAML config in `.pi/`
- project task files (`PROMPT.md`, `STATUS.md`, `CONTEXT.md`)

Managed by users/maintainers inside their repositories.

---

## Why this split

- **upgradeability**: ship new runtime behavior without overwriting project intent
- **portability**: per-project configs and tasks live with repo
- **clarity**: executable logic and project policy are clearly separated
- **safety**: package updates avoid blindly rewriting user task data

---

## Template purpose

`templates/` provides starting points, not authoritative runtime state.

- `templates/config/` → YAML templates
- `templates/agents/` → worker/reviewer/merger prompts
- `templates/tasks/` → CONTEXT + example task packets

`taskplane init` copies/generates these into project-local paths.

---

## Upgrade path

Typical flow:

1. `pi update` → update package runtime bits
2. (future/optional) project-level upgrade tooling updates scaffolded project files

Always review config/task changes before applying in active projects.

---

## Related

- [Architecture](architecture.md)
- [Maintainer: Package Layout](../maintainers/package-layout.md)
