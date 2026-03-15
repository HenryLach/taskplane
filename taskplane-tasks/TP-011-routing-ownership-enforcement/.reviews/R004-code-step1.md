# R004 Code Review — Step 1: Enforce policy during discovery

## Verdict
**REQUEST_CHANGES**

## Summary
The Step 1 additions are directionally correct (command-surface strict-routing hints + `routing.strict` type validation + tests). However, there is still a fail-open edge case in `routing.strict` parsing that allows `null` and effectively disables strict mode silently.

## Blocking findings

### 1) `routing.strict: null` is still accepted (fail-open)
- **Severity:** High
- **File:** `extensions/taskplane/workspace.ts` (routing.strict parsing block)
- **Current code:**
  ```ts
  const rawStrict = rawRouting.strict;
  if (rawStrict !== undefined && rawStrict !== null && typeof rawStrict !== "boolean") {
    throw new WorkspaceConfigError(...)
  }
  const strict = rawStrict === true;
  ```
- **Problem:**
  Explicit `null` is treated like "not set" and resolves to permissive mode (`strict = false`) without an error.

  In YAML, both of these parse to `null` and currently bypass validation:
  ```yaml
  routing:
    strict: null
  ```
  ```yaml
  routing:
    strict:
  ```
- **Why it matters:**
  `routing.strict` is a governance/safety control. Accepting malformed explicit values as permissive mode is still fail-open behavior.
- **Requested change:**
  - Treat any explicitly provided non-boolean value (including `null`) as invalid.
  - Suggested guard:
    ```ts
    if (rawStrict !== undefined && typeof rawStrict !== "boolean") {
      throw new WorkspaceConfigError(...)
    }
    ```
  - Add tests in `extensions/tests/workspace-config.test.ts` for:
    - `routing.strict: null` → `WORKSPACE_SCHEMA_INVALID`
    - `routing.strict:` (empty value) → `WORKSPACE_SCHEMA_INVALID`

## Non-blocking notes
- `discovery-routing.test.ts` §25.x validates command hints by source-string inspection. This catches presence but not behavior. Consider adding at least one behavior-level assertion in future (e.g., invoking the fatal-error path and asserting emitted hint text).

## Validation performed
- `git diff 2e655e9..HEAD --name-only`
- `git diff 2e655e9..HEAD`
- `cd extensions && npx vitest run tests/discovery-routing.test.ts tests/workspace-config.test.ts` ✅ (138 passed)
