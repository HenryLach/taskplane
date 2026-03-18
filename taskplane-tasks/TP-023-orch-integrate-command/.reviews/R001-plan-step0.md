## Plan Review: Step 0: Preflight

### Verdict: REVISE

### Summary
The checklist covers the obvious files (`extension.ts`, `persistence.ts`, `git.ts`) and is a good starting point. However, it misses one contract-level dependency that can block `/orch-integrate` entirely, and it does not include workspace/test-surface risk checks that this repo already enforces. Add those preflight outcomes before moving to implementation.

### Issues Found
1. **[Severity: critical]** — `taskplane-tasks/TP-023-orch-integrate-command/STATUS.md:16-19` does not include a preflight check for state-file lifetime after completion, but Step 2 depends on loading `.pi/batch-state.json`. Current runtime deletes state on clean completion (`extensions/taskplane/engine.ts:824-828`, `extensions/taskplane/resume.ts:1468-1471`), which can leave `/orch-integrate` with no persisted batch metadata for successful runs. **Suggested fix:** add an explicit Step 0 outcome to reconcile this contract (document expected source of integration metadata when state is absent, and record whether any behavioral dependency on TP-022 needs to be handled in-command).
2. **[Severity: important]** — Preflight does not explicitly validate workspace-root command constraints. Existing tests enforce `execCtx.repoRoot` usage and tightly restrict `ctx.cwd` usage (`extensions/tests/workspace-config.test.ts:685-698`, `713-720`). A new command that does git/state operations without this pattern is likely to regress. **Suggested fix:** add a Step 0 check to mirror `/orch-resume` command guard/root handling (`requireExecCtx` + `execCtx!.repoRoot`) as a non-negotiable implementation invariant.
3. **[Severity: important]** — Test-surface mapping is missing. The prompt references `extensions/tests/extension*.test.ts` (`PROMPT.md:53`), but this suite does not exist; command/root invariants are covered in other files (notably `workspace-config.test.ts`, plus orchestrator-state suites). **Suggested fix:** add a Step 0 item to identify the concrete test files that will validate registration, argument parsing, and branch safety behavior.

### Missing Items
- Explicit preflight decision for “no persisted batch state after clean completion” path.
- Explicit workspace-mode/root-handling invariant for the new command.
- Concrete impacted test file list (real files in `extensions/tests/`, not `extension*.test.ts`).

### Suggestions
- Capture a short Step 0 discovery note for flag conflict behavior (`--merge` + `--pr`) so Step 1/2 implementation is deterministic.
