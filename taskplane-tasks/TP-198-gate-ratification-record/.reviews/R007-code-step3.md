## Code Review: Step 3: Finalize gate binding in the lane-runner

### Verdict: REVISE

### Summary
The R006 packet-home counter and cited-hold lane fixes are now implemented with behavioural coverage, and the targeted ratification suites pass (69/69). All declared static checks also pass (`npm run typecheck`, `npm run lint` at the 283-warning baseline, and `npm run format:check`), but the earlier R004 immutable-proof fix is incomplete at the finalize validator: a symbolic revision stored in a record can still track a moved HEAD and authorize changed code.

### Issues Found
1. **[extensions/taskplane/ratification.ts:350] [important]** — `requireProofHeadMatch` tests commit equivalence by resolving each persisted `proofSet` ref through `git merge-base` in both directions. Although `ratifyGate` now canonicalizes its own output, `readRatifications`/`isValidGateRatification` still accept a symbolic ref such as `HEAD`; after ratification, a later clean commit moves both the worktree HEAD and the meaning of that persisted ref, so both ancestor probes succeed and finalization accepts code that was not pinned by the record. This is the same proof-binding class flagged in R004, not a new scope class. At finalize, require the persisted revision proof itself to be an immutable canonical object id equal to the already-canonical `ctx.headRevision` (rather than re-resolving a moving ref), and reject noncanonical revision refs. Add a behavioural regression that writes a record containing `proofSet: [{ kind: "revision", ref: "HEAD" }]`, advances HEAD with a clean commit, and verifies `.DONE` is refused; the current issuance test only proves the trusted operation writes an oid.

### Pattern Violations
- None beyond the incomplete immutable-proof enforcement above.

### Test Gaps
- No finalize-level test covers a symbolic revision already present in a ratification record and then advances HEAD. The current R004 operation test confirms canonical output, but does not prove the validator fails closed on a malformed/manually altered authority record.

### Suggestions
- None.
