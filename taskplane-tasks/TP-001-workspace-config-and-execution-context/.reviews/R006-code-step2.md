# R006 Code Review — Step 2: Wire orchestrator startup context

## Verdict
**CHANGES REQUESTED**

## Scope Reviewed
Changed in `8c52d1f..HEAD`:
- `extensions/taskplane/extension.ts`
- `taskplane-tasks/TP-001-workspace-config-and-execution-context/STATUS.md`

Neighbor/context checked:
- `extensions/taskplane/workspace.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/taskplane/persistence.ts`

## What looks good
- `session_start` now builds a canonical `ExecutionContext` via `buildExecutionContext(...)`.
- `WorkspaceConfigError` is surfaced with actionable user messaging.
- Root usage for execute/resume/discovery/orphan/state paths was moved to `execCtx.repoRoot`, consistent with current engine/resume/execution assumptions.
- `/orch-abort` keeps a safety fallback path when startup initialization fails.

## Findings

### 1) Stale execution context can leak across sessions after startup failure
- **Severity:** High
- **File:** `extensions/taskplane/extension.ts:628-651`
- **Issue:**
  `execCtx` is only assigned inside the `try` block:
  ```ts
  execCtx = buildExecutionContext(...)
  ```
  If that throws `WorkspaceConfigError`, the handler returns early but does **not** clear `execCtx` first. In a long-lived extension process, a prior session’s valid `execCtx` can remain in memory.
- **Why this matters:**
  `requireExecCtx()` checks only truthiness. A stale context can make commands run against the wrong repo/config in a later session where startup actually failed.
- **Recommended fix:**
  Reset startup-scoped state before building context, at minimum:
  - `execCtx = null` before `buildExecutionContext(...)`
  - (recommended) reset `orchConfig` / `runnerConfig` to defaults on failure to avoid stale config use.

### 2) Startup guard is not applied consistently across command surface
- **Severity:** Medium
- **File:** `extensions/taskplane/extension.ts:307-342, 618-622`
- **Issue:**
  `requireExecCtx()` is used for `/orch`, `/orch-plan`, `/orch-resume`, `/orch-deps`, but **not** for `/orch-status`, `/orch-pause`, or `/orch-sessions`.
- **Why this matters:**
  The startup error message says orchestrator commands are disabled until config is fixed. Current behavior still allows several commands to run, potentially with stale/default config and misleading output.
- **Recommended fix:**
  Either:
  1. Guard these commands too (preferred for deterministic behavior), or
  2. Explicitly define/implement a documented exception list with safe behavior that does not depend on stale config.

### 3) STATUS metadata remains malformed/duplicated
- **Severity:** Low
- **File:** `taskplane-tasks/TP-001-workspace-config-and-execution-context/STATUS.md:89-101`
- **Issue:**
  Reviews table still has duplicate rows and the markdown separator row appears at the end rather than directly after the header.
- **Recommended fix:**
  Normalize table structure (header → separator → unique rows) to keep task history readable and machine-friendly.

## Validation Notes
- Ran required diff commands:
  - `git diff 8c52d1f..HEAD --name-only`
  - `git diff 8c52d1f..HEAD`
- Ran tests:
  - `cd extensions && npx vitest run`
  - Result: failing due to pre-existing unrelated suite issues; no new Step-2-specific test coverage was added.
