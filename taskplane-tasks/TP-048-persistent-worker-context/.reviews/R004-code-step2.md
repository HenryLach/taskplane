## Code Review: Step 2: Update worker prompt for multi-step execution

### Verdict: REVISE

### Summary
This checkpoint does not contain the Step 2 implementation changes. The commit range (`a8d6892..HEAD`) only modifies `STATUS.md`; there are no edits to `extensions/task-runner.ts` or worker templates, which are explicit Step 2 scope items. As committed, this step does not demonstrate delivery of the required prompt/template updates.

### Issues Found
1. **[PROMPT.md:57-59,100-127,181-183] [critical]** — Step 2 requires updates in `extensions/task-runner.ts`, `templates/agents/task-worker.md`, and `templates/agents/local/task-worker.md`, but `git diff a8d6892..HEAD --name-only` shows only `taskplane-tasks/TP-048-persistent-worker-context/STATUS.md` changed. Add the actual code/template changes for Step 2 (or clearly document and justify why Step 2 is a no-op because the outcomes were already delivered earlier).
2. **[taskplane-tasks/TP-048-persistent-worker-context/STATUS.md:42] [important]** — The step section is marked `🟨 In Progress` despite all Step 2 checkboxes being checked and the commit message claiming completion. Make step status consistent with actual completion state to avoid incorrect operator visibility.

### Pattern Violations
- Checkpoint labeled as completing Step 2 without corresponding in-scope implementation changes.

### Test Gaps
- No validation evidence tied to Step 2 prompt/template behavior changes in this checkpoint.

### Suggestions
- If Step 2 outcomes were already implemented in earlier Step 1 commits, note that explicitly in `STATUS.md` Notes/Execution Log and avoid a "complete Step 2" code checkpoint with only status churn.
