# General — Context

**Last Updated:** 2026-03-15
**Status:** Active
**Next Task ID:** TP-020

---

## Current State

This is the default task area for Taskplane. Tasks for developing and improving
the Taskplane package itself are created here.

Taskplane is an AI agent orchestration system built as a pi package. It provides:
- Single-task autonomous execution (`/task`)
- Dependency-aware parallel orchestration (`/orch*`)
- File-backed state, resumability, and observability

---

## Key Files

| Category | Path |
|----------|------|
| Tasks | `taskplane-tasks/` |
| Config | `.pi/task-runner.yaml` |
| Config | `.pi/task-orchestrator.yaml` |
| Extensions | `extensions/task-runner.ts`, `extensions/task-orchestrator.ts` |
| Orchestrator modules | `extensions/taskplane/` |
| Tests | `extensions/tests/` |
| CLI | `bin/taskplane.mjs` |
| Dashboard | `dashboard/` |
| Templates | `templates/` |
| Skills | `skills/` |

---

## Technical Debt / Future Work

_Items discovered during task execution are logged here by agents._
