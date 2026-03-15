# R003 — Plan Review (Step 1: Implement workspace config loading)

## Verdict
**Changes requested** — Step 1 planning is still too coarse for deterministic implementation.

## Reviewed artifacts
- `taskplane-tasks/TP-001-workspace-config-and-execution-context/PROMPT.md`
- `taskplane-tasks/TP-001-workspace-config-and-execution-context/STATUS.md`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/config.ts`
- `extensions/taskplane/worktree.ts`
- `extensions/taskplane/git.ts`
- `extensions/taskplane/index.ts`

## Blocking findings

### 1) Step 1 is not hydrated to implementation-level units
`STATUS.md` Step 1 has only two broad items (`STATUS.md:35-36`).

Given this step introduces a new fatal-validation config path, this should be split into explicit units (read, parse, schema checks, repo checks, routing checks, normalization, output contract).

### 2) Validation → error-code mapping is not specified
Step 0 added a detailed `WorkspaceConfigErrorCode` surface (`types.ts:1651-1663`), but Step 1 plan does not define which branch emits which code or in what order.

This is important because current config loaders intentionally swallow errors and default (`config.ts:66-67`, `config.ts:98-99`), while workspace config must be **fatal when present and invalid**.

### 3) Canonical path semantics are underspecified
The requirement says “normalized absolute paths,” but the plan does not define:
- base for resolving relative paths,
- canonicalization method for existing paths,
- duplicate-path comparison normalization.

There is already a Windows-safe normalization precedent in `worktree.ts:145-155` (`realpathSync.native` + `resolve` + slash/case normalization). Step 1 should explicitly reuse or mirror this behavior.

### 4) Git repo validation contract is ambiguous
`WorkspaceRepoConfig.path` must be a repo root (`types.ts:1553`), and `ExecutionContext.repoRoot` must be git-valid (`types.ts:1610-1618`).

The plan should explicitly define:
- how “is git repo” is checked (e.g., `runGit`),
- whether repo subdirectory inputs are rejected or canonicalized,
- exact error codes for each failure branch.

### 5) Loader API for Step 2 is not declared
Step 2 depends immediately on Step 1 outputs, but Step 1 does not declare exported function signatures for `workspace.ts`.

At minimum, plan the contract now (e.g., `loadWorkspaceConfig(...)`, optional context builder/helper), including no-file vs invalid-file behavior.

## Required plan updates before implementation

1. Hydrate Step 1 in `STATUS.md` into concrete subtasks (parse, schema, repo validation, routing validation, normalization, return shape).
2. Define deterministic validation order and explicit code mapping for each `WorkspaceConfigErrorCode` path used in Step 1.
3. Define canonical path rules for repos + `routing.tasks_root` (relative base, canonicalization, duplicate comparison).
4. Define git-root handling policy (repo root vs subdir behavior) and corresponding error branches.
5. Declare Step 1 exported API signatures so Step 2 wiring is unambiguous.
6. Add a minimal Step 1 test plan now (to execute in Step 3):
   - config missing → repo fallback,
   - parse/schema failures,
   - repo path missing/not found/not git,
   - routing tasks_root/default_repo failures,
   - duplicate repo paths after normalization,
   - valid relative paths resolve to canonical absolute outputs.

## Non-blocking notes
- `index.ts` currently does not export a workspace module (`extensions/taskplane/index.ts:8-22`); decide whether Step 1 should add this or defer explicitly.
- `STATUS.md` Reviews table remains malformed/duplicated (`STATUS.md:70-75`); clean up when touching status next.
