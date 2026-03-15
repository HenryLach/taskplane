# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- No unreleased changes yet.

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

[Unreleased]: https://github.com/HenryLach/taskplane/compare/v0.1.13...HEAD
[0.1.13]: https://github.com/HenryLach/taskplane/releases/tag/v0.1.13
[0.1.12]: https://github.com/HenryLach/taskplane/releases/tag/v0.1.12
[0.1.11]: https://github.com/HenryLach/taskplane/releases/tag/v0.1.11
