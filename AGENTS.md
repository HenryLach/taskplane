# AGENTS.md

## Purpose

This is the **north star** for AI coding agents working on Taskplane.

Taskplane is an experimental but production-minded pi package for:
- single-task autonomous execution (`/task`)
- dependency-aware parallel orchestration (`/orch*`)
- file-backed state, resumability, and observability

When in doubt, optimize for: **determinism, recoverability, and clear operator visibility**.

---

## Project map (what to read first)

### 1) Global orientation
1. `README.md` (user-facing behavior)
2. `docs/README.md` (full docs map)
3. `docs/explanation/architecture.md`

### 2) If your change is about `/task`
- `extensions/task-runner.ts` (primary implementation)
- `docs/explanation/execution-model.md`
- `docs/reference/task-format.md`
- `docs/reference/status-format.md`
- `docs/reference/configuration/task-runner.yaml.md`

### 3) If your change is about `/orch*`
- `extensions/taskplane/extension.ts` (command surface)
- `extensions/taskplane/discovery.ts` (task discovery + deps)
- `extensions/taskplane/waves.ts` (DAG/waves/assignment)
- `extensions/taskplane/execution.ts` (lane execution)
- `extensions/taskplane/merge.ts` (merge flow)
- `extensions/taskplane/persistence.ts` + `resume.ts` (resume/state)
- `extensions/taskplane/types.ts` (defaults + contracts)
- `docs/reference/commands.md`
- `docs/reference/configuration/task-orchestrator.yaml.md`

### 4) If your change is about CLI/dashboard/scaffolding
- CLI: `bin/taskplane.mjs`
- Dashboard: `dashboard/server.cjs`, `dashboard/public/*`
- Templates: `templates/**`
- Packaging: `package.json`, `docs/maintainers/package-layout.md`

### 5) Tests
- `extensions/tests/*`
- `docs/maintainers/testing.md`

---

## Core architecture invariants (do not break casually)

1. **File-backed execution memory is fundamental**
   - `STATUS.md` is persistent task memory.
   - `.DONE` is authoritative completion marker.

2. **Orchestrator state must be resumable**
   - Persisted state in `.pi/batch-state.json` is part of runtime contract.
   - Resume/abort flows depend on consistent state semantics.

3. **Task execution and orchestration are separate concerns**
   - `/task` behavior lives in task-runner.
   - `/orch*` behavior coordinates discovery/waves/lanes/worktrees/merge.

4. **Templates are public scaffolding, not project-specific policy**
   - Keep template examples generic and safe for open-source distribution.

5. **Published package boundaries matter**
   - Only files in `package.json#files` ship.
   - Changes to package layout or manifest impact install/runtime behavior.

---

## Always do

1. **Read before editing**
   - Inspect relevant code paths + reference docs before making changes.

2. **Keep behavior and docs aligned**
   - If command/config/format behavior changes, update docs in the same change.

3. **Add or update tests for behavior changes**
   - Especially for discovery, waves, persistence/resume, and command parsing.

4. **Run validations locally (minimum)**
   - `cd extensions && npx vitest run`
   - If CLI changed: `node bin/taskplane.mjs help` and `node bin/taskplane.mjs doctor`

5. **Preserve compatibility intentionally**
   - If changing external contracts (commands, config keys, state schema), do it explicitly and document it.

6. **Keep commits scoped and reviewable**
   - Separate docs, templates, and runtime logic where possible.

7. **Prefer small, deterministic changes**
   - Avoid broad refactors unless required by the task.

---

## Never do

1. **Never `git reset --hard` when you have uncommitted or staged changes.** Use `git stash` first, or commit to a branch. Hard reset silently destroys work that must then be re-applied from scratch.
2. **Never hardcode machine/user-specific paths or private environment assumptions.**
2. **Never leak internal/planning artifacts into public docs/templates.**
3. **Never make template content project- or language-specific.**
4. **Never silently change command names/flags or config schema fields.**
5. **Never break persistence/resume semantics without schema + docs + tests updates.**
6. **Never bypass `.DONE` / `STATUS.md` conventions in task execution flow.**
7. **Never introduce unnecessary build/runtime complexity for dashboard or extensions.**
8. **Never publish/release as part of routine code edits unless explicitly requested.**

---

## Change checklists by area

### Command behavior changes (`/task`, `/orch*`, CLI)
- Update implementation
- Update `docs/reference/commands.md`
- Update README command tables if needed
- Add/adjust tests

### Config changes (`task-runner.yaml` / `task-orchestrator.yaml`)
- Update defaults/types/loaders in code
- Update templates in `templates/config/`
- Update config reference docs
- Add/adjust tests for parsing/defaulting

### Task format / status semantics changes
- Update parser logic carefully
- Keep backward compatibility where possible
- Update `docs/reference/task-format.md` and `docs/reference/status-format.md`
- Add fixtures/tests for edge cases

### Persistence/resume changes
- Update `types.ts` schema/constants as needed
- Update `persistence.ts` + `resume.ts` together
- Add regression tests for recovery paths
- Update explanation/how-to docs

### Template changes
- Validate with `taskplane init --dry-run` (or real init in scratch repo)
- Ensure generated files are generic and coherent

---

## Git/GitHub workflow policy (for agents)

### Branching strategy

- `main` is protected and should remain releasable.
- Default to short-lived topic branches from latest `main`:
  - `feat/<topic>`
  - `fix/<topic>`
  - `docs/<topic>`
  - `chore/<topic>`
  - `refactor/<topic>`
  - `test/<topic>`
- Keep one logical change per PR.

### Default command recipe (unless user asks otherwise)

1. Sync and branch:
   - `git switch main`
   - `git pull --ff-only`
   - `git switch -c <type/topic>`
2. Implement changes + run relevant validation.
3. Commit with conventional format:
   - `type(scope): short description`
4. Push and open PR:
   - `git push -u origin <branch>`
   - `gh pr create --fill`
5. Ensure required checks pass (`ci`) and conversations are resolved.
6. Merge via squash and delete branch:
   - `gh pr merge --squash --delete-branch`
7. Sync local after merge:
   - `git switch main && git pull --ff-only`

### Protection/bypass rule

- Do **not** bypass branch protection or push directly to `main` unless explicitly instructed by the user for an urgent exception.
- If merge is blocked unexpectedly, inspect:
  - `gh pr view <n> --json mergeStateStatus,statusCheckRollup`
  - `gh pr checks <n>`
  - `gh api repos/HenryLach/taskplane/branches/main/protection`

---

## Release strategy (for agents)

- GitHub release and npm publish are related but distinct:
  - `npm publish` ships installable package bits.
  - GitHub release publishes human-facing release metadata for a tag.
- Keep them aligned: **one version → one tag → one npm publish → one GitHub release**.

### Default release sequence (only when explicitly requested)

1. Ensure `main` is clean and synced; tests/smokes pass.
2. **Update `CHANGELOG.md` (MANDATORY — do NOT skip).**
   - Add a section for the new version with date.
   - List all user-facing changes since the last changelog entry.
   - Group by: Breaking, New, Fixed, Docs, Internal.
   - Read `git log` since the last release tag to find all changes.
   - This is the permanent record of what shipped. GitHub release notes
     are derived from this, not the other way around.
3. Validate package contents:
   - `npm pack --dry-run`
4. Bump version and create tag:
   - `npm version patch` (or `minor`/`major`)
5. Publish package:
   - `npm publish` (or `npm publish --tag beta`)
6. Push commit + tags:
   - `git push && git push --tags`
7. Create GitHub release for the same version tag.
   - Release notes should match or summarize `CHANGELOG.md`.
8. Verify:
   - `npm view taskplane version`
   - `gh release view v<version>`

**Pre-release checklist (verify before step 3):**
- [ ] `CHANGELOG.md` updated with all changes since last release
- [ ] Tests pass: `cd extensions && npx vitest run`
- [ ] CLI smoke: `node bin/taskplane.mjs help` and `node bin/taskplane.mjs doctor`
- [ ] No uncommitted changes on the release branch

- Never perform publish/release actions unless the user explicitly asks.

---

## Practical dev commands

- Run both extensions locally:
  - `just orch`
  - or `pi -e extensions/task-orchestrator.ts -e extensions/task-runner.ts`

- Run task-runner only:
  - `just task`
  - or `pi -e extensions/task-runner.ts`

- Run tests:
  - `cd extensions && npx vitest run`

---

## Decision rule when uncertain

Prefer the option that best preserves:
1. **correctness** (tests/contracts)
2. **recoverability** (state + resume)
3. **operator clarity** (status, logs, dashboard)
4. **minimal surprise** (stable commands/config/docs)

If code and docs disagree, treat code as current behavior and update docs accordingly.

---

## Notation

- `/orch*` in this document is shorthand for the orchestrator command family (`/orch`, `/orch-plan`, `/orch-status`, `/orch-pause`, `/orch-resume`, `/orch-abort`, `/orch-deps`, `/orch-sessions`).
- It is **not** a literal command to run.
