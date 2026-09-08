## Code Review: Step 3: Finalize gate binding in the lane-runner

### Verdict: REVISE

### Summary
The R004 commit closes the previously identified symbolic-revision and ordinary dirty-tree paths, and the targeted ratification tests pass (53/53). The declared static gates also pass (`npm run typecheck`, `npm run lint` at the 283-warning baseline, and `npm run format:check`), but the trusted operation still resolves the wrong packet location for cross-repo segments and its new clean-tree authority check treats Git probe failures as a clean tree.

### Issues Found
1. **[extensions/taskplane/extension.ts:5991] [important]** — `doRatifyGate` always derives `reviewsDir` and `statusPath` by calling `resolveCanonicalTaskPaths(task.taskFolder, laneRec.worktreePath, ...)`. That does not match the lane-runner's authoritative packet contract for a cross-repo segment: `buildExecutionUnit` uses `task.packetTaskPath` directly when `packetRepoId !== executionRepoId` (`extensions/taskplane/execution.ts:2548-2555`). In that supported workspace topology, `ratify_gate` therefore looks under the execution worktree's `.taskplane-tasks/...` location (and may report no reviews directory or write an obsolete copy), while finalize scans the packet-home path, so the gate cannot be closed. Resolve the packet location with the same `packetRepoId`/`packetTaskPath` logic as `buildExecutionUnit` (preferably via a shared helper), and bind the worktree/lane to the cited hold/segment rather than only `task.laneNumber`; add a cross-repo segment trusted-operation regression.

2. **[extensions/taskplane/ratification.ts:466] [important]** — `collectChangedPaths` silently substitutes an empty list whenever either `git diff --name-only HEAD` or `git ls-files --others --exclude-standard` fails. Both issuance and finalize interpret that as “clean,” so an authority-critical Git read error can hide tracked or untracked drift and allow ratification/finalization. Make the collector return/throw a failure when either probe fails and have both callers refuse with a diagnostic; add injected probe-failure cases so the clean-tree binding is demonstrably fail-closed.

### Pattern Violations
- None beyond the packet-path divergence and fail-open error handling above.

### Test Gaps
- The trusted `doRatifyGate` path still has only source-pattern assertions. In particular, there is no behavioural coverage for the R004 canonicalization cases (symbolic `HEAD`, older ancestor), packet-home routing, counter persistence, or partial artifact writes.

### Suggestions
- Update the `ratify_gate` prompt guideline and `proofRevision` parameter description at `extensions/taskplane/extension.ts:6170` and `:6196`: implementation now requires the proof to equal current HEAD, while the operator-facing text still says only “ancestor of HEAD.”
