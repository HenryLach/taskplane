## Plan Review: Step 1: Register `/orch-integrate` Command

### Verdict: REVISE

### Summary
The Step 1 checklist captures the baseline registration work, but it is currently too thin to satisfy the risks already identified in Step 0 discoveries. In particular, key parsing and command-surface outcomes are missing, which makes it likely Step 2 will inherit avoidable ambiguity and regressions. Add the missing outcomes below before implementation proceeds.

### Issues Found
1. **[Severity: critical]** — The Step 1 plan only lists flag parsing and description (`taskplane-tasks/TP-023-orch-integrate-command/STATUS.md:31-32`), but it omits the already-decided fallback contract that `/orch-integrate` must accept an optional orch branch argument when state is missing (`STATUS.md:95`). **Suggested fix:** explicitly include parsing/storing `/orch-integrate <orch-branch>` in Step 1 so Step 2 can reliably handle the no-state path.
2. **[Severity: important]** — The plan does not include deterministic conflict handling for `--merge` + `--pr`, despite this being documented as a required parsing decision (`STATUS.md:97`). **Suggested fix:** add a Step 1 outcome to reject both flags together with the agreed error message.
3. **[Severity: important]** — The plan misses the session-start command visibility update already identified as Step 1 work (`STATUS.md:93`, `extensions/taskplane/extension.ts:719-722`). **Suggested fix:** add `/orch-integrate` to the startup command list in the session_start notification block.
4. **[Severity: important]** — The handler registration plan does not call out the command guard/root invariant from existing patterns (`STATUS.md:92`, `extensions/taskplane/extension.ts:84`). **Suggested fix:** include `requireExecCtx(ctx)` as a Step 1 acceptance item so git/state actions are rooted via `execCtx` and stay consistent with workspace-root safety tests.

### Missing Items
- Explicit Step 1 parser contract covering: mode flags, conflict rejection, optional branch argument.
- Explicit command-surface update for startup help text (`/orch-integrate` listed with other orch commands).
- Step-level test intent for parser behavior (at minimum conflict path and branch-argument extraction), aligned with mapped targets in `STATUS.md:96`.

### Suggestions
- Keep Step 1 implementation small by introducing a local parsed-options object (mode + force + optional branch), then consume it in Step 2/3.
- Preserve current command parsing style (simple regex/string matching) to match `orch-plan`/`orch-deps` patterns.
