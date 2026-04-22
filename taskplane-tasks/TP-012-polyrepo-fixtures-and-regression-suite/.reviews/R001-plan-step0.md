# R001 — Plan Review (Step 0: Build polyrepo fixture workspace)

## Verdict
**REVISE**

Step 0 is not hydrated enough to implement safely. `STATUS.md` still only repeats the two prompt bullets (`STATUS.md:20-21`) and does not define concrete fixture topology, generation strategy, or validation criteria.

## What I reviewed
- `taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/PROMPT.md`
- `taskplane-tasks/TP-012-polyrepo-fixtures-and-regression-suite/STATUS.md`
- `extensions/taskplane/workspace.ts` (workspace + git-root validation)
- `extensions/taskplane/discovery.ts` (routing precedence, `.DONE`/archive scan behavior)
- `extensions/tests/fixtures/*` (current fixture patterns)
- `extensions/tests/workspace-config.test.ts` (temp fixture + `initGitRepo` pattern)
- `extensions/tests/execution-path-resolution.test.ts` (external tasks root pattern)
- `extensions/tests/orch-state-persistence.test.ts` (fixture loading conventions)

## Blocking findings

### 1) No concrete Step 0 implementation plan in `STATUS.md`
For a Review Level 3 task, Step 0 needs file-level, contract-level outcomes. Right now there is no reviewable plan beyond:
- “Create fixture …”
- “Add representative task packets …”

### 2) Fixture topology contract is missing
The plan must define exact on-disk layout for:
- non-git workspace root
- docs repo task root
- multiple service repos
- `.pi/taskplane-workspace.yaml` wiring

Without a concrete topology, Step 1 regression tests can drift or silently miss required workspace-mode behavior.

### 3) Git-repo realism + determinism strategy is undefined
`loadWorkspaceConfig()` requires each configured repo path to be an actual git repo root (`workspace.ts:227-242`, `WORKSPACE_REPO_NOT_GIT`).

Because committed fixtures cannot reliably include nested `.git` metadata, the plan must explicitly state how git repos are created during test setup (see existing `initGitRepo` pattern in `workspace-config.test.ts:52`).

### 4) Representative task graph is under-specified
Step 0 should define a canonical task packet matrix (IDs, repo targeting method, dependencies) covering the behaviors Step 1 will assert:
- routing precedence (`promptRepoId` → area `repo_id` → workspace default; `discovery.ts:871-873,915-933`)
- strict-routing readiness (`discovery.ts:889-901`)
- cross-repo dependency edges
- completion/archive semantics (`discovery.ts:312-325,377-401`)

### 5) Fixture mutation/isolation policy is missing
Orchestrator tests can mutate task artifacts (`STATUS.md`, `.DONE`, archive). The plan should require copy-to-temp per test run (or per suite) so committed fixtures remain immutable and tests stay deterministic.

### 6) No Step 0 verification matrix
Step 0 should include explicit pre-implementation checks (fixture integrity), e.g.:
- workspace config loads successfully in workspace mode
- docs task root discovery returns expected pending/completed sets
- resolved repo IDs and dependency graph match fixture manifest
- non-git workspace root invariant is actually true

## Required updates before approval
1. Hydrate Step 0 in `STATUS.md` with concrete, file-scoped outcomes (fixture files + any helper usage).
2. Add an explicit fixture topology spec (directory tree + ownership of each path).
3. Define repo bootstrapping approach for tests (how/when git repos are initialized).
4. Add a canonical task/dependency matrix tied to downstream regression assertions.
5. Define fixture immutability/isolation rules (copy-to-temp policy).
6. Add a Step 0 verification checklist proving fixture correctness before Step 1 test authoring.

## Non-blocking note
`STATUS.md` has duplicate “Task started / Step 0 started” log rows (`STATUS.md:75-78`). Consider cleanup for operator clarity.
