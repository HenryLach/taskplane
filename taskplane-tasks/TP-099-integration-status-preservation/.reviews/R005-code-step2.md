# R005 — Code Review (Step 2: Implement STATUS.md preservation)

## Verdict
**APPROVE**

## What I reviewed
- Diff range: `de55684d672c05bdd828b054e0ca17f9b8676ed3..HEAD`
- Primary code change:
  - `extensions/taskplane/merge.ts` (artifact staging block in `mergeWave`)
- Context files checked for consistency:
  - `extensions/taskplane/execution.ts` (`commitTaskArtifacts` behavior)
  - `extensions/tests/status-reconciliation.test.ts` (TP-035 allowlist contract)

## Validation performed
- `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/status-reconciliation.test.ts`
- `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/merge-repo-scoped.test.ts tests/orch-integrate.integration.test.ts`

Result: all passed.

## Review findings
No blocking issues found.

The Step 2 implementation correctly addresses the diagnosed overwrite bug:
- Keeps TP-035 allowlist unchanged (`.DONE`, `STATUS.md`, `REVIEW_VERDICT.json`)
- Preserves files already present in `mergeWorkDir` (prevents STATUS.md rollback to template state)
- Backfills only missing artifacts, preferring lane worktree source, then repo-root fallback
- Retains repo-root containment checks for fallback source paths

## Non-blocking recommendation (for Step 3 tests)
Add explicit regression tests for the new precedence behavior:
1. If artifact exists in `mergeWorkDir`, staging must not overwrite it.
2. If missing in `mergeWorkDir` but present in lane worktree, backfill from lane worktree.
3. If missing in both merge worktree and lane worktree, fallback to repoRoot (with containment guard).
