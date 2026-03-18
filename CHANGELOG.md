# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Configurable merge agent timeout (`merge.timeout_minutes`, default: 10 min, was hardcoded 5 min). Exposed in `/settings` TUI.
- Per-step git commits replace per-checkbox commits — reduces git overhead by ~70-80% without losing recovery capability.
- `taskplane doctor` checks tmux availability vs project `spawn_mode` config and warns on mismatch.
- JSON config schema and unified loader (`taskplane-config.json` replaces both YAML files, with YAML fallback).
- `taskplane init` mode auto-detection (repo vs workspace, no `--workspace` flag needed).
- `taskplane init` gitignore enforcement — adds selective entries for runtime artifacts.
- `taskplane init` detects and offers to untrack accidentally committed runtime artifacts.
- `taskplane init` defaults `spawn_mode` to `"tmux"` when tmux is available.
- Pointer file resolution chain for workspace mode (`taskplane-pointer.json`).
- User preferences layer (`~/.pi/agent/taskplane/preferences.json`).
- `/settings` TUI command — interactive config editor with section navigation, source indicators, and validation.
- Doctor enhancements: gitignore validation, tracked artifact detection, workspace pointer chain validation, legacy YAML migration warning.

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
