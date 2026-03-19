# Taskplane Command Cheat Sheet

## CLI (terminal)

### Core
- `taskplane init`
- `taskplane doctor`
- `taskplane version` (aliases: `taskplane --version`, `taskplane -v`)
- `taskplane dashboard`
- `taskplane help` (aliases: `taskplane --help`, `taskplane -h`)

### `taskplane init` switches
- `--preset <minimal|full|runner-only>`
- `--no-examples`
- `--force`
- `--dry-run`

### `taskplane dashboard` switches
- `--port <number>` (default: `8099`)
- `--no-open`

---

## Pi slash commands (inside `pi`)

### Task Runner
- `/task <path/to/PROMPT.md>`
- `/task-status`
- `/task-pause`
- `/task-resume`

### Orchestrator
- `/orch <areas|paths|all>`
- `/orch-plan <areas|paths|all> [--refresh]`
- `/orch-status`
- `/orch-pause`
- `/orch-resume`
- `/orch-abort [--hard]`
- `/orch-deps <areas|paths|all> [--refresh] [--task <ID>]`
- `/orch-sessions`

---

## Slash-command switches

- `--refresh` → `/orch-plan`, `/orch-deps`
- `--task <ID>` → `/orch-deps` (e.g. `TO-014`)
- `--hard` → `/orch-abort`

---

## Quick examples

### CLI
- `taskplane init --preset full`
- `taskplane init --dry-run`
- `taskplane dashboard --port 3000 --no-open`

### In `pi`
- `/task taskplane-tasks/EXAMPLE-001-hello-world/PROMPT.md`
- `/orch-plan all --refresh`
- `/orch all`
- `/orch-deps all --task TO-014 --refresh`
- `/orch-abort --hard`
