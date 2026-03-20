## Plan Review: Step 2: Baseline Capture & Comparison in Merge Flow

### Verdict: REVISE

### Summary
The Step 2 checklist captures the intent at a high level, but it is still missing critical outcomes needed to make baseline diffing actually authoritative in the current merge pipeline. In particular, the plan does not yet account for the existing merge-agent verification gate or for safe rollback semantics when orchestrator-side comparison detects new failures. Tightening these points now will prevent false blocking and bad-commit advancement.

### Issues Found
1. **[Severity: critical]** — The plan does not resolve the legacy merge-agent verification gate that currently fails before baseline comparison can run.
   - Evidence: Step 2 plan bullets are generic (`taskplane-tasks/TP-032-verification-baseline-fingerprinting/STATUS.md:39-43`), but merge still sends `config.merge.verify` to the merge agent (`extensions/taskplane/merge.ts:709-714`), and agent instructions still hard-fail/revert on verification failure (`templates/agents/task-merger.md:71-87`).
   - Why this blocks Step 2 goals: pre-existing test failures will still trigger `BUILD_FAILURE` before orchestrator baseline/post diff has a chance to classify them as pre-existing.
   - Suggested fix: Add an explicit Step 2 outcome defining source-of-truth verification flow during merge (orchestrator-side `testing.commands` baseline/post), and how merge-agent verification is disabled/non-blocking/compatibly scoped during this step.

2. **[Severity: important]** — No rollback/reset outcome is defined for `verification_new_failure` discovered after a successful merge.
   - Evidence: merge flow advances target ref from temp branch HEAD whenever any lane succeeded (`extensions/taskplane/merge.ts:867-930`). Current Step 2 plan says “block on new failures” but not how to remove the just-merged lane commit before branch advancement (`STATUS.md:42`).
   - Risk: a lane can be marked failed by baseline diff while its merge commit still remains on temp branch and gets fast-forwarded.
   - Suggested fix: Add explicit transaction outcome in Step 2 plan: capture pre-lane HEAD and reset/revert temp branch on `verification_new_failure` before `failedLane` break.

3. **[Severity: important]** — Baseline artifact and classification plumbing are underspecified.
   - Evidence: PROMPT requires concrete baseline path + failure classes (`PROMPT.md:75-80`), but Step 2 checklist in STATUS omits file-write contract and classification propagation (`STATUS.md:39-43`). Existing failure-policy pipeline is generic pause/abort handling (`extensions/taskplane/engine.ts:518-527`, `extensions/taskplane/messages.ts:351-356`).
   - Suggested fix: Add Step 2 outcomes for (a) exact baseline write/read contract (`.pi/verification/{opId}/...`) including repoId handling in workspace mode, and (b) where `verification_new_failure`/`flaky_suspected` attribution is recorded for policy/diagnostics.

### Missing Items
- Explicit compatibility behavior for repo mode vs workspace mode baseline file naming (including `repoId` default-group representation).
- Step 2 test intent for:
  - pre-existing failures no longer tripping legacy `BUILD_FAILURE` path,
  - rollback correctness when new failures are detected post-merge,
  - flaky rerun only re-executing failed command IDs.

### Suggestions
- Keep Step 2 scoped to merge flow outcomes (gate correctness + rollback safety), then wire strict/permissive baseline-unavailable behavior in Step 3 as planned.
- Remove duplicate review/history rows in STATUS while updating plan artifacts to keep operator audit trail clean.
