## Code Review: Step 3: Finalize gate binding in the lane-runner

### Verdict: REVISE

### Summary
The R005 fail-closed Git-probe behavior is implemented and the targeted ratification suites pass (63/63); `npm run typecheck` and `npm run lint` also pass, with lint remaining at the 283-warning baseline. However, the cross-repo trusted-operation fix still updates the wrong STATUS.md counter, the cited-hold lane binding retains a fail-open fallback to the task lane, and the declared format check fails.

### Issues Found
1. **[extensions/taskplane/extension.ts:6131] [important]** — Cross-repo packet routing is still internally split. The code correctly derives `statusPathForCounter = packet.statusPath` at line 6025, but then ignores it and allocates the global R number from `resolved.statusPath`. For a cross-repo segment, the APPROVE and ratification JSON are written in the packet-home `.reviews`, while the authoritative packet-home `Review Counter` is left unchanged; a later ordinary review can therefore reuse that R number, and the collision guard only checks the same gate. Use `statusPathForCounter` for allocation and add the requested behavioral `doRatifyGate` cross-repo regression that verifies the packet-home STATUS, APPROVE, and JSON are updated together. The current helper-only test plus source regex would not catch this regression.

2. **[extensions/taskplane/extension.ts:5997] [important]** — The operation is not strictly bound to the lane recorded by the cited hold: when that lane cannot be found, it silently falls back to `task.laneNumber`. Validation does not compare the selected worktree/lane with the hold, so this fallback can validate and persist proof from a different worktree while claiming authority from the cited hold. Fail closed when `rulingHold.laneNumber` has no lane record, and stamp the audit entry with `rulingHold.laneNumber` rather than `task.laneNumber` at line 6165. Add a negative regression proving a missing cited-hold lane cannot fall back.

3. **[npm run format:check] [important]** — The declared quality gate exits 1. Biome reports format drift in `extensions/taskplane/extension.ts:6219` for the long `proofRevision` description. Run the project's formatter in the worker flow and confirm `npm run format:check` passes.

### Pattern Violations
- None beyond the authority/path divergence above.

### Test Gaps
- The R005 cross-repo assertion only tests `selectPacketPaths` in isolation and regex-matches that `doRatifyGate` calls it; it does not exercise the trusted operation's counter and paired artifact writes.
- The new injected Git-probe tests exercise `collectChangedPaths` itself, not issuance and finalize as callers. Add caller-level refusal coverage so future wiring changes cannot silently discard `failedProbe`.

### Suggestions
- None.
