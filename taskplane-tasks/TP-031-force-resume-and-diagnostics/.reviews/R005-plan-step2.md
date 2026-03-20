## Plan Review: Step 2: Default Merge Failure to Paused

### Verdict: REVISE

### Summary
The Step 2 plan captures the high-level goal, but it is still too ambiguous to safely implement without phase-regression risk. In particular, the current checklist does not define how to distinguish merge-related pauses from general task failures, and it does not address engine/resume parity despite mirrored phase-finalization logic. Tighten the outcome contract and test intent before implementation.

### Issues Found
1. **[Severity: important]** — The plan does not specify *which* transition should change, creating risk of over-broad phase changes.
   - Evidence: `STATUS.md:40-42` only says “change merge failure to paused,” while the concrete finalizer in `extensions/taskplane/engine.ts:993-999` currently sets `failed` based on `failedTasks > 0` (not merge-only attribution).
   - Risk: a naive edit could convert all failed-task end states to `paused`, altering non-merge semantics.
   - Suggested fix: explicitly define merge-failure attribution criteria (e.g., merge result/policy-driven paths) and state what should remain `failed`.

2. **[Severity: important]** — The plan omits parity handling with resume flow, which contains mirrored terminal logic.
   - Evidence: engine code emphasizes parity with resume (`extensions/taskplane/engine.ts:517-519`), and resume has the same terminal `failedTasks > 0` finalization (`extensions/taskplane/resume.ts:1744-1748`).
   - Risk: changing only `engine.ts` (as listed in `PROMPT.md:81-83`) can produce divergent outcomes between fresh `/orch` and `/orch-resume` runs.
   - Suggested fix: add an explicit parity decision to the plan: either update `resume.ts` too, or document why no resume change is needed and verify with tests.

3. **[Severity: minor]** — Test intent for Step 2 edge behavior is under-specified.
   - Evidence: Step-level plan has no concrete Step 2 tests (`STATUS.md:40-42`), and global tests are broad (`STATUS.md:59`).
   - Suggested fix: call out targeted scenarios: (a) merge failure with `on_merge_failure: pause` ends `paused`, (b) `on_merge_failure: abort` remains `stopped`, (c) non-merge unrecoverable failures still end `failed`, and (d) resume from merge-paused state works without `--force`.

### Missing Items
- Explicit merge-vs-non-merge failure classification rule for final phase assignment.
- Explicit engine/resume parity outcome (to avoid behavior drift).
- Step-specific test coverage intent for policy branches and resume behavior.

### Suggestions
- Reuse existing `computeMergeFailurePolicy()` contract (`extensions/taskplane/messages.ts:292-353`) as the source of truth for pause/abort semantics.
- Add one STATUS note documenting the expected final-phase matrix after Step 2 so later Step 3/4 work can validate against it.
