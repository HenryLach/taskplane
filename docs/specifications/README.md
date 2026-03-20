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
  original design, or mark sections as superseded.

## Document index

### Active

| Document | Description |
|----------|-------------|
| [taskplane/resilience-and-diagnostics-roadmap.md](taskplane/resilience-and-diagnostics-roadmap.md) | Consolidated roadmap for diagnostics, recovery, verification, and quality gates (Phases 1-6) |
| [taskplane/watchdog-and-recovery-tiers.md](taskplane/watchdog-and-recovery-tiers.md) | Tiered watchdog design: Tier 0 (deterministic recovery), Tier 1 (bounded LLM triage), Tier 2 (fleet patrol agent) |
| [taskplane/polyrepo-workspace-implementation.md](taskplane/polyrepo-workspace-implementation.md) | Polyrepo workspace architecture, bug history, smoke test checklist |
| [orch-managed-branch-spec.md](orch-managed-branch-spec.md) | Design for `orch/{opId}-{batchId}` branch model and `/orch-integrate` |
| [settings-and-onboarding-spec.md](settings-and-onboarding-spec.md) | JSON config, pointer resolution, `/taskplane-settings` TUI, `init` v2 |

### Superseded (historical reference)

| Document | Superseded By |
|----------|--------------|
| [taskplane/resilience-architecture.md](taskplane/resilience-architecture.md) | [resilience-and-diagnostics-roadmap.md](taskplane/resilience-and-diagnostics-roadmap.md) |
| [taskplane/lane-agent-design.md](taskplane/lane-agent-design.md) | [resilience-and-diagnostics-roadmap.md](taskplane/resilience-and-diagnostics-roadmap.md) (Phase 5) |
| [taskplane/tmux-telemetry-gap.md](taskplane/tmux-telemetry-gap.md) | [resilience-and-diagnostics-roadmap.md](taskplane/resilience-and-diagnostics-roadmap.md) (Phase 1) |
| [taskplane/polyrepo-support-spec.md](taskplane/polyrepo-support-spec.md) | [polyrepo-workspace-implementation.md](taskplane/polyrepo-workspace-implementation.md) |
| [taskplane/polyrepo-implementation-plan.md](taskplane/polyrepo-implementation-plan.md) | [polyrepo-workspace-implementation.md](taskplane/polyrepo-workspace-implementation.md) |

### Other

| Document | Description |
|----------|-------------|
| [cli/CLI-SPEC.md](cli/CLI-SPEC.md) | CLI command design |
| [cli/commands-cheat-sheet.md](cli/commands-cheat-sheet.md) | Quick reference for CLI commands |
| [cli/NPM-PUBLISHING.md](cli/NPM-PUBLISHING.md) | npm publish workflow |
| [framework/33-parallel-task-orchestrator.md](framework/33-parallel-task-orchestrator.md) | Original orchestrator design (early framework era) |
| [open-source-documentation-plan.md](open-source-documentation-plan.md) | Documentation structure plan |
| [taskplane/evaluation-system.md](taskplane/evaluation-system.md) | Task evaluation and scoring design |
| [taskplane/polyrepo-execution-backlog.md](taskplane/polyrepo-execution-backlog.md) | Polyrepo feature backlog |
