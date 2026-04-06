## Plan Review: Step 3: Repeat-repo expansion test

### Verdict: REVISE

### Summary
The current Step 3 plan is technically solid for unit-level engine validation, but it does not cover the required end-to-end acceptance outcomes defined for this step. As written, it can pass unit tests while still failing the task’s explicit Step 3 deliverables (TP-008 runtime behavior in the polyrepo workspace). You should either restore the e2e outcomes into Step 3 or formally amend scope to defer them.

### Issues Found
1. **[Severity: important]** `STATUS.md` Step 3 checklist (`lines 41-44`) only plans unit coverage, but `PROMPT.md` Step 3 (`lines 84-91`) requires creating TP-008 and validating runtime repeat-repo expansion behavior in polyrepo execution.  
   **Suggested fix:** Add explicit Step 3 outcomes for TP-008 authoring + execution evidence (segments `[shared-libs → api-service]`, expansion request back to shared-libs, and observed `shared-libs::2` runtime segment).
2. **[Severity: important]** The plan omits required runtime verification for second-pass worktree ancestry and final merge outcome (`PROMPT.md:87-88`). Unit assertions alone do not prove real worktree branch base visibility or merge success across all three segments.  
   **Suggested fix:** Add checklist items for batch evidence that `shared-libs::2` worktree is provisioned from the orch branch (seeing first-pass shared-libs merge) and that merge completes with all three segment changes.
3. **[Severity: important]** Scope has been informally changed via execution log note (`STATUS.md:84,90-91`) but not formalized in the task contract (`PROMPT.md` Amendments section remains empty at `lines 144-146`). This leaves Step 3/Completion Criteria traceability inconsistent.  
   **Suggested fix:** If supervisor steering intentionally defers live e2e due issue #439, record a formal amendment in `PROMPT.md` (or explicit deferred follow-up task) and align Step 3 + completion criteria wording accordingly.

### Missing Items
- Explicit TP-008 test-task artifact outcome for Step 3 (new task `PROMPT.md`/`STATUS.md`).
- Explicit runtime evidence requirement for `shared-libs::2` execution order and second-pass orch-branch provenance.
- Explicit runtime merge-success verification for all three segment changes in the repeat-repo scenario.
- Formalized amendment/deferment path if e2e remains blocked by merge-agent issue #439.

### Suggestions
- Keep the unit tests currently planned for Step 3; they are valuable as supplementary safety checks, but position them as support evidence rather than replacement for Step 3 acceptance outcomes.
- Reuse the Step 2 evidence pattern (batch ID + segment timeline + repo/merge summary) for Step 3 so Step 5 can reference it cleanly.