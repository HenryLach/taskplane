## Code Review: Step 1: Implement Pointer Resolution

### Verdict: REVISE

### Summary
The new pointer resolver and type contract are a solid start: repo-mode bypass, non-fatal fallback semantics, and centralized parsing in `workspace.ts` are all in place. However, the current path validation is incomplete on Windows and can still resolve outside the configured repo root. There is also a contract mismatch around fallback agent path semantics that risks changing existing workspace behavior in later wiring steps.

### Issues Found
1. **[extensions/taskplane/workspace.ts:214-245] [important]** — `config_path` traversal checks do not block Windows absolute drive paths (e.g. `C:/...`, `D:/...`), and there is no final containment check after `resolve()`. On Windows, `resolve(repoConfig.path, "D:/evil")` escapes the repo root, which contradicts the stated "path traversal not allowed" contract. **Fix:** add absolute-path rejection for both POSIX and Windows forms (e.g. `isAbsolute` + `win32.isAbsolute`) and enforce that `resolvedConfigRoot` stays under `repoConfig.path` via `relative()` containment check.
2. **[extensions/taskplane/workspace.ts:141, extensions/taskplane/types.ts:1918, extensions/task-runner.ts:408] [important]** — fallback `agentRoot` is defined as `<workspace-root>/.pi/agents/`, but current runtime fallback behavior is worktree-local (`<cwd>/.pi/agents/` or `<cwd>/agents/`). If downstream steps consume `PointerResolution.agentRoot` as authoritative fallback, this will silently change behavior for missing/malformed pointer cases. **Fix:** align the resolver contract with existing fallback precedence (or explicitly model multiple fallback candidates) before threading this through task-runner/orchestrator.

### Pattern Violations
- None beyond the contract mismatch above.

### Test Gaps
- No unit tests yet for `resolvePointer()` success/failure matrix (missing file, unreadable file, malformed JSON, missing fields, unknown repo, traversal rejection, repo-mode null).
- Missing regression test for Windows-style absolute `config_path` values (`C:/...`, `D:/...`) to ensure escape is rejected.

### Suggestions
- Add a focused `resolvePointer` test block in `extensions/tests/workspace-config.test.ts` (or a dedicated pointer test file) now, so Step 2/3 integration can rely on a locked contract.
