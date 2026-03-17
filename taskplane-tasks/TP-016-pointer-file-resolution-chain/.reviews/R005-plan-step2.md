## Plan Review: Step 2: Thread Through Task-Runner

### Verdict: REVISE

### Summary
The Step 2 objective is correct, but the current plan is too broad to safely implement pointer threading in task-runner without behavioral regressions. It does not yet lock in the required resolution precedence, workspace-root source, and warning/fallback behavior already established in Step 0/1 notes. Tightening these outcomes will reduce risk before code changes start.

### Issues Found
1. **[Severity: important]** — `STATUS.md:41-42` is underspecified for source precedence. The plan says “agent and config loading uses pointer,” but does not explicitly preserve the documented precedence chain (`STATUS.md:183-192`): cwd-local config/agent overrides first, pointer second, existing fallback/base last. This is risky given current behavior in `extensions/taskplane/config-loader.ts:557-567` and `extensions/task-runner.ts:406-409`. Add explicit Step 2 outcomes that lock this precedence for both config and agent loading.
2. **[Severity: important]** — The plan does not state how task-runner determines workspace root in orchestrated runs where cwd is a worktree. Pointer lookup must use workspace root (`TASKPLANE_WORKSPACE_ROOT` set in `extensions/taskplane/execution.ts:144-149`), not only cwd, or pointer resolution will be inconsistent. Add an outcome that defines workspace-root resolution input for `resolvePointer()` and preserves repo-mode ignore semantics.
3. **[Severity: important]** — Step 2 omits explicit warn+fallback threading for pointer failures, despite `resolvePointer()` returning warning metadata and non-fatal fallback roots (`extensions/taskplane/workspace.ts:145-152`, `extensions/taskplane/types.ts:1898-1927`). Add an outcome that requires surfaced warning behavior and fallback consistency when pointer is missing/malformed/unknown.

### Missing Items
- A concrete Step 2 outcome for config precedence: cwd config files vs pointer config root vs existing workspace-root fallback.
- A concrete Step 2 outcome for agent precedence (including local override behavior in `loadAgentDef`).
- Step-specific test coverage intent for task-runner wiring (valid pointer, missing/invalid pointer fallback, repo mode unchanged).

### Suggestions
- Add 1-2 explicit test targets under Step 2 (or Step 5) for runner-level behavior, not just `resolvePointer()` unit cases.
- Reuse `resolvePointer()` directly rather than re-parsing pointer JSON in task-runner.
