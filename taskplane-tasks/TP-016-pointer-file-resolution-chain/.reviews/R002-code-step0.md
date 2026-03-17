## Code Review: Step 0: Preflight

### Verdict: REVISE

### Summary
Step 0 now contains a useful resolver inventory and mode-precedence notes, but there are a few correctness and bookkeeping issues that should be fixed before Step 1 implementation proceeds. The biggest blocker is contradictory pointer failure semantics in the same STATUS artifact, which can lead to inconsistent code/test behavior. There are also malformed/duplicated status records that reduce traceability.

### Issues Found
1. **[taskplane-tasks/TP-016-pointer-file-resolution-chain/STATUS.md:148,155,165,167]** [important] — Pointer failure behavior is internally contradictory: one matrix/decision says unknown `config_repo` should be **fail-fast** (`Error — fail-fast`), while the later matrix and principle say it should **warn + fallback** (`pointer failure is non-fatal`). Pick one contract and make all Step 0 artifacts consistent so Step 1/5 implementation and tests have a single source of truth.
2. **[taskplane-tasks/TP-016-pointer-file-resolution-chain/STATUS.md:74-77,96-103]** [important] — Reviews and execution log entries are duplicated, and the Reviews markdown table separator is in the wrong position (header separator must come immediately after header row). Deduplicate rows and fix table structure to preserve reliable task history.
3. **[taskplane-tasks/TP-016-pointer-file-resolution-chain/STATUS.md:89]** [important] — Discovery says `settings-and-onboarding-spec.md` does not exist in main repo, but it exists at `C:/dev/taskplane/.pi/local/docs/settings-and-onboarding-spec.md`. Update this discovery and align preflight decisions with the actual spec source.
4. **[taskplane-tasks/TP-016-pointer-file-resolution-chain/STATUS.md:123,130]** [minor] — Resolver inventory references function names that do not match current code (`launchTmuxMerge`, `resolveTaskplanePackage`). Use actual names (`spawnMergeAgent`, `findPackageRoot`) for accuracy.

### Pattern Violations
- STATUS bookkeeping format drift: malformed table ordering and duplicate review/log rows.

### Test Gaps
- No executable code changed in this step, but there is no explicit validation artifact tying the chosen pointer failure contract (fail-fast vs fallback) to planned Step 5 test cases.

### Suggestions
- Keep a single “authoritative mode matrix” section and remove/merge duplicates to avoid semantic divergence.
- Add one short note citing the exact spec path/section used for Step 0 decisions.
