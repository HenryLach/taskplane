# Taskplane Documentation

Welcome to the Taskplane docs.

Taskplane has two core audiences:

1. **Users/Operators** — install Taskplane, run tasks, orchestrate batches
2. **Contributors/Maintainers** — understand internals, test changes, and release updates

> **Status:** Public documentation is available and organized by audience and doc type (tutorial, how-to, reference, explanation).

---

## New Users (First Time)

Start here if you're new to Taskplane.

1. [Install Taskplane](tutorials/install.md)
2. [Run Your First Orchestration](tutorials/run-your-first-orchestration.md)
3. [Use the Dashboard](tutorials/use-the-dashboard.md)
4. [Run Your First Task (Single-Task Mode)](tutorials/run-your-first-task.md)

Alternative setup:
- [Install from Source](tutorials/install-from-source.md)

---

## Operators (How-To Guides)

Use these for concrete operational tasks.

- [Configure Task Runner](how-to/configure-task-runner.md)
- [Configure Task Orchestrator](how-to/configure-task-orchestrator.md)
- [Define Task Areas](how-to/define-task-areas.md)
- [Pause, Resume, or Abort a Batch](how-to/pause-resume-abort-a-batch.md)
- [Recover After Interruption](how-to/recover-after-interruption.md)
- [Use TMUX for Visibility](how-to/use-tmux-for-visibility.md)
- [Troubleshoot Common Issues](how-to/troubleshoot-common-issues.md)

---

## Reference (Exact Behavior)

Use these when you need complete command or file semantics.

- [Commands Reference](reference/commands.md)
- [Task Format (PROMPT.md)](reference/task-format.md)
- [Status Format (STATUS.md)](reference/status-format.md)
- [Glossary](reference/glossary.md)

Configuration reference:
- [Settings Reference (`/taskplane-settings`)](reference/configuration/taskplane-settings.md)
- [task-runner.yaml](reference/configuration/task-runner.yaml.md) *(legacy, still supported)*
- [task-orchestrator.yaml](reference/configuration/task-orchestrator.yaml.md) *(legacy, still supported)*

---

## Explanation (Conceptual)

Use these to understand the design and tradeoffs.

- [Architecture](explanation/architecture.md)
- [Execution Model](explanation/execution-model.md)
- [Review Loop](explanation/review-loop.md)
- [Waves, Lanes, and Worktrees](explanation/waves-lanes-and-worktrees.md)
- [Persistence and Resume](explanation/persistence-and-resume.md)
- [Package and Template Model](explanation/package-and-template-model.md)

---

## Specifications (Design Docs)

Internal design documents, architecture decisions, and implementation specs.
These are the source of truth for how features were designed and why.

- [Specifications Index](specifications/README.md)

---

## Contributors and Maintainers

- [Development Setup](maintainers/development-setup.md)
- [Testing](maintainers/testing.md)
- [Release Process](maintainers/release-process.md)
- [Package Layout](maintainers/package-layout.md)
- [Repository Governance (GitHub Setup)](maintainers/repository-governance.md)

Also see root docs:
- [CONTRIBUTING.md](../CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)
- [SECURITY.md](../SECURITY.md)

---

## Need Help?

- Report bugs / request features: https://github.com/HenryLach/taskplane/issues
- Security reports: see [SECURITY.md](../SECURITY.md)
