## Code Review: Step 3: Finalize gate binding in the lane-runner

### Verdict: REVISE

### Summary
The R003 wrong-gate, duplicate-id/reratification, formatting, and committed-descendant cases are addressed, and the targeted tests pass (52/52). The declared static quality gates also pass (`npm run typecheck`, `npm run lint` at the 283-warning baseline, and `npm run format:check`), but revision proof binding still has two fail-open paths that allow the finalize gate to trust code not immutably represented by the ratification.

### Issues Found
1. **[extensions/taskplane/extension.ts:6042] [important]** — `proofRevision` is persisted verbatim and is never canonicalized to an immutable commit id. A caller can supply `HEAD` (or a moving branch ref): issuance accepts it, and after a later commit the finalize check at `ratification.ts:350-352` resolves that same symbolic ref against the *new* repository state in both directions, so it still appears equal to current HEAD and `.DONE` is accepted. The issuing path also uses only ancestor validation, so an older immutable SHA produces a reported-success ratification that finalize immediately rejects as `proof-not-head`. Resolve `proofRevision` to a commit object id at issuance (for example, `git rev-parse --verify <ref>^{commit}`), store that oid, and require it to equal the issuance HEAD before writing or auditing success; reject an unresolved HEAD. Add trusted-operation/finalize regressions for symbolic `HEAD` followed by a commit and for an older ancestor supplied at issuance.

2. **[extensions/taskplane/lane-runner.ts:2931] [important]** — The “code changed since ratification” check compares only commit identity and ignores working-tree changes. Modifying or adding a source file after ratification leaves HEAD unchanged, so the linked APPROVE passes and `.DONE` is written; `execution.ts:567-587` then stages **all** uncommitted files and commits that unratified source change into the merge candidate. This directly preserves the mission's fail-open path even though the new descendant-commit test passes. Bind authority to the relevant working-tree state as well: at minimum require the fold/source tree to be clean before issuance and reject post-ratification dirty paths other than the known runtime-owned ratification/STATUS/.DONE artifacts, or persist and recheck a deterministic relevant-file/tree digest. Add a behavioural case that changes an uncommitted source file after the record is written and verifies finalize refusal.

### Pattern Violations
- None beyond the proof-binding issues above.

### Test Gaps
- No behavioural test uses a symbolic revision ref such as `HEAD` and then advances HEAD.
- No test proves that an uncommitted source change after ratification is refused before the post-task `git add -A` path can preserve it.
- The trusted `doRatifyGate` operation still has only source-pattern wiring assertions, so its acceptance of older/symbolic proof revisions is not exercised.

### Suggestions
- The collision guard currently increments `Review Counter` before checking the target filenames; consider checking/reserving atomically so a refused collision does not itself create further counter drift.
