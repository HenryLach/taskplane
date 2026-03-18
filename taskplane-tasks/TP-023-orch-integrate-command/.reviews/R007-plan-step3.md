## Plan Review: Step 3: Implement Integration Modes

### Verdict: REVISE

### Summary
The Step 3 plan captures the three integration modes at a high level, but it is still too coarse for a command that performs branch-mutating git operations. The current checklist does not clearly encode mode-specific failure handling or cleanup boundaries, which makes incorrect destructive behavior likely. Please expand Step 3 with explicit outcome-level behavior for success/failure per mode before implementation.

### Issues Found
1. **[Severity: critical]** — Cleanup scope is ambiguous in the current Step 3 checklist (`taskplane-tasks/TP-023-orch-integrate-command/STATUS.md:55-59`). The prompt requires cleanup **only after local integration success (ff or merge)** (`PROMPT.md:99`), but Step 3 currently says “Cleanup on success” without mode gating. This risks deleting the orch branch/state in `--pr` flow where the branch is still needed. **Suggested fix:** split cleanup into explicit outcomes: (a) ff success → delete local orch branch + delete state, (b) merge success → delete local orch branch + delete state, (c) pr success → keep local/state unless explicitly defined otherwise.
2. **[Severity: important]** — The plan does not define failure-path outcomes for each mode (`STATUS.md:55-57`), despite prompt requirements for actionable messaging (e.g., ff divergence should suggest `--merge`/`--pr`, `PROMPT.md:96`). With only “Fast-forward/merge/PR mode” bullets, there is no guard that failed `git merge`, `git push`, or `gh pr create` stops cleanup and returns clear remediation. **Suggested fix:** add a mode failure matrix: command(s), failure signal, user message, and explicit “no cleanup on failure.”
3. **[Severity: important]** — Test intent for Step 3 behavior is missing. Step 4 currently verifies parsing/safety/state errors (`STATUS.md:66-70`) but does not mention mode-execution coverage (ff diverged, merge conflict, push/gh failures, cleanup only on eligible success). This leaves high-risk paths unvalidated. **Suggested fix:** add Step 3 or Step 4 test outcomes aligned with the mapped integrate test target (`STATUS.md:106`) for success/failure per mode and cleanup gating.

### Missing Items
- Explicit per-mode cleanup contract (ff/merge cleanup vs PR no-cleanup behavior).
- Explicit failure handling outcomes for `git merge --ff-only`, `git merge --no-edit`, `git push origin`, and `gh pr create`.
- Test coverage intent for mode execution + cleanup semantics.
- Decision for PR title when `batchId` is unavailable (state-missing path already supported in Step 2).

### Suggestions
- Add a compact decision table in STATUS: `mode -> commands -> success criteria -> cleanup -> user summary`.
- Keep implementation deterministic by computing one `integrationResult` object and only running cleanup when `result.integratedLocally === true`.
