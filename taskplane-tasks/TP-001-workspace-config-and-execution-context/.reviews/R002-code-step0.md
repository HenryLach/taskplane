# R002 Code Review — Step 0: Define workspace/runtime contracts

## Verdict
**CHANGES REQUESTED**

## Scope Reviewed
- `extensions/taskplane/types.ts`
- `taskplane-tasks/TP-001-workspace-config-and-execution-context/STATUS.md`

## What looks good
- Added a clear workspace contract surface (`WorkspaceMode`, repo/routing config, error codes, context factory).
- Error code taxonomy is explicit and machine-branchable.
- `createRepoModeContext()` preserves existing repo-mode behavior.

## Findings

### 1) Execution context invariants are documented but not enforced by types
- **Severity:** High
- **File:** `extensions/taskplane/types.ts:1587, 1620-1622`
- **Issue:**
  The new contracts allow impossible/inconsistent states at compile time:
  - `WorkspaceConfig.mode` is `WorkspaceMode` (so it can be `"repo"` even though this object only exists for workspace config).
  - `ExecutionContext` allows `mode: "workspace"` with `workspaceConfig: null`, and `mode: "repo"` with non-null `workspaceConfig`.

  This weakens the core runtime contract for Step 0 and pushes invariant checking to runtime.
- **Why it matters:**
  Later wiring (Step 2+) will thread `ExecutionContext` broadly; a non-discriminated shape increases risk of branching bugs and null checks being skipped.
- **Recommended fix:**
  Make the contract discriminated:
  - `WorkspaceConfig.mode: "workspace"`
  - `ExecutionContext` as a union:
    - repo variant: `mode: "repo"`, `workspaceConfig: null`
    - workspace variant: `mode: "workspace"`, `workspaceConfig: WorkspaceConfig`

### 2) STATUS review table formatting/regression
- **Severity:** Low
- **File:** `taskplane-tasks/TP-001-workspace-config-and-execution-context/STATUS.md:70-73`
- **Issue:**
  Reviews table is malformed (separator row appears after data rows) and duplicates the same R001 entry twice.
- **Recommended fix:**
  Keep a valid markdown table order (header -> separator -> rows) and dedupe the duplicate R001 row.

## Validation notes
- Ran: `cd extensions && npx vitest run`
- Result: suite is currently failing in unrelated existing tests; this review is based on diff and contract correctness for Step 0.
