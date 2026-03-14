# STATUS.md Reference

`STATUS.md` is Taskplane's execution-memory file for a task.

It tracks current step state, checkbox progress, review counters, and execution logs.

---

## Canonical location

```text
<task-folder>/STATUS.md
```

Typically alongside:

- `PROMPT.md`
- `.reviews/`
- `.DONE`

---

## Core header fields

Common fields at top of file:

| Field | Meaning |
|---|---|
| `Current Step` | Human-readable current step status |
| `Status` | Overall task status (Ready, In Progress, Complete, etc.) |
| `Last Updated` | Last update date |
| `Review Level` | Task review level from prompt |
| `Review Counter` | Number of reviews run so far |
| `Iteration` | Worker iteration counter |
| `Size` | Task size metadata |

Example:

```md
**Current Step:** Step 1: Implement API
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-14
**Review Level:** 2
**Review Counter:** 1
**Iteration:** 4
**Size:** M
```

---

## Step sections

Each step should mirror `PROMPT.md` step numbering/title:

```md
### Step 1: Implement API
**Status:** 🟨 In Progress

- [x] Add route
- [ ] Add validation
```

### Step status mapping (parsed behavior)

Task-runner interprets step status from `**Status:**` text:

- contains `✅` or "complete" → complete
- contains `🟨` or "progress" → in-progress
- otherwise defaults to not-started

Checkboxes are parsed from markdown checkbox syntax only.

---

## Table sections

Task-runner appends rows to table sections such as:

- `## Reviews`
- `## Discoveries`
- `## Execution Log`

Example execution row:

```md
| 2026-03-14 22:12 | Step 1 complete | Implement API |
```

---

## Generation behavior

If `STATUS.md` is missing when `/task` starts, task-runner auto-generates it from `PROMPT.md` steps.

Generated file includes:

- header metadata
- step sections with unchecked checkboxes
- reviews/discoveries/execution/blockers/notes scaffolding

---

## `.DONE` relationship

`STATUS.md` tracks progress, but completion is finalized by `.DONE` creation in task folder.

Orchestrator and runner use `.DONE` as the authoritative completion marker.

---

## Editing guidelines

- Keep step numbers aligned with `PROMPT.md`
- Use one checkbox per meaningful unit of work
- Preserve section headers and table structure
- Do not remove execution/review history rows

---

## Related

- [Task Format Reference](task-format.md)
- [Commands Reference](commands.md)
