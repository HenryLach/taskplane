## Code Review: Step 3: `Taskplane-Ruling:` trailer validation

### Verdict: APPROVE

### Summary
The R003 resume-parity finding is addressed: resume now applies the same fail-closed source-drift evidence used by live ratified finalization while exempting runtime-owned task artifacts. The shared completion predicate, trailer parser/validator, per-iteration audit/alert behavior, and worker contract satisfy Steps 1–3; typecheck and format-check pass, lint remains at the 283-warning baseline, and the combined targeted suite passes 137/137.

### Issues Found
None.

### Pattern Violations
- None.

### Test Gaps
- None blocking. The new resume regression covers clean source, dirty source, and runtime-only drift. A future test could additionally force `collectChangedPaths` to report a failed git probe and assert resume refuses the marker, although the implemented branch is already explicitly fail-closed.

### Suggestions
- Update the `AuthorizeCompletionCtx.workingTreeDrift` comment in `extensions/taskplane/completion-authority.ts:201-205`, which still says resume omits the probe and receives a clean default; resume now supplies the probe whenever its persisted worktree exists.
- Quality checks run: `npm run typecheck` passed; `npm run lint` passed with the recorded baseline of 283 warnings/675 infos; `npm run format:check` passed. The targeted Steps 1–3 and regression tests passed 137/137.
