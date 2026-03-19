## Plan Review: Step 0: Preflight

### Verdict: REVISE

### Summary
The Step 0 checklist covers the basic preflight actions (read key files and validate the wrapper entrypoint), but it is missing one critical scoping outcome. The current wording leaves ambiguity about which poll loop is in scope, and that ambiguity can cause edits in `/orch` paths that the task explicitly says must remain unchanged.

### Issues Found
1. **[Severity: important]** — The preflight item `Read poll loop implementation` (`taskplane-tasks/TP-026-task-runner-rpc-integration/STATUS.md:17`) is ambiguous given `pollUntilTaskComplete` in the prompt (`.../PROMPT.md:64`). In this repo, `pollUntilTaskComplete` is in `extensions/taskplane/execution.ts:616` (orchestrator path), while the `/task` tmux polling loop is inside `spawnAgentTmux` in `extensions/task-runner.ts:1030+`. The plan should explicitly separate **context-only reads** from **actual edit targets** and restate “no `/orch` edits.”
2. **[Severity: minor]** — Step 0 has no explicit output capture (the `Discoveries` table is still blank at `.../STATUS.md:83-87`). Add a preflight documentation checkpoint so Step 1 has traceable assumptions.

### Missing Items
- Explicit preflight boundary outcome: identify exactly which functions/files are editable for TP-026 and which are read-only (`/orch` subprocess path).
- Explicit preflight evidence capture: record that `node bin/rpc-wrapper.mjs --help` succeeded and where command/path resolution patterns were found.

### Suggestions
- Add one Step 0 checkbox to document preflight findings in `STATUS.md` (Discoveries/Notes), including target function anchors and no-change guardrails.
- Clean up duplicated execution log rows in `STATUS.md:95-98` to keep the audit trail tidy.
