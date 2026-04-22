## Plan Review: Step 2: Implement Integration Logic

### Verdict: REVISE

### Summary
The Step 2 plan captures the broad goals, but it is currently too coarse to safely implement this command’s critical paths. In particular, it does not carry forward the already-documented state-lifetime and failure-mode decisions, which are necessary for `/orch-integrate` to work in normal completed-batch scenarios. Expand Step 2 with explicit outcome-level branches for state-missing, state-invalid, and detached-HEAD/safety handling before implementation continues.

### Issues Found
1. **[Severity: critical]** — The Step 2 checklist (`taskplane-tasks/TP-023-orch-integrate-command/STATUS.md:43-45`) omits the no-state fallback contract documented in Discoveries (`STATUS.md:100`), even though completed batches delete `.pi/batch-state.json` by design (`extensions/taskplane/engine.ts:824-828`, `extensions/taskplane/resume.ts:1468-1471`). Without this, `/orch-integrate` will fail in the most common post-completion path. **Suggested fix:** add explicit Step 2 outcomes for: (a) try `loadBatchState`, (b) if missing use optional `<orch-branch>` arg, (c) if still unresolved, discover/list `orch/*` branches and guide user.
2. **[Severity: important]** — “Load and validate batch state” is too vague for known error modes (`STATUS.md:95-99`). `loadBatchState()` can return null or throw typed errors (`extensions/taskplane/persistence.ts:899-927`), and `getCurrentBranch()` can return null on detached HEAD (`extensions/taskplane/git.ts:18-22`), but Step 2 does not explicitly plan these outcomes. **Suggested fix:** add concrete validation outcomes/messages for null state, IO/parse/schema errors, legacy `orchBranch === ""`, and detached HEAD.
3. **[Severity: important]** — The plan does not define how branch safety and pre-summary behave when state is absent (`STATUS.md:44-45`). In that path, `baseBranch` may be unknown, and summary metrics require branch existence + diffability checks (pattern already used in merge validation at `extensions/taskplane/merge.ts:1156-1174`). **Suggested fix:** add an explicit “integration context resolution” outcome (resolved orch/base/current branches + guardrails when fields are unavailable) before safety check and summary rendering.

### Missing Items
- Step 2 outcome for state-missing fallback path using parsed `orchBranchArg` and branch discovery hints.
- Step 2 outcome for typed state-load error handling (`STATE_FILE_IO_ERROR`, `STATE_FILE_PARSE_ERROR`, `STATE_SCHEMA_INVALID`).
- Step-level test intent (can be queued to Step 4) for: no-state + arg, no-state no-arg suggestion flow, detached HEAD, legacy `orchBranch === ""`, and `--force` safety bypass.

### Suggestions
- Add a short decision table in STATUS for Step 2 input sources (`state`, `arg`, `git discovery`) and expected user-facing behavior.
- Keep implementation deterministic by resolving a single normalized context object before running safety checks or rendering summary.
