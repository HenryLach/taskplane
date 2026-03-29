# Specifications

Design documents, implementation specs, and architecture decisions that guided
Taskplane's development. These are living documents — they evolve alongside the
codebase and serve as context for both human contributors and AI agents creating
new features.

## How to use these docs

- **Before implementing a feature:** Read the relevant spec to understand design
  intent, constraints, and decisions already made.
- **During task execution:** Specs are referenced in task PROMPT.md "Context to
  Read First" sections. Workers should read the specific sections cited, not
  entire documents.
- **After implementation:** Update the spec if behavior diverged from the
  original design, and move it to `taskplane/implemented/`.

## Document index

### Active (to be implemented)

| Document | Description |
|----------|-------------|
| [taskplane/watchdog-and-recovery-tiers.md](taskplane/watchdog-and-recovery-tiers.md) | Supervisor agent, Tier 0 watchdog, interactive onboarding, recovery playbook |
| [taskplane/evaluation-system.md](taskplane/evaluation-system.md) | Cross-task validation and integrated system testing |
| [taskplane/multi-repo-task-execution.md](taskplane/multi-repo-task-execution.md) | #51 foundation: task packet home repo, segment DAG, multi-repo task execution model |
| [orch-managed-branch-spec.md](orch-managed-branch-spec.md) | Design for `orch/{opId}-{batchId}` branch model and `/orch-integrate` |
| [settings-and-onboarding-spec.md](settings-and-onboarding-spec.md) | JSON config, pointer resolution, `/taskplane-settings` TUI, `init` v2 |

### Implemented

Specs that have been fully or substantially implemented. Moved to
`taskplane/implemented/` for reference.

| Document | Shipped In | Description |
|----------|-----------|-------------|
| [taskplane/implemented/resilience-and-diagnostics-roadmap.md](taskplane/implemented/resilience-and-diagnostics-roadmap.md) | v0.6.0 | Diagnostics, recovery, verification, quality gates (Phases 1-5) |
| [taskplane/implemented/polyrepo-workspace-implementation.md](taskplane/implemented/polyrepo-workspace-implementation.md) | v0.2.0–v0.5.x | Polyrepo workspace architecture, bug history, smoke test |
| [taskplane/implemented/polyrepo-support-spec.md](taskplane/implemented/polyrepo-support-spec.md) | v0.2.0 | Original polyrepo design |
| [taskplane/implemented/polyrepo-implementation-plan.md](taskplane/implemented/polyrepo-implementation-plan.md) | v0.2.0 | Polyrepo implementation plan |
| [taskplane/implemented/polyrepo-execution-backlog.md](taskplane/implemented/polyrepo-execution-backlog.md) | v0.2.0–v0.5.x | Polyrepo feature backlog (completed) |
| [taskplane/implemented/resilience-architecture.md](taskplane/implemented/resilience-architecture.md) | v0.6.0 | Original resilience spec (superseded by roadmap) |
| [taskplane/implemented/lane-agent-design.md](taskplane/implemented/lane-agent-design.md) | v0.6.0 | Lane agent design (quality gate portion shipped as Phase 5) |
| [taskplane/implemented/tmux-telemetry-gap.md](taskplane/implemented/tmux-telemetry-gap.md) | v0.6.0 | TMUX telemetry analysis (RPC wrapper shipped as Phase 1) |

### Other

| Document | Description |
|----------|-------------|
| [cli/CLI-SPEC.md](cli/CLI-SPEC.md) | CLI command design |
| [cli/commands-cheat-sheet.md](cli/commands-cheat-sheet.md) | Quick reference for CLI commands |
| [cli/NPM-PUBLISHING.md](cli/NPM-PUBLISHING.md) | npm publish workflow |
| [framework/33-parallel-task-orchestrator.md](framework/33-parallel-task-orchestrator.md) | Original orchestrator design (early framework era) |
| [open-source-documentation-plan.md](open-source-documentation-plan.md) | Documentation structure plan |
