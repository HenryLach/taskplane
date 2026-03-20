## Plan Review: Step 2: Tighten Artifact Staging Scope

### Verdict: REVISE

### Summary
The Step 2 intent is correct, but the current plan is too high-level to reliably achieve the required containment behavior. As written, it does not yet define how the allowlist will be constructed or enforced against existing merge staging logic, which currently filters only by filename suffix. Tightening the plan with explicit scoping/risk-handling and test intent is needed before implementation.

### Issues Found
1. **[Severity: important]** — The plan checklist is generic (`STATUS.md:33-35`) and does not explicitly carry the required 3-file allowlist from the task prompt (`PROMPT.md:79`). Current staging logic in `extensions/taskplane/merge.ts:1223-1224` accepts any `*.DONE`/`STATUS.md` path (except `.worktrees/`), which can include non-task folders. **Suggested fix:** state that allowed candidates are derived per task folder and restricted to exactly `<taskFolder>/.DONE`, `<taskFolder>/STATUS.md`, and `<taskFolder>/REVIEW_VERDICT.json`.
2. **[Severity: important]** — The plan does not include path-boundary mitigation for repo-escape/external-path cases. Existing safe pattern in `extensions/taskplane/execution.ts:1637-1643` uses `resolve + relative` and rejects `..` escapes, while artifact copy currently joins raw status paths directly (`extensions/taskplane/merge.ts:1230-1236`). **Suggested fix:** add explicit normalization/containment rule in plan (repo-root-relative only, reject escapes) before staging/copying.
3. **[Severity: important]** — No concrete test coverage intent is included for this step, despite explicit acceptance requirements in the prompt (`PROMPT.md:102-103`). **Suggested fix:** add plan-level test outcomes for (a) allowlisted task artifacts are staged, (b) root untracked files are rejected, (c) files outside task folders are rejected, and (d) `REVIEW_VERDICT.json` is staged only when present.

### Missing Items
- Explicit definition of where the task-folder allowlist comes from at runtime (e.g., completed lane task metadata) so staging is deterministic.
- No-op behavior when no allowlisted artifacts changed (avoid empty/irrelevant commit attempts).
- Operator-facing logging expectation for skipped/disallowed artifact candidates.

### Suggestions
- Reuse the repo-containment approach already used in `ensureTaskFilesCommitted()` (`extensions/taskplane/execution.ts:1631-1667`) to keep behavior consistent.
- Prefer pathspec-safe staging (`git add -- <path>`) for each approved file to avoid parsing quirks from porcelain output.
