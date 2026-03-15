# R004 Code Review — Step 1: Implement workspace config loading

## Verdict
**CHANGES REQUESTED**

## Scope Reviewed
Changed in `e5c207e..HEAD`:
- `extensions/taskplane/workspace.ts`
- `extensions/taskplane/index.ts`
- `taskplane-tasks/TP-001-workspace-config-and-execution-context/STATUS.md`

Neighbor/context checked:
- `extensions/taskplane/types.ts`
- `extensions/taskplane/worktree.ts`
- `extensions/taskplane/git.ts`
- `extensions/taskplane/config.ts`

## What looks good
- Deterministic, fail-fast validation sequence is clearly implemented.
- Error-code mapping aligns with `WorkspaceConfigErrorCode` in `types.ts`.
- Duplicate repo-path detection correctly uses canonicalized comparison.
- Missing workspace config correctly falls back to repo mode (`null`) instead of throwing.

## Findings

### 1) Repo-root validation allows invalid git roots when `--show-toplevel` fails
- **Severity:** High
- **File:** `extensions/taskplane/workspace.ts:237-247`
- **Issue:**
  Validation requires `git rev-parse --git-dir` to succeed, then checks `--show-toplevel` **only when it succeeds**. If `--show-toplevel` fails (e.g., bare repo or `.git` dir), no error is thrown and the repo is accepted.
- **Why this matters:**
  The orchestrator assumes `ExecutionContext.repoRoot` is a working-tree repo root. Accepting non-worktree/bare roots pushes failure into later phases (worktree/merge execution) with worse diagnostics.
- **Recommended fix:**
  Treat `--show-toplevel` failure as invalid (`WORKSPACE_REPO_NOT_GIT`), or explicitly reject `git rev-parse --is-bare-repository=true` before continuing.

### 2) `routing.tasks_root` is validated for existence, not directory-ness
- **Severity:** Medium
- **File:** `extensions/taskplane/workspace.ts:288-295`
- **Issue:**
  `routing.tasks_root` currently passes validation when it points to any existing filesystem entry (including a file), but the contract describes it as a tasks **directory**.
- **Why this matters:**
  A file path can pass config load and fail later during discovery with less actionable errors.
- **Recommended fix:**
  Add a directory check (e.g., `statSync(tasksRootAbsolute).isDirectory()`) and fail with `WORKSPACE_TASKS_ROOT_NOT_FOUND` or a dedicated code.

## Validation Notes
- Used required diff commands:
  - `git diff e5c207e..HEAD --name-only`
  - `git diff e5c207e..HEAD`
- Ran tests: `cd extensions && npx vitest run`
  - Suite currently fails in pre-existing unrelated areas; no workspace-specific tests were added in this step.
