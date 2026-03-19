# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.3] - 2026-03-18

### Fixed
- **Cross-repo TASK_AUTOSTART path resolution** — workspace mode now uses absolute paths for task PROMPT.md so workers in api-service/web-client worktrees can find tasks that live in shared-libs.

## [0.5.7] - 2026-03-18

### Fixed
- **Orch branch only created in default repo** — workspace mode now creates the orch branch in every repo at batch start. Merges target the orch branch directly instead of the repo's current branch, so `/orch-integrate` has actual commits to apply.

## [0.5.6] - 2026-03-18

### Fixed
- **Dashboard missing merge sub-rows for single-repo waves** — Wave 3 merge showed "succeeded" but no lane details when only one repo was involved. Threshold changed from 2+ to 1+ repo results.

## [0.5.5] - 2026-03-18

### Fixed
- **Workspace task artifacts not committed before merge** — workers wrote `.DONE` and `STATUS.md` to the canonical task folder (shared-libs) via absolute paths, leaving them as uncommitted working tree changes. New `commitWorkspaceTaskArtifacts()` runs after each wave before the merge step, committing task artifacts to the task-area repo so they appear in the orch branch and don't block `/orch-integrate`.

## [0.5.4] - 2026-03-18

### Fixed
- **Task completion not detected in workspace mode** — orchestrator polled for `.DONE` inside lane worktrees, but in workspace mode workers write `.DONE` to the canonical task folder (shared-libs). Now resolves `.DONE` and `STATUS.md` from the absolute task folder path in workspace mode. Also fixes dashboard STATUS.md monitoring for cross-repo tasks.

## [0.5.3] - 2026-03-18

### Fixed
- **Cross-repo TASK_AUTOSTART path resolution** — workspace mode now uses absolute paths for task PROMPT.md so workers in api-service/web-client worktrees can find tasks that live in shared-libs.

## [0.5.2] - 2026-03-18

### Fixed
- **TASKPLANE_WORKSPACE_ROOT not set for lane sessions** — env var condition was always false in workspace mode. Lane sessions couldn't find config, showing "0 areas".

## [0.5.1] - 2026-03-18

### Fixed
- **Lane sessions couldn't find task-runner extension** — lane tmux sessions hardcoded `{repoRoot}/extensions/task-runner.ts` which only exists in the taskplane dev repo. Now searches npm global install paths. This was a critical bug preventing workspace/polyrepo mode from working for any project other than taskplane itself.
- **Batch completion message missing integration instructions** — now shows orch branch name and `/orch-integrate` command options.
- **Batch state deleted on clean completion** — state is now preserved when an orch branch exists so `/orch-integrate` can find it.

## [0.5.0] - 2026-03-18

### Added
- **Orchestrator-managed branch model** (issue #24) — `/orch` now creates an ephemeral `orch/{opId}-{batchId}` branch and does all work there. User's HEAD is never touched during batch execution. VS Code stays on whatever branch the user is working on.
- **`/orch-integrate` command** — integrates completed batch work into your working branch. Three modes: fast-forward (default), `--merge` (real merge), `--pr` (push and open GitHub PR). Includes branch safety check (warns if current branch differs from batch origin).
- **Batch-scoped worktree containers** — worktree paths changed from `{prefix}-{opId}-{N}` to `{basePath}/{opId}-{batchId}/lane-{N}`. Prevents directory collisions between concurrent batches. Merge worktree is inside the container.
- **Auto-integration config** — `integration` setting (`"manual"` default, `"auto"` opt-in). Manual = user runs `/orch-integrate`. Auto = fast-forward on completion.
- **Settings reference doc** — `docs/reference/configuration/taskplane-settings.md` documents every setting with types, defaults, options, and descriptions.
- 86 new tests (828 total across 22 test files), including new `orch-integrate.test.ts`.

### Changed
- Wave merges use `git update-ref` instead of `git merge --ff-only` in the main repo — no longer touches the working tree.
- Stash/pop logic removed from merge flow (no longer needed since orch branch is never checked out in main repo).
- Post-merge worktree reset targets orch branch HEAD instead of user's branch.
- Batch completion message shows orch branch name and `/orch-integrate` instructions.

### Fixed
- **Settings TUI input fields freeze terminal** (issue #57) — replaced inline submenu with single-value cycling pattern that exits TUI, then prompts via `ctx.ui.input()`. Works on all platforms.
- Renamed `/settings` to `/taskplane-settings` to avoid collision with pi's built-in `/settings` command.
- Protected branch blindness — `/orch` on a protected branch no longer wastes hours before failing at merge time.

### Removed
- Orchestrator `spawn_mode` setting removed from `/taskplane-settings` TUI — `/orch` always requires tmux, making the setting misleading. The worker-level Spawn Mode (controls `/task` behavior) remains.




## [0.4.0] - 2026-03-17

### Added
- **`/taskplane-settings` TUI command** — interactive config editor with section navigation, source indicators (project/user/default), type-specific controls, and validation. Primary config interface — users rarely need to edit files directly.
- **JSON config schema** — unified `taskplane-config.json` replaces both YAML files. Unified loader with YAML fallback for backward compatibility.
- **`taskplane init` v2** — auto-detects repo vs workspace mode (no `--workspace` flag needed). Enforces selective gitignore entries. Detects and offers to untrack accidentally committed runtime artifacts. Defaults `spawn_mode` to `"tmux"` when available.
- **Pointer file resolution** — workspace mode uses `taskplane-pointer.json` to locate config, agents, and state in the designated config repo. All subsystems (task-runner, orchestrator, dashboard, merge agent) follow the pointer.
- **User preferences** — `~/.pi/agent/taskplane/preferences.json` for personal settings (operator ID, models, tmux prefix, dashboard port). Merged with project config at load time.
- **Doctor enhancements** — gitignore validation, tracked artifact detection, workspace pointer chain validation, config repo default branch check, legacy YAML migration warning, tmux vs `spawn_mode` mismatch detection.
- Configurable merge agent timeout (`merge.timeout_minutes`, default: 10 min, was hardcoded 5 min). Exposed in `/taskplane-settings` TUI.

### Changed
- **Per-step git commits** replace per-checkbox commits — reduces git overhead by ~70-80% without losing recovery capability. STATUS.md is still updated after each checkbox.
- CHANGELOG.md mandatory in release process (AGENTS.md pre-release checklist added).

## [0.3.1] - 2026-03-16

### Added
- Agent prompt inheritance — base prompts ship in package and auto-update on `pi update`. Local `.pi/agents/*.md` files are thin project-specific overrides composed at runtime. `standalone: true` opts out.
- `taskplane init` now scaffolds thin local agent files instead of full copies.

## [0.3.0] - 2026-03-16

### Breaking
- **Node.js minimum raised to 22** (was 20). All CLI commands fail fast with a clear error on older versions. CI updated to Node 22.

### Added
- `taskplane install-tmux` — automated tmux installation for Git Bash on Windows. Downloads from MSYS2 mirrors, no admin rights needed. `--check` for status, `--force` to reinstall/upgrade.
- tmux documented as strongly recommended prerequisite across all public-facing docs.
- `taskplane doctor` suggests `install-tmux` when tmux is missing on Windows.

## [0.2.9] - 2026-03-16

### Added
- `taskplane install-tmux` command (same as v0.3.0 — released before the Node.js bump).

## [0.2.8] - 2026-03-16

### Fixed
- Dashboard STATUS.md eye icon resolves paths correctly in workspace mode (was double-pathing repo prefix).

## [0.2.7] - 2026-03-16

### Fixed
- State/sidecar files (batch-state.json, lane-state, merge results) now write to workspace root's `.pi/` instead of repo root's `.pi/` in workspace mode. Fixes dashboard not showing batch progress.

## [0.2.6] - 2026-03-16

### Fixed
- Tolerate flat `verification_passed`/`verification_commands` fields in merge result JSON (merge agents may write flat fields instead of nested `verification` object).

## [0.2.5] - 2026-03-16

### Fixed
- Normalize merge result `status` field to uppercase before validation. Merge agents may write lowercase (`"success"` vs `"SUCCESS"`).

## [0.2.4] - 2026-03-16

### Fixed
- Worktree base branch resolved from current HEAD instead of `default_branch` in workspace config. Was causing worktrees to branch from `develop` instead of the user's feature branch.

## [0.2.3] - 2026-03-16

### Fixed
- Thread `TASKPLANE_WORKSPACE_ROOT` env var to lane sessions so task-runner can find `.pi/task-runner.yaml` in workspace mode.

## [0.2.2] - 2026-03-16

### Fixed
- Discovery resolves task area paths from workspace root (not repo root) in workspace mode.

## [0.2.1] - 2026-03-16

### Fixed
- Preflight `git worktree list` check runs from repo root in workspace mode (workspace root is not a git repo).

## [0.2.0] - 2026-03-15

### Added
- **Polyrepo workspace mode** — multi-repository orchestration with per-repo lanes, merges, and resume.
- Workspace config (`.pi/taskplane-workspace.yaml`) with repo definitions, routing, and strict mode.
- Task repo routing via `## Execution Target` in PROMPT.md.
- Repo-scoped lane allocation with global lane numbering.
- Repo-scoped merge sequencing with partial-success reporting.
- Operator-scoped naming for sessions, worktrees, branches, and merge artifacts (collision resistance).
- Schema v2 persistence with repo-aware task/lane records and v1→v2 auto-upconversion.
- Resume reconciliation across repos.
- Dashboard repo filter, badges, and per-repo merge sub-rows.
- Strict routing enforcement (`routing.strict: true`).
- 398 tests across 15 test files.

## [0.1.18] - 2026-03-15

### Changed
- Rebalanced hydration philosophy — outcome-level checkboxes (2-5 per step) replace exhaustive implementation scripts (15+ micro-checkboxes).
- Updated task-worker and task-reviewer agent prompts with "Adaptive Planning, Not Exhaustive Scripting" guidance.

## [0.1.17] - 2026-03-15

### Fixed
- Dashboard eye icon contrast improved — higher opacity, accent color on hover/active states, box-shadow ring for on/off distinction.

## [0.1.16] - 2026-03-15

### Fixed
- Minor bug fixes and stability improvements.

## [0.1.15] - 2026-03-15

### Fixed
- Minor bug fixes and stability improvements.

## [0.1.14] - 2026-03-15

### Fixed
- `taskplane doctor` now parses task-area `context:` paths only from the `task_areas` block, preventing false-positive CONTEXT warnings from unrelated YAML sections.

## [0.1.13] - 2026-03-15

### Added
- `taskplane init --tasks-root <relative-path>` to target an existing task directory (for example `docs/task-management`) instead of creating an alternate task area path.

### Changed
- When `--tasks-root` is provided, sample task packets are skipped by default; pass `--include-examples` to scaffold examples intentionally into that directory.

## [0.1.12] - 2026-03-15

### Added
- `taskplane uninstall` CLI command with project cleanup + optional package uninstall scopes (`--package`, `--package-only`, `--local`, `--global`, `--remove-tasks`, `--all`, `--dry-run`).
- Dynamic example scaffolding in `taskplane init`: all `templates/tasks/EXAMPLE-*` packets are now discovered and generated.
- Second default example task packet: `EXAMPLE-002-parallel-smoke`.
- GitHub governance baseline for OSS collaboration:
  - CI workflow (`.github/workflows/ci.yml`)
  - Dependabot config
  - CODEOWNERS
  - Docs improvement issue form + issue template config

### Changed
- Onboarding is now orchestrator-first (`/orch-plan all` + `/orch all` + dashboard), with `/task` documented as explicit single-task mode.
- Docs now explicitly clarify `/task` runs in current branch/worktree while `/orch` uses isolated worktrees (recommended default even for single-task isolation).
- `AGENTS.md` now includes branching/PR workflow and release-playbook guidance for coding agents.
- Maintainer documentation expanded with repository governance and release mapping between GitHub releases and npm publish.

### Fixed
- CI baseline now avoids peer-dependency import failures from extension runtime-only modules in this repo context.
- Branch protection/check naming documentation aligned with the required GitHub check context (`ci`).

## [0.1.11] - 2026-03-14

### Added
- Taskplane CLI package entrypoint (`taskplane`) with init/doctor/version/dashboard commands
- Web dashboard packaging under `dashboard/` with CLI launch support
- Project scaffolding via `taskplane init` (configs, agents, task templates)
- Dependency-aware parallel orchestration commands (`/orch*`)
- Batch persistence and resume foundations (`/orch-resume`, persisted batch state)

### Changed
- Package layout aligned for pi package distribution (`extensions/`, `skills/`, `templates/`, `dashboard/`)
- Documentation strategy shifted to phased, public open-source structure

### Fixed
- Dashboard root resolution based on runtime `--root` instead of hardcoded repo path

[Unreleased]: https://github.com/HenryLach/taskplane/compare/v0.1.14...HEAD
[0.1.14]: https://github.com/HenryLach/taskplane/releases/tag/v0.1.14
[0.1.13]: https://github.com/HenryLach/taskplane/releases/tag/v0.1.13
[0.1.12]: https://github.com/HenryLach/taskplane/releases/tag/v0.1.12
[0.1.11]: https://github.com/HenryLach/taskplane/releases/tag/v0.1.11
