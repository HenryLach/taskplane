# Taskplane Open-Source Documentation Plan

## Goal

Create a public documentation system for Taskplane that serves two core audiences well:

1. **Users** who want to install and use Taskplane
2. **Contributors / maintainers** who want to understand, improve, and release the project

The documentation should follow open-source best practices, avoid leaking internal planning artifacts, and align with the eventual npm package distribution model.

---

## Recommended Documentation Strategy

Use a combination of:

- **Standard open-source repo files** at the repo root
- **Diátaxis-style documentation structure** under `docs/`
  - Tutorials
  - How-to guides
  - Reference
  - Explanation

This keeps docs usable for both beginners and advanced contributors.

---

## Core Documentation Principles

### 1. Keep the README short, high-value, and honest
The README should answer:
- What is Taskplane?
- Why would I use it?
- What can it do today?
- How do I try it right now?
- Where do I go next?

It should **not** become the full manual.

### 2. Separate beginner docs from detailed reference
A beginner should not have to read YAML schema internals to run a first task.

### 3. Document workflows, not just files
Users care about:
- Running a first task
- Running an orchestration
- Recovering after interruption
- Configuring task areas
- Troubleshooting setup

### 4. Keep public docs timeless
Public docs should explain the system as it exists now, not preserve sprint/task history or internal review artifacts.

### 5. Lead with the npm install path
npm packaging is live and working. Public docs should make **npm install** the primary path, with source install documented as an alternative for contributors.

### 6. Keep examples generic
Public-facing examples and config templates must not contain private or project-specific references.

---

## Audience Breakdown

### Users need docs for:
- Understanding Taskplane quickly
- Installing and trying it
- Running `/task`
- Running `/orch`
- Configuring Taskplane
- Recovering from interruptions
- Troubleshooting

### Contributors / maintainers need docs for:
- Architecture understanding
- Repo structure
- Local development setup
- Running tests
- Change conventions
- Release / npm packaging flow

---

## Current Gaps

The repo currently lacks most essential public-facing docs.

### Missing or underdeveloped:
- `README.md` is too minimal
- No `CONTRIBUTING.md`
- No `CODE_OF_CONDUCT.md`
- No `SECURITY.md`
- No `CHANGELOG.md`
- No docs landing page
- No install guide
- No quickstart
- No commands reference
- No config reference
- No architecture overview
- No troubleshooting docs
- No public release/packaging docs

### Template sanitization status
The config templates previously contained project-specific assumptions. These should be reviewed and sanitized as part of ongoing documentation work.

Files to review:
- `templates/config/task-runner.yaml`
- `templates/config/task-orchestrator.yaml`

Examples of issues to remove if still present:
- `Example Project`
- project-specific standards and docs references
- `taskplane-wt`
- project-specific test/build assumptions

---

## Recommended Public Documentation Structure

```text
/
├── README.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── CHANGELOG.md
├── LICENSE
├── docs/
│   ├── README.md
│   ├── tutorials/
│   │   ├── install.md
│   │   ├── install-from-source.md
│   │   ├── run-your-first-task.md
│   │   ├── run-your-first-orchestration.md
│   │   └── use-the-dashboard.md
│   ├── how-to/
│   │   ├── configure-task-runner.md
│   │   ├── configure-task-orchestrator.md
│   │   ├── define-task-areas.md
│   │   ├── pause-resume-abort-a-batch.md
│   │   ├── recover-after-interruption.md
│   │   ├── use-tmux-for-visibility.md
│   │   └── troubleshoot-common-issues.md
│   ├── reference/
│   │   ├── commands.md
│   │   ├── task-format.md
│   │   ├── status-format.md
│   │   ├── glossary.md
│   │   └── configuration/
│   │       ├── task-runner.yaml.md
│   │       └── task-orchestrator.yaml.md
│   ├── explanation/
│   │   ├── architecture.md
│   │   ├── execution-model.md
│   │   ├── review-loop.md
│   │   ├── waves-lanes-and-worktrees.md
│   │   ├── persistence-and-resume.md
│   │   └── package-and-template-model.md
│   └── maintainers/
│       ├── development-setup.md
│       ├── testing.md
│       ├── release-process.md
│       └── package-layout.md
└── .github/
    ├── ISSUE_TEMPLATE/
    │   ├── bug_report.yml
    │   └── feature_request.yml
    └── pull_request_template.md
```

---

## What Each File Should Do

## Root Files

### `README.md` — P0
Most important public file.

Should contain:
- one-sentence description
- key features
- current status (e.g. experimental/early)
- install options
- 5-minute quickstart
- command overview
- dashboard screenshot/GIF if available
- links into `docs/`
- contribution link

### `CONTRIBUTING.md` — P0
Should include:
- local setup
- how to run tests
- style expectations
- PR expectations
- where architecture docs live
- how to propose changes

### `CODE_OF_CONDUCT.md` — P0
Use Contributor Covenant unless a custom version is needed.

### `SECURITY.md` — P0
Should explain:
- how to report vulnerabilities
- what counts as security-sensitive
- expected response policy

### `CHANGELOG.md` — P1
Recommend Keep a Changelog format.

---

## Docs Landing Page

### `docs/README.md` — P0
A docs entry page with navigation by audience:
- New users
- Operators
- Contributors
- Maintainers

---

## Tutorials (Beginner Path)

These should be linear and friendly.

### `docs/tutorials/install.md` — P0
The primary install path via npm.

Should include:
- prerequisites (Node.js, pi)
- `npm install -g taskplane` (or `pi install npm:taskplane`)
- `taskplane init`
- verify commands appear

### `docs/tutorials/install-from-source.md` — P1
Alternative install path for contributors and local development.

Should include:
- prerequisites
- clone repo
- load extensions
- required `.pi/` setup
- verify commands appear

### `docs/tutorials/run-your-first-task.md` — P0
Should teach:
- PROMPT.md expectations
- STATUS.md lifecycle
- `/task`
- `/task-status`
- `/task-pause`
- `/task-resume`

### `docs/tutorials/run-your-first-orchestration.md` — P0
Should teach:
- task areas
- `/orch-plan`
- `/orch`
- `/orch-status`
- `/orch-pause`
- `/orch-resume`
- `/orch-abort`

### `docs/tutorials/use-the-dashboard.md` — P1
Should teach:
- what the dashboard shows
- when to use it
- how it relates to terminal output

---

## How-To Guides

These should solve concrete user problems.

### P0
- `docs/how-to/configure-task-runner.md`
- `docs/how-to/configure-task-orchestrator.md`
- `docs/how-to/define-task-areas.md`
- `docs/how-to/pause-resume-abort-a-batch.md`
- `docs/how-to/recover-after-interruption.md`

### P1
- `docs/how-to/use-tmux-for-visibility.md`
- `docs/how-to/troubleshoot-common-issues.md`

---

## Reference Docs

These should be exact, exhaustive, and skimmable.

### `docs/reference/commands.md` — P0
Document all commands, arguments, examples, and expected behavior:
- `/task`
- `/task-status`
- `/task-pause`
- `/task-resume`
- `/orch`
- `/orch-plan`
- `/orch-status`
- `/orch-pause`
- `/orch-resume`
- `/orch-abort`
- `/orch-deps`
- `/orch-sessions`

### `docs/reference/configuration/task-runner.yaml.md` — P0
Document every field in the task runner config template.

### `docs/reference/configuration/task-orchestrator.yaml.md` — P0
Document every field in the orchestrator config template.

### `docs/reference/task-format.md` — P0
Define:
- PROMPT.md structure
- dependency notation
- step/checklist expectations

### `docs/reference/status-format.md` — P1
Define STATUS.md semantics.

### `docs/reference/glossary.md` — P1
Terms like:
- worker
- reviewer
- merge agent
- wave
- lane
- worktree
- resume
- reconciliation
- blocked task
- skipped task

---

## Explanation Docs

These explain how the system works and why it is designed this way.

### P0
- `docs/explanation/architecture.md`
- `docs/explanation/execution-model.md`
- `docs/explanation/waves-lanes-and-worktrees.md`
- `docs/explanation/persistence-and-resume.md`

### P1
- `docs/explanation/review-loop.md`
- `docs/explanation/package-and-template-model.md`

---

## Maintainer / Contributor Docs

These can be public and should be.

### P0
- `docs/maintainers/development-setup.md`
- `docs/maintainers/testing.md`

### P1
- `docs/maintainers/release-process.md`
- `docs/maintainers/package-layout.md`

---

## Supporting Community Files

Recommended public repo support files:

### P1
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/pull_request_template.md`

Optional later:
- `SUPPORT.md`
- `GOVERNANCE.md`
- `ROADMAP.md`

---

## Install Path Policy

### npm install is the primary documented path

npm packaging is deployed and working. Public docs should lead with:
- `npm install -g taskplane` (or `pi install npm:taskplane`)
- `taskplane init`

Source install should be documented as a secondary path for contributors and local development.

---

## Recommended Contributor-Facing Treatment of Templates

### Keep public as templates:
- `templates/agents/`
- `templates/config/`

Reason:
- Contributors need to understand how Taskplane’s worker / reviewer / merger behavior is intended to work.
- Contributors also need to understand the configuration model.
- These belong in the future npm package and should remain part of the public system design.

### Keep private / local only:
- live project `.pi/` files
- internal planning docs
- internal review notes
- internal task backlog/history

---

## Suggested Rollout Order

## Phase 1 — P0 essentials
1. Rewrite `README.md` (npm install as primary path)
2. Add `CONTRIBUTING.md`
3. Add `CODE_OF_CONDUCT.md`
4. Add `SECURITY.md`
5. Create `docs/README.md`
6. Create:
   - npm install tutorial
   - first-task tutorial
   - first-orchestration tutorial
   - commands reference
   - both config references
   - task format reference
   - architecture explanation
   - execution model explanation
   - persistence/resume explanation
   - development setup
   - testing

## Phase 2 — P1 polish
1. install-from-source tutorial (contributor path)
2. troubleshooting
3. dashboard guide
4. glossary
5. release process
6. package layout
7. issue/PR templates
8. changelog
9. sanitize templates (review for remaining project-specific content)

---

## Strongest Recommendation

Adopt this as the long-term public docs strategy:

- **GitHub Markdown only for now**
- **Diátaxis structure**
- **npm install as the primary user path**
- **Source install documented for contributors**
- **No internal planning docs in the public repo**
- **Templates documented as templates, not as live project config**

This should produce a documentation system that is clear, scalable, contributor-friendly, and aligned with how Taskplane is distributed.

---

## Next Recommended Step

Scaffold the public docs structure and draft the P0 files first:
- `README.md`
- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `docs/README.md`
- first-pass tutorial/reference/explanation docs

---

## Implementation Checklist

Work is organized into phases. Each phase is a self-contained chunk that an AI agent can complete within a single context window. Phases are ordered so that later phases can reference earlier deliverables.

### Phase 1 — Root Files & Docs Scaffold
> **Goal:** Create the standard open-source root files and scaffold the `docs/` directory structure. These are the first things a visitor sees and the skeleton everything else hangs on.

- [x] Rewrite `README.md` — one-sentence description, key features, current status (experimental/early), npm install as primary path, 5-minute quickstart, command overview table, links into `docs/`, contribution link
- [x] Create `CONTRIBUTING.md` — local dev setup, how to run tests, style expectations, PR conventions, where architecture docs live, how to propose changes
- [x] Create `CODE_OF_CONDUCT.md` — Contributor Covenant v2.1
- [x] Create `SECURITY.md` — how to report vulnerabilities, what counts as security-sensitive, expected response policy
- [x] Create `docs/README.md` — docs landing page with navigation by audience (new users, operators, contributors, maintainers) linking to all planned docs (even if targets don't exist yet, mark them as "coming soon")
- [x] Scaffold empty `docs/` directory tree: `tutorials/`, `how-to/`, `reference/`, `reference/configuration/`, `explanation/`, `maintainers/`

### Phase 2 — Tutorials: Install & First Task
> **Goal:** Write the beginner on-ramp. A new user should be able to go from zero to running their first task by following these two documents.

- [x] Create `docs/tutorials/install.md` — prerequisites (Node.js ≥20, pi), `npm install -g taskplane` / `pi install npm:taskplane`, `taskplane init`, `taskplane doctor`, verify commands appear in pi session. Cover both global and project-local install scenarios.
- [x] Create `docs/tutorials/run-your-first-task.md` — PROMPT.md/STATUS.md expectations, run the EXAMPLE-001 hello-world task with `/task`, observe progress with `/task-status`, demonstrate `/task-pause` and `/task-resume`, explain worker iteration loop and checkpoint discipline, verify `.DONE` file
- [x] Review and update `templates/tasks/EXAMPLE-001-hello-world/PROMPT.md` — ensure it is generic, self-contained, and matches what the tutorial references

### Phase 3 — Tutorial: First Orchestration & How-To Guides
> **Goal:** Complete the tutorial path with orchestration and write the P0 how-to guides that solve concrete user problems.

- [x] Create `docs/tutorials/run-your-first-orchestration.md` — task areas concept, `/orch-plan` to preview dependency graph and waves, `/orch all` to launch, `/orch-status` to monitor, `/orch-pause` / `/orch-resume` / `/orch-abort`, explain waves, lanes, worktrees, and merge flow at a high level
- [x] Create `docs/how-to/configure-task-runner.md` — walk through every section of `task-runner.yaml` with practical guidance: project identity, verification commands, standards, worker/reviewer model selection, context window settings, task areas
- [x] Create `docs/how-to/configure-task-orchestrator.md` — walk through every section of `task-orchestrator.yaml`: lane count, worktree location, spawn mode, dependency analysis, lane assignment strategy, merge settings, failure handling, monitoring
- [x] Create `docs/how-to/define-task-areas.md` — how to add a new task area (create directory + CONTEXT.md, add entry to `task_areas` in YAML), naming conventions, how the `create-taskplane-task` skill discovers areas, growth patterns (single area → domain areas → mature layout)
- [x] Create `docs/how-to/pause-resume-abort-a-batch.md` — `/orch-pause` vs `/task-pause`, resuming after pause, aborting a batch, what happens to in-flight workers, grace periods
- [x] Create `docs/how-to/recover-after-interruption.md` — what state is persisted (`batch-state.json`, `STATUS.md`, lane sidecar state), how resume works, `/orch` resume flow, manual recovery steps

### Phase 4 — Reference: Commands & Configuration
> **Goal:** Write the exhaustive, skimmable reference material. These are the docs users land on from search engines and bookmark.

- [x] Create `docs/reference/commands.md` — document every command with syntax, arguments, examples, and expected behavior: `/task`, `/task-status`, `/task-pause`, `/task-resume`, `/orch`, `/orch-plan`, `/orch-status`, `/orch-pause`, `/orch-resume`, `/orch-abort`, `/orch-deps`, `/orch-sessions`
- [x] Create `docs/reference/configuration/task-runner.yaml.md` — document every field in the task runner config template with type, default, description, and examples
- [x] Create `docs/reference/configuration/task-orchestrator.yaml.md` — document every field in the orchestrator config template with type, default, description, and examples
- [x] Create `docs/reference/task-format.md` — define PROMPT.md structure (metadata, review level, mission, dependencies, context docs, file scope, steps with checkboxes, completion criteria, git conventions, amendments section), dependency notation, size/review-level conventions

### Phase 5 — Explanation: Architecture & Execution Model
> **Goal:** Write the conceptual docs that explain how the system works and why it's designed this way. These are the docs contributors need before touching the codebase.

- [x] Create `docs/explanation/architecture.md` — high-level system diagram, two-extension model (task-runner + task-orchestrator), package vs project-local config, agent persona model (worker/reviewer/merger), pi integration points, dashboard as standalone server
- [x] Create `docs/explanation/execution-model.md` — task-runner loop (fresh-context worker iterations, STATUS.md as persistent memory, checkpoint discipline, cross-model review cycles, no-progress detection, context window management), how `/task` drives a single task to completion
- [x] Create `docs/explanation/waves-lanes-and-worktrees.md` — dependency DAG and topological sort, wave computation, lane assignment strategies (affinity-first, round-robin, load-balanced), git worktree isolation, branch naming, how tasks flow through waves → lanes → worktrees → merge
- [x] Create `docs/explanation/persistence-and-resume.md` — `batch-state.json` schema and lifecycle, lane sidecar state, STATUS.md as worker memory, resume algorithm (rehydrate batch state → identify incomplete wave → re-assign lanes → continue), idempotency guarantees

### Phase 6 — Maintainer Docs & Template Sanitization
> **Goal:** Write the contributor/maintainer docs and ensure all public-facing templates are clean of project-specific content.

- [x] Create `docs/maintainers/development-setup.md` — clone repo, install dependencies, load extensions locally, run pi with local extensions, how to test changes to extensions/skills/dashboard
- [x] Create `docs/maintainers/testing.md` — test framework (vitest), how to run tests (`npm test`), test file locations, fixture files, mock structure, how to add new tests
- [x] Sanitize `templates/config/task-runner.yaml` — verify no project-specific content remains (check for: `Example Project`, project-specific standards/docs references, `taskplane-wt`, project-specific test/build assumptions)
- [x] Sanitize `templates/config/task-orchestrator.yaml` — same review for project-specific content
- [x] Review `templates/agents/*.md` — ensure agent prompts are generic and don't reference specific projects
- [x] Review `templates/tasks/CONTEXT.md` — ensure it's a clean generic template

### Phase 7 — P1 Polish: Remaining Docs & Community Files
> **Goal:** Complete the P1 docs, add community infrastructure files, and cross-link everything.

- [x] Create `docs/tutorials/install-from-source.md` — contributor install path: clone, npm install in extensions/, load extensions via pi, verify commands
- [x] Create `docs/tutorials/use-the-dashboard.md` — what the dashboard shows, `taskplane dashboard` command, SSE streaming, lane/task progress visualization, batch history, tmux pane capture
- [x] Create `docs/how-to/use-tmux-for-visibility.md` — when to use tmux spawn mode vs subprocess, configuring `spawn_mode: tmux`, attaching to sessions, tmux prefix naming
- [x] Create `docs/how-to/troubleshoot-common-issues.md` — common error scenarios and resolutions: missing config files, pi version mismatch, worktree cleanup, stalled workers, merge failures, `taskplane doctor` as first step
- [x] Create `docs/reference/status-format.md` — STATUS.md semantics, step states, checkbox conventions, `.DONE` file
- [x] Create `docs/reference/glossary.md` — worker, reviewer, merge agent, wave, lane, worktree, resume, reconciliation, blocked task, skipped task, checkpoint, fresh-context loop, integration branch, batch
- [x] Create `docs/explanation/review-loop.md` — cross-model review design, review levels 0–3, APPROVE/REVISE/RETHINK verdicts, review cycle limits, how review feedback feeds back to workers
- [x] Create `docs/explanation/package-and-template-model.md` — npm package structure, pi manifest, auto-discovery of extensions/skills, template scaffolding via CLI, file ownership model, upgrade path
- [x] Create `docs/maintainers/release-process.md` — npm publish workflow, version bumping, changelog conventions, what ships in the package (`files` whitelist)
- [x] Create `docs/maintainers/package-layout.md` — annotated directory tree of the npm package, what each directory/file does, what pi auto-discovers vs what the CLI uses
- [x] Create `CHANGELOG.md` — initial entry for current version (v0.1.x), adopt Keep a Changelog format

### Phase 8 — GitHub Community Files & Final Review
> **Goal:** Add GitHub-specific community files, do a final cross-link and quality pass across all docs.

- [x] Create `.github/ISSUE_TEMPLATE/bug_report.yml` — structured bug report template with environment info, reproduction steps, expected vs actual behavior
- [x] Create `.github/ISSUE_TEMPLATE/feature_request.yml` — structured feature request template
- [x] Create `.github/pull_request_template.md` — PR template with checklist (tests, docs, changelog)
- [x] Final review pass: verify all cross-links between docs resolve correctly
- [x] Final review pass: verify `docs/README.md` navigation links match actual file paths
- [x] Final review pass: verify README.md quickstart instructions are accurate against current CLI behavior
- [x] Final review pass: ensure no internal planning artifacts, private paths, or project-specific content leaked into any public doc
