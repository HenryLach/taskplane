## Plan Review: Step 5: Documentation & Delivery

### Verdict: REVISE

### Summary
The current Step 5 plan is too thin to safely close TP-029. It captures the two high-level actions, but it misses required delivery evidence and does not guard against closing the task while prior verification items are still unresolved. Add explicit closure gates so `.DONE` is only created after all completion criteria are demonstrably satisfied.

### Issues Found
1. **[Severity: important]** — `STATUS.md:96` says “Close issue #93” but the prompt requires **“Close issue #93 with commit reference”** (`PROMPT.md:113`). Add the commit/PR reference requirement explicitly to the Step 5 checklist.
2. **[Severity: important]** — Step 4 is marked complete (`STATUS.md:80`) while two R010 test tasks remain unchecked (`STATUS.md:88-89`). Step 5 currently lacks an outcome-level gate to reconcile unresolved verification items before task closure, conflicting with completion criteria “All steps complete” and “All tests passing” (`PROMPT.md:126-127`).
3. **[Severity: important]** — The plan omits the required docs-impact check (`PROMPT.md:121-122`). Since Step 3 explicitly changed `/orch-integrate` result messaging/notification behavior (`STATUS.md:69,73`), Step 5 should include either a `docs/reference/commands.md` update or an explicit “no doc change needed” decision note.

### Missing Items
- Explicit pre-`.DONE` closure checklist validating `PROMPT.md:126-131` completion criteria.
- Explicit “issue closure evidence” item (issue link + commit/PR reference).
- Explicit docs-impact disposition for `/orch-integrate` message changes.

### Suggestions
- Make `.DONE` the **last** checkbox and gate it on: final test status, completion-criteria confirmation, docs-impact decision, and issue #93 closure reference.
