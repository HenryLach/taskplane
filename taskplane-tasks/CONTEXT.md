# General — Context

**Last Updated:** 2026-04-02
**Status:** Active
**Next Task ID:** TP-180

---

## Current State

This is the default task area for Taskplane. Tasks for developing and improving
the Taskplane package itself are created here.

Taskplane is an AI agent orchestration system built as a pi package. It provides:
- Single-task autonomous execution (`/task`)
- Dependency-aware parallel orchestration (`/orch*`)
- File-backed state, resumability, and observability

> **Historical note (testing):** Older task packets in this folder may reference
> Vitest commands. Those references are archival snapshots. Use Node.js native
> test runner commands for current work.

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
- [ ] **Runtime V2 implementation program** — Use `docs/specifications/framework/taskplane-runtime-v2/` plus task packets `TP-100` through `TP-109` as the authoritative staging area for the no-TMUX / no-`/task` redesign. Re-scope legacy open tasks `TP-082` through `TP-093` against Runtime V2 before implementing them. (staged 2026-03-30)
- [ ] **buildIntegrationExecutor workspace gap** — `buildIntegrationExecutor` (extension.ts:1329) is scoped to primary repo only. Supervisor auto-integration never integrates secondary workspace repos. Should iterate `workspaceConfig.repos` like `doOrchIntegrate` does. (discovered during TP-146)
- [ ] **Non-atomic /orch-integrate per-repo loop** — `doOrchIntegrate` (extension.ts:3170-3208) processes repos sequentially; partial success deletes orch branch in early repos while leaving later repos untouched. Consider rollback on failure or clearer partial-success reporting. (discovered during TP-146)
