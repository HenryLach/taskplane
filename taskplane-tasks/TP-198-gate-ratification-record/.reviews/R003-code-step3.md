## Code Review: Step 3: Finalize gate binding in the lane-runner

### Verdict: REVISE

### Summary
The core happy path and the requested missing/stale/hash-refusal cases are implemented, and the two targeted test files pass (42/42); `npm run typecheck` and `npm run lint` also exit successfully. However, the authority check is not fully bound to the scanned gate or to the code state that was ratified, reratifying with the same ruling becomes unrecoverably stale, and the declared format check fails, so this cannot safely pass the checkpoint yet.

### Issues Found
1. **[extensions/taskplane/lane-runner.ts:220] [important]** — A linked record is selected only by `id`; neither `evaluateRatificationBlock` nor `validateRatification` checks that `record.gate` equals the gate whose latest APPROVE contains the link. Consequently, an APPROVE for `code-step9` can reuse a valid ratification id for `code-step3`: validation and staleness are both evaluated against the record's own `code-step3` files, and the unrelated gate is accepted. Bind the expected gate in the validation context (with a stable wrong-gate rejection) or explicitly reject `record.gate !== gate`, and add an executeTaskV2 regression test.

2. **[extensions/taskplane/ratification.ts:299] [important]** — The proof check does not make later code changes stale. It only asks whether `proofRevision` is an ancestor of current HEAD, which remains true after arbitrary descendant commits; `isRatificationStale` at lines 330-352 examines only review filenames. This leaves the mission's original fail-open path intact: code can change after supervisor verification/ratification and `.DONE` is still accepted. In addition, both issuance (`extension.ts:6045-6046`) and finalization (`lane-runner.ts:2925-2927`) convert a failed `rev-parse HEAD` into `null`, and validation deliberately skips all ancestry checks for null HEAD. Bind the record to the verified issuance code state and reject a changed/unresolvable final HEAD (an exact proof-HEAD check is the safe option unless relevant-file scope is available), then test a descendant commit and HEAD lookup failure.

3. **[extensions/taskplane/extension.ts:6028] [important]** — Ratification ids are deterministic from task/gate/ruling. If a valid ratification later becomes stale or invalid and the alert's documented remedy reruns `ratify_gate` with the same ruling, both old and new APPROVE files link the same id. `isRatificationStale` treats the two links as ambiguous and always returns stale, while `records.find()` may also choose the old record, so the trusted retry can never restore completion authority. Generate a unique id per issuance (for example with a UUID), fail closed on duplicate ids, and add a stale-then-reratify recovery test.

4. **[npm run format:check] [important]** — The declared quality gate exits 1. The first reported drift is `extensions/taskplane/lane-runner.ts:2978`, followed by `extensions/taskplane/ratification.ts`, `extensions/tests/ratification-finalize.test.ts`, and `extensions/tests/ratification.test.ts`. Run the project's mutating `npm run format` in the worker flow and verify `npm run format:check` is clean.

5. **[extensions/tests/ratification.test.ts:13] [important]** — Although `npm run lint` exits 0, it reports 284 warnings versus the recorded Step 0 baseline of 283, violating the task's explicit “warning count not above baseline” gate. The new unused `readFileSync` import is reported as a warning and appears to account for the increase; remove it and confirm the count returns to baseline or lower.

### Pattern Violations
- The new `ratification.ts` and `ratification.test.ts` imports use bare `crypto`/`fs`/`path`/`os` specifiers rather than the `node:` protocol, producing new Biome diagnostics. These are informational under the current configuration but should follow the convention already used in `ratification-finalize.test.ts`.

### Test Gaps
- No negative behavioural case proves a ratification cannot authorize a different gate.
- No test covers code committed after ratification or inability to resolve worktree HEAD.
- No test covers successful recovery by reratifying a gate after the first record becomes stale/invalid.

### Suggestions
- Make allocation/persistence fail closed: `allocateRatificationReviewNumber` currently starts at 1 on unreadable/malformed STATUS and ignores counter-write failures, then the APPROVE and JSON are written separately. At minimum, refuse collisions and report counter persistence failure before writing authority artifacts; ideally clean up/rollback a partial pair.
