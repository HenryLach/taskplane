# R003 — Plan Review (Step 1: Implement routing precedence chain)

## Verdict
**Changes requested** — Step 1 plan is currently too coarse and misses key contract decisions needed for deterministic implementation.

## Reviewed artifacts
- `taskplane-tasks/TP-002-task-repo-routing-and-execution-target-parsing/PROMPT.md`
- `taskplane-tasks/TP-002-task-repo-routing-and-execution-target-parsing/STATUS.md`
- `extensions/taskplane/discovery.ts`
- `extensions/taskplane/types.ts`
- `extensions/taskplane/extension.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/resume.ts`
- `extensions/tests/discovery-routing.test.ts`

## Blocking findings

### 1) Step 1 is not hydrated to implementation-level work
`STATUS.md` still has only two high-level bullets for Step 1 (`STATUS.md:49-53`).

Given this change affects discovery contracts and execution routing, the plan must break out concrete units (resolver contract, type/schema updates, call-site plumbing, error surfacing, tests).

### 2) Routing inputs are underspecified ("area map" source and workspace default repo access)
The precedence chain requires three inputs: `prompt repo -> area map -> workspace default repo` (`PROMPT.md:68`).

Current code does not define where the **area map** comes from:
- `TaskArea` has only `path/prefix/context` (`types.ts:105-110`)
- `WorkspaceRoutingConfig` has only `tasksRoot/defaultRepo` (`types.ts:1567-1578`)

Also, discovery currently has no workspace config input:
- `runDiscovery(args, taskAreas, cwd, options)` (`discovery.ts:869-873`)

So Step 1 plan must explicitly define:
- source of area→repo mapping,
- normalization/validation rules,
- how routing config is threaded into discovery (and downstream call sites).

### 3) Error-code integration plan is incomplete
Step 1 requires emitting `TASK_REPO_UNRESOLVED` and `TASK_REPO_UNKNOWN` (`PROMPT.md:69`), but the plan does not specify required integration points.

Today:
- `DiscoveryError.code` does not include these codes (`types.ts:354-364`)
- fatal error filters are hardcoded in multiple places (`discovery.ts:1001-1015`, `extension.ts:267-275`, `engine.ts:101-109`)

Without explicit plan items to update all of these, routing errors may be downgraded to warnings or missed by plan/execution guards.

### 4) Step 1 depends on unresolved Step 0 parser defects
Routing precedence depends on trustworthy `promptRepoId`, but current parser still has known edge-case violations:
- inline `**Repo:**` fallback scans anywhere in content (`discovery.ts:222-226`), not just front-matter metadata
- section precedence can be bypassed when section value is invalid (`discovery.ts:209-233`)

Step 1 plan should either:
- include a prerequisite fix checkpoint for these defects, or
- explicitly document why routing logic remains correct despite them.

## Required plan updates before implementation
1. Hydrate Step 1 in `STATUS.md` into concrete checklist items with file-level targets.
2. Define a deterministic routing input contract:
   - area map source,
   - validation behavior,
   - mode-specific behavior (repo vs workspace).
3. Specify discovery API plumbing changes (if any) across all call sites:
   - `extension.ts`, `engine.ts`, `resume.ts`.
4. Add explicit error contract wiring for `TASK_REPO_UNRESOLVED` and `TASK_REPO_UNKNOWN`:
   - type union,
   - creation sites,
   - fatal/warning classification.
5. Add a Step 1 test matrix (new routing resolution tests), including:
   - prompt repo wins over area/default,
   - area-map fallback,
   - default-repo fallback,
   - unknown repo IDs,
   - unresolved routing cases,
   - deterministic behavior when multiple sources conflict.
