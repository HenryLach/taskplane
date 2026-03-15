# R002 Code Review — Step 0: Add strict-routing policy controls

## Verdict
**REQUEST_CHANGES**

## Summary
Strict-routing enforcement in `resolveTaskRouting()` is implemented correctly, and the new routing tests are comprehensive. However, there is a fail-open config parsing issue in workspace config loading that can silently disable strict mode.

## Findings

### 1) `routing.strict` silently downgrades to permissive mode on invalid type
- **Severity:** High
- **File:** `extensions/taskplane/workspace.ts` (routing.strict parsing block)
- **Current code:**
  ```ts
  const rawStrict = rawRouting.strict;
  const strict = rawStrict === true;
  ```
- **Problem:**
  If an operator sets `routing.strict` to a non-boolean value (e.g. `"true"`, `1`), config loading does not error; it silently behaves as `strict=false`.
- **Why this matters:**
  This is a governance/safety flag. Fail-open behavior can re-enable fallback routing unexpectedly and undermine the ownership-enforcement goal.
- **Requested change:**
  - If `routing.strict` is present, validate it is a boolean.
  - If not boolean, throw `WorkspaceConfigError` with `WORKSPACE_SCHEMA_INVALID` and actionable guidance.
  - Add loader tests in `extensions/tests/workspace-config.test.ts` for:
    - `strict: true` (enabled)
    - `strict: false` (disabled)
    - invalid typed values (rejected)

## Non-blocking notes
- `WorkspaceRoutingConfig.strict` comment in `extensions/taskplane/types.ts` mentions area/default fallback use for validation in strict mode, but `resolveTaskRouting()` short-circuits before fallback when `promptRepoId` is missing. Consider aligning comment text with implementation.

## Validation
- `git diff ebfa871..HEAD --name-only`
- `git diff ebfa871..HEAD`
- `cd extensions && npx vitest run tests/discovery-routing.test.ts tests/workspace-config.test.ts` ✅ (127 passed)
