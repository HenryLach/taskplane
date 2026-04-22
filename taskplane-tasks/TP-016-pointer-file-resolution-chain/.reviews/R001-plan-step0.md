## Plan Review: Step 0: Preflight

### Verdict: REVISE

### Summary
The Step 0 plan is directionally correct but too thin for this task’s blast radius. It captures “read path resolution” at a high level, but it does not explicitly include several existing resolution points that are central to pointer threading. Tightening preflight outcomes now will reduce the risk of partial fixes in later steps.

### Issues Found
1. **[Severity: important]** — Preflight scope is under-specified in `STATUS.md` (Step 0 only has two generic bullets at lines 20–21), and misses concrete path-resolution touchpoints that currently drive workspace behavior: `extensions/taskplane/config-loader.ts:546-563` (`TASKPLANE_WORKSPACE_ROOT` config root fallback), `extensions/taskplane/execution.ts:133-149` (`ORCH_SIDECAR_DIR` + workspace env propagation), `extensions/taskplane/merge.ts:307` (merge agent prompt path rooted in `.pi`), and `dashboard/server.cjs:194,635-636` (state/history hard-coded to `<root>/.pi`). Add a preflight outcome to inventory all config/agent/state resolution call sites across runner, orchestrator, merge, and dashboard.
2. **[Severity: important]** — The plan does not include an explicit preflight outcome for compatibility/failure semantics (pointer missing, malformed, or partial fields), even though repo-mode stability is a hard requirement. Add a concise mode matrix to Step 0 so later implementation and tests are aligned before code changes.

### Missing Items
- A Step 0 deliverable listing the current resolution chain by artifact type (config files, agent prompts, state files).
- A Step 0 decision table for repo mode vs workspace mode with pointer present/missing/invalid.
- Explicit note of env-var precedence interactions (`TASKPLANE_WORKSPACE_ROOT`, `ORCH_SIDECAR_DIR`) before introducing pointer precedence.

### Suggestions
- Add findings from preflight into `STATUS.md` Discoveries so later steps can reference them.
- Keep Step 0 lightweight, but require one concrete output artifact (e.g., “resolution map + fallback matrix”) before moving to Step 1.
