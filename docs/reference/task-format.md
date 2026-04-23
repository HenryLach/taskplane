# Task Format Reference (`PROMPT.md` + `STATUS.md`)

Taskplane tasks are file-based packets.

Canonical folder:

```text
<task-folder>/
├── PROMPT.md    # task definition
├── STATUS.md    # execution state / memory
├── .reviews/    # reviewer outputs (created by runner)
└── .DONE        # completion marker
```

---

## `PROMPT.md` format

### Recommended top-level structure

```md
# Task: <ID> — <Name>

**Created:** YYYY-MM-DD
**Size:** S|M|L

## Review Level: 0|1|2|3

## Mission
...

## Dependencies
- **None**
# or dependency list

## Context to Read First
- `path/to/doc.md`

## File Scope
- `src/file.ts`

## Steps
### Step 0: Name
- [ ] checklist item
- [ ] checklist item

### Step 1: Name
- [ ] ...

## Completion Criteria
- [ ] ...

---

## Amendments (Added During Execution)
```

---

## Required vs optional data

### Required (practical)

- A parseable task ID (prefer heading format)
- At least one step in `### Step N: ...` format
- Checkbox items (`- [ ]`) inside steps

### Optional but strongly recommended

- `## Review Level: N`
- `**Size:** S|M|L`
- `## Dependencies`
- `## Context to Read First`
- `## File Scope`
- `## Execution Target` (`Repo:` / `Repos:` for repo targeting)
- `## Segment DAG` (optional, for explicit multi-repo segment ordering)
- `## Completion Criteria`

If omitted, parsers apply defaults in some paths (for example size/review defaults).

---

## Heading and ID conventions

Preferred heading:

```md
# Task: AUTH-014 — Add role checks
```

Notes:

- Orchestrator parser prefers `# Task: <ID> - <Name>` style and falls back to folder name ID extraction.
- Task-runner parser is more permissive and can also parse `# <ID> - <Name>`.
- For consistent behavior across `/task` and `/orch`, always use `# Task: <ID> — <Name>`.

Folder name convention:

```text
AUTH-014-add-role-checks
```

---

## Step/checklist expectations

Steps must use:

```md
### Step <number>: <name>
```

Checklist items must use markdown checkbox syntax:

```md
- [ ] Do thing
- [x] Done thing
```

Task-runner executes by scanning for the first unchecked checkbox in current scope.

### Segment markers (multi-repo tasks)

When a task spans multiple repos, use level-4 headings within each step to
assign checkboxes to specific repos:

```md
### Step 1: Create utilities and API client

#### Segment: shared-libs

- [ ] Create string utility module
- [ ] Export from package index

#### Segment: web-client

- [ ] Add API client wrapper
- [ ] Wire into app initialization
```

Rules:

- Marker format: `#### Segment: <repoId>` (case-sensitive, must match workspace config)
- Single-repo tasks do not need segment markers (the engine applies a default)
- Every step in a multi-repo task should have explicit segment markers
- The final documentation/delivery step uses the packet repo (the repo containing PROMPT.md)

---

## Dependency notation

Use `## Dependencies` section.

Accepted forms include:

### None

```md
## Dependencies
- **None**
```

### Unqualified IDs

```md
## Dependencies
- AUTH-003
- BIL-002
```

### Area-qualified IDs

```md
## Dependencies
- auth/AUTH-003
- billing/BIL-002
```

### Requires line

```md
## Dependencies
**Requires:** AUTH-003
**Requires:** billing/BIL-002
```

Recommendations:

- Use area-qualified IDs in larger multi-area projects.
- Keep dependency IDs canonical (`PREFIX-NNN`).

---

## `Context to Read First` conventions

Example:

```md
## Context to Read First
- `README.md`
- `docs/architecture.md`
```

Use backticked file paths. Keep list minimal and task-relevant.

---

## `File Scope` conventions

Example:

```md
## File Scope
- `extensions/taskplane/engine.ts`
- `.pi/task-orchestrator.yaml`
```

Describe intended modification surface to improve planning/review quality.

Notes:

- In workspace mode, repo-prefixed entries like `api/src/...` or `web-client/src/...` are used for repo inference when `## Execution Target` is omitted.
- When `## Execution Target` is present, every repo-prefixed `## File Scope` entry must belong to one of the declared target repos.

---

## `Execution Target` (repo targeting)

Use `## Execution Target` to declare which repo or repos a task runs against.

Single-repo example:

```md
## Execution Target
Repo: api
```

Multi-repo example:

```md
## Execution Target
Repos:
- api
- web-client
```

Inline forms are also accepted:

```md
## Execution Target
**Repo:** api
**Repos:** api, web-client
```

Notes:

- `Repo:` targets one repo.
- `Repos:` targets multiple repos and enables workspace-mode multi-repo routing.
- Repo IDs are normalized to lowercase.
- Repo IDs must exist in the workspace configuration.
- When `## File Scope` uses repo-prefixed paths, those prefixes must agree with `Repo:` or `Repos:`.

## `Segment DAG` (optional explicit multi-repo ordering)

Use `## Segment DAG` only when a task already targets multiple repos and needs explicit intra-task ordering.

```md
## Segment DAG

Repos:
- api
- web-client

Edges:
- api -> web-client
```

Notes:

- Optional section — omission keeps planner-selected ordering.
- `Repos:` and `Edges:` keys may be markdown-decorated (e.g. `**Repos:**`).
- Repo IDs are normalized to lowercase.
- `Repos:` should match the repo set already declared in `## Execution Target`.
- Edge endpoints must appear in `Repos:`.
- Self-edges and cycles are invalid and fail discovery.

---

## `STATUS.md` format (execution memory)

`STATUS.md` tracks runtime progress. It is updated continuously by task-runner.

Typical header fields:

```md
**Current Step:** ...
**Status:** ...
**Last Updated:** ...
**Review Level:** ...
**Review Counter:** ...
**Iteration:** ...
**Size:** ...
```

Per-step sections mirror `PROMPT.md` steps and track checkbox completion.

Task-runner can auto-generate `STATUS.md` from `PROMPT.md` if missing.

---

## Divider rule (`---`)

Use a divider before amendments:

```md
---

## Amendments (Added During Execution)
```

Treat content above divider as canonical task definition.

---

## Minimal valid example

```md
# Task: TP-001 — Add greeting endpoint

**Created:** 2026-03-14
**Size:** S

## Review Level: 1

## Mission
Add a small HTTP endpoint that returns a greeting.

## Dependencies
- **None**

## Steps
### Step 0: Implement
- [ ] Add endpoint handler
- [ ] Register route

### Step 1: Verify
- [ ] Run unit tests

## Completion Criteria
- [ ] Endpoint responds with 200 and expected payload

---

## Amendments (Added During Execution)
```

---

## Related

- [Commands Reference](commands.md)
- [Status Format](status-format.md)
