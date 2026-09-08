## Code Review: Step 3: Finalize gate binding in the lane-runner

### Verdict: REVISE

### Summary
The R007 immutable-proof fix is correct: revision proofs are now canonical object IDs and finalization compares them directly to the resolved HEAD. The targeted ratification suites pass (71/71), and all declared static checks pass (`npm run typecheck`, `npm run lint` at the 283-warning baseline, and `npm run format:check`), but the working-tree binding still exempts tracked project configuration under `.pi/`, allowing unratified changes into the merge candidate.

### Issues Found
1. **[extensions/taskplane/lane-runner.ts:2962] [important]** — Both finalization here and issuance at `extensions/taskplane/ratification-op.ts:240` pass `".pi"` as an unrestricted allowed prefix to `unratifiedWorkingTreePaths`. `.pi/` is not wholly runtime-owned: the project contract explicitly treats `.pi/taskplane-config.json`, `.pi/taskplane.json`, and `.pi/agents/*.md` as committed shared project files (`docs/specifications/settings-and-onboarding-spec.md:122-126`). Therefore a tracked config/agent file can be modified before or after ratification while HEAD remains equal to the proof; the helper returns no drift (confirmed directly for `.pi/taskplane-config.json`), finalization succeeds, and `commitTaskArtifacts` subsequently stages everything with `git add -A` (`extensions/taskplane/execution.ts:574-588`). Remove the blanket `.pi` exemption and allow only genuinely runtime-owned paths if any can appear in the lane worktree (ignored untracked sidecars do not appear in the current probes), then add issuance- and finalize-level regressions using a tracked `.pi/taskplane-config.json` change.

### Pattern Violations
- The `.pi` exemption conflicts with Taskplane's selective tracking model: shared configuration and agent overrides are source-controlled, while only named runtime sidecars are ignored.

### Test Gaps
- No test changes a tracked shared file under `.pi/` before issuance or after ratification; the current dirty-tree case covers only a root source file.

### Suggestions
- None.
