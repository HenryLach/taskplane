# General — Context

**Last Updated:** 2026-03-15
**Status:** Active
**Next Task ID:** TP-076

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

- [ ] **Update worktree naming in taskplane-settings.md** — `docs/reference/configuration/taskplane-settings.md` still describes old `{prefix}-{opId}-{N}` naming. TP-021 changed to batch-scoped `{opId}-{batchId}/lane-{N}`. Deferred to TP-024. (discovered during TP-021)
- [ ] **Intermittent orch-state-persistence test failure** — `orch-state-persistence.test.ts` occasionally fails when run in full suite (WS-010 task record not found) but passes in isolation. Likely temp directory collision between parallel tests. (discovered during TP-022)
