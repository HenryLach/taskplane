# Taskplane Polyrepo Support — Full Implementation Plan (Internal)

> **Status:** Draft v0.3 — WS-A delivered (TP-001), WS-E delivered (TP-005), WS-F delivered (TP-006)
> **Date:** 2026-03-15 (updated: 2026-03-15)
> **Depends on:** `polyrepo-support-spec.md`
> **Primary target environment:** `C:\dev\emailgistics\` (workspace root is non-git)

---

## 1) Objective

Implement polyrepo support in **one Taskplane distribution** that also preserves monorepo behavior.

- Keep current UX for monorepo users
- Add explicit workspace mode for polyrepo users
- Preserve determinism + resumability semantics

---

## 2) Success Criteria (Release Gate)

1. Running from non-git workspace root is supported in workspace mode.
2. `/task <PROMPT.md>` resolves task repo and executes in correct repo context.
3. `/orch` supports tasks routed across 2+ repos in one batch.
4. Worktree lifecycle and merge flow are repo-scoped.
5. Resume works with repo-aware persisted state.
6. Monorepo behavior remains unchanged when workspace config is absent.

---

## 3) High-Level Delivery Strategy

### Mode split (single codebase)

- **Repo Mode (default):** existing behavior, no workspace config required.
- **Workspace Mode (new):** activated by `.pi/taskplane-workspace.yaml`.

### Rollout pattern

1. Add mode/context plumbing with zero behavior change in repo mode.
2. Add routing and external task-folder correctness.
3. Add repo-scoped orchestration (lanes/worktrees/merge/resume).
4. Add operator tooling (doctor/dashboard clarity).

---

## 4) Workstreams and Concrete Code Changes

## WS-A: Workspace config + runtime context — ✅ DELIVERED (TP-001)

### New module
- `extensions/taskplane/workspace.ts` ✅

### Responsibilities
- Load/validate `.pi/taskplane-workspace.yaml` ✅
- Produce canonical execution context used by orchestrator and task-runner integration points ✅

### New types (in `extensions/taskplane/types.ts`) ✅
- `WorkspaceMode = "repo" | "workspace"`
- `WorkspaceRepoConfig` (id, path, defaultBranch)
- `WorkspaceRoutingConfig` (tasksRoot, defaultRepo)
- `WorkspaceConfig` (mode, repos Map, routing, configPath)
- `ExecutionContext` (workspaceRoot, repoRoot, mode, workspaceConfig, taskRunnerConfig, orchestratorConfig)
- `WorkspaceConfigErrorCode` (12 stable error codes)
- `WorkspaceConfigError` (typed error with code, repoId, relatedPath)

### Key API — ✅ Delivered
- `buildExecutionContext(cwd, loadOrchConfig, loadTaskConfig): ExecutionContext` (in workspace.ts)
- `loadWorkspaceConfig(workspaceRoot): WorkspaceConfig | null` (in workspace.ts)
- `canonicalizePath(p, base): string` (in workspace.ts, exported for tests)
- `createRepoModeContext(cwd, taskRunnerConfig, orchestratorConfig): ExecutionContext` (in types.ts)
- `workspaceConfigPath(workspaceRoot): string` (in types.ts)
- ⏳ `resolveTaskRepo(task, ctx)` deferred to WS-B (task routing)

### Affected modules — ✅ Wired
- `extensions/taskplane/extension.ts` — session startup builds `ExecutionContext`, threads `repoRoot` through all engine/state/discovery paths
- `extensions/taskplane/index.ts` — barrel exports for workspace module

### Wiring details (extension.ts)
- `session_start` handler calls `buildExecutionContext()` and stores module-level `execCtx`
- `WorkspaceConfigError` caught at startup → fatal notification with code + message + guidance, commands not registered
- All `/orch*` commands use `execCtx.repoRoot` (not raw `ctx.cwd`) for state, discovery, orphan detection, batch operations
- Startup guard: commands return early with "not initialized" if `execCtx` is null

### Acceptance checks — ✅ All verified (38 tests)
- With no workspace config: mode=`repo`, workspaceRoot === repoRoot === cwd
- With workspace config: mode=`workspace`, repos/routing validated, repoRoot === default repo path
- Invalid config: deterministic error codes with actionable messages
- Root consistency: all engine paths use `repoRoot` consistently

---

## WS-B: Task metadata + repo routing

### Discovery enhancements
- `extensions/taskplane/discovery.ts`

### Changes
1. Parse optional execution target from PROMPT:
   - `## Execution Target`
   - `- **Repo:** <repo-id>`
2. Extend `ParsedTask` with `repoId` (resolved, not optional at execution stage)
3. Add routing resolution step after prompt parse:
   - prompt repo
   - area_to_repo mapping
   - default_repo
   - error if unresolved

### New/updated error codes
- `TASK_REPO_UNRESOLVED`
- `TASK_REPO_UNKNOWN`

### Acceptance checks
- Task with explicit repo routes correctly
- Task without explicit repo uses area/default route
- Unknown repo emits actionable error

---

## WS-C: External task-folder correctness

### Problem addressed
Current monitor path translation assumes task folders under repo root.

### Affected modules
- `extensions/taskplane/execution.ts`
- (possibly) `extensions/task-runner.ts` for explicit workspace-mode semantics messaging only

### Changes
1. `.DONE`/`STATUS.md` probing logic supports external canonical task folder paths.
2. For repo mode, keep current worktree-relative path behavior.
3. For workspace mode, probe canonical task path first; keep compatibility fallback.

### Acceptance checks
- Task packets in docs repo, execution in service repo: `.DONE` detected correctly
- No regression for monorepo worktree-relative tasks

---

## WS-D: Repo-scoped lane/worktree allocation

### Problem addressed
Single repoRoot assumption in lane allocation and worktree lifecycle.

### Affected modules
- `extensions/taskplane/waves.ts`
- `extensions/taskplane/worktree.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/types.ts`

### Changes
1. Group wave tasks by `repoId` before allocation.
2. Allocate lanes per repo (`repoRoot` from execution context).
3. Extend lane identity model:
   - lane key includes repo dimension (e.g., `identity-service/lane-1`)
   - tmux session naming includes repo slug to avoid collisions.
4. Keep strategy behavior deterministic within each repo group.

### Suggested lane naming contract
- `laneId`: `<repoId>/lane-<n>`
- `tmuxSessionName`: `<tmuxPrefix>-<repoSlug>-lane-<n>`

### Acceptance checks
- Two repos can run same lane number without collisions
- Worktrees created under correct repo roots

---

## WS-E: Repo-scoped merge orchestration

### Affected modules
- `extensions/taskplane/merge.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/messages.ts`

### Changes
1. Merge lanes grouped by repo.
2. Integration branch read per repo (workspace config), fallback to orchestrator default.
3. Merge result summary includes repo dimension.
4. Failure policy remains global (`pause` / `abort`) but reports repo-specific fault.

### Important v1 policy
- **No atomic cross-repo transaction guarantee**
- Explicit per-repo merge outcomes in summary/dashboard

### Acceptance checks
- Repo A merges succeed, repo B fails -> clear partial result with repo attribution

---

## WS-F: Persistence + resume schema v2 — ✅ DELIVERED (TP-006)

### Affected modules
- `extensions/taskplane/types.ts` ✅
- `extensions/taskplane/persistence.ts` ✅
- `extensions/tests/orch-state-persistence.test.ts` ✅
- `extensions/tests/fixtures/batch-state-*.json` ✅

### Delivered changes

1. **`BATCH_STATE_SCHEMA_VERSION` bumped from `1` → `2`** in `types.ts`.

2. **New/changed persisted fields:**

   | Level | Field | Type | v2 semantics |
   |-------|-------|------|--------------|
   | Top-level (`PersistedBatchState`) | `mode` | `WorkspaceMode` (`"repo"` \| `"workspace"`) | Required in v2. Source: `OrchBatchRuntimeState.mode` (set from `ExecutionContext.mode` at batch start). |
   | Task record (`PersistedTaskRecord`) | `repoId` | `string \| undefined` | Optional. Prompt-declared repo ID from `ParsedTask.promptRepoId`. |
   | Task record (`PersistedTaskRecord`) | `resolvedRepoId` | `string \| undefined` | Optional. Final repo ID after routing precedence (prompt→area→workspace-default) from `ParsedTask.resolvedRepoId`. |
   | Lane record (`PersistedLaneRecord`) | `repoId` | `string \| undefined` | Optional. From `AllocatedLane.repoId`; non-empty in workspace mode. |

   > **Design note:** `repoRoot` snapshots were not added to the persisted schema. Repo roots are resolved at resume time from workspace config + `repoId`, keeping state files portable across machines.

3. **Schema v1 → v2 compatibility policy:**
   - `loadBatchState()` accepts v1 files and auto-upconverts to v2 in memory via `upconvertV1toV2()`.
   - On-disk v1 file is **not** rewritten during upconversion (read-only load).
   - `saveBatchState()` always writes `schemaVersion: 2`.
   - `upconvertV1toV2()` defaults: `mode → "repo"`, `baseBranch → ""`, repo fields → `undefined` (omitted from JSON).
   - Schema versions other than 1 and 2 are rejected with `STATE_SCHEMA_INVALID` and actionable error message.

4. **Validation (v2-specific):**
   - `mode` is required and must be `"repo"` or `"workspace"` (v2 only; v1 upconverts before this check).
   - Task `repoId`, `resolvedRepoId`, and lane `repoId` must be `string | undefined` — `null`, numbers, objects, arrays, booleans are rejected.
   - Empty strings are structurally valid (semantic validation is mode-aware, deferred to runtime).

5. **Serialization path:**
   - All runtime write triggers route through `persistRuntimeState()` → `serializeBatchState()` → `saveBatchState()`.
   - Allocated tasks: repo fields sourced from `AllocatedTask.task.promptRepoId` and `.resolvedRepoId`.
   - Unallocated tasks (future waves): repo fields enriched by `persistRuntimeState()` from `discovery.pending` ParsedTask.
   - Every checkpoint (wave transitions, merge, pause, abort) preserves repo fields.

### Test coverage (TP-006)
- 207 tests across 11 test files, 0 failures.
- `orch-state-persistence.test.ts`: 499 internal assertions covering:
  - v2 validation (36 assertions for malformed repo fields, mode, type violations)
  - v1→v2 upconversion (8 regression tests: load, no-rewrite, explicit-save, version guardrails)
  - Serialization round-trip (allocated, repo-mode, discovery enrichment)
  - Full v1 resume pipeline (loadBatchState → checkResumeEligibility → reconcileTaskStates → computeResumePoint → analyzeOrchestratorStartupState)
- Fixtures: `batch-state-v1-valid.json`, `batch-state-v2-workspace.json`, `batch-state-v2-bad-repo-fields.json` (new); existing fixtures updated to schemaVersion 2.

### Acceptance checks — ✅ All verified
- v1 state file loads and upconverts safely to v2 in memory
- v1 upconverted state is usable in full resume pipeline
- v1 file is not rewritten on disk during load
- v2 state with repo-aware fields round-trips through serialize/validate/load
- Unsupported schema versions (0, 3, 99) are rejected with explicit remediation message
- Malformed repo fields (null, number, object, array, boolean) are rejected with `STATE_SCHEMA_INVALID`
- v2 missing required `mode` field is rejected
- ⏳ Resume across multiple repos deferred until WS-D (repo-scoped lane allocation) is delivered

---

## WS-G: Dashboard and UX clarity

### Affected modules
- `dashboard/server.cjs`
- `dashboard/public/app.js`
- `extensions/taskplane/formatting.ts`
- `bin/taskplane.mjs` (`doctor`)

### Changes
1. Display repo dimension in lane/task rows.
2. Add repo filter in dashboard.
3. Group merge results by repo.
4. `taskplane doctor` validates workspace config when present:
   - workspace root mode
   - repo existence + git validity
   - routing completeness

### Acceptance checks
- Operator can identify task/lane/merge repo at a glance
- doctor outputs actionable errors for broken workspace mappings

---

## 5) Public Surface Area Changes

## New file (workspace mode only)
- `.pi/taskplane-workspace.yaml`

## Existing command compatibility
- Keep `/task`, `/orch*` command names unchanged.
- Keep `taskplane` CLI commands unchanged.

## Optional future additions (defer unless needed)
- `/task --repo <id>` override
- `taskplane doctor --workspace`

---

## 6) Proposed PR Sequence (Reviewable slices)

### PR-1: Context plumbing and workspace config loader — ✅ DELIVERED (TP-001)
- ✅ Added `workspace.ts` + types in `types.ts`
- ✅ Wired into `extension.ts` with no behavior change in repo mode
- ✅ 38 tests in `workspace-config.test.ts`
- Note: engine.ts not directly modified — `repoRoot` is passed via `cwd` param from extension.ts

### PR-2: Discovery routing + prompt execution-target parse
- Add repo resolution to discovery
- Add routing error codes + tests

### PR-3: External task-folder path correctness
- Fix `.DONE`/`STATUS.md` probing for workspace mode

### PR-4: Repo-scoped lane allocation/worktrees
- Group by repo, lane identity updates, tmux naming updates

### PR-5: Repo-scoped merge flow
- Per-repo merge loop + reporting

### PR-6: Persistence schema v2 + resume — ✅ DELIVERED (TP-006)
- ✅ Schema v2 with `mode`, task `repoId`/`resolvedRepoId`, lane `repoId`
- ✅ v1→v2 in-memory upconvert, no on-disk rewrite, v2 write-on-save
- ✅ Validation for malformed repo fields and strict mode checking
- ✅ 207 tests passing (499 assertions in persistence test alone)

### PR-7: Dashboard/doctor repo awareness
- UI + diagnostics polish

### PR-8: Documentation and examples (internal first)
- internal runbook + workspace sample configs

---

## 7) Test Plan (must-have)

## Unit tests
- Workspace config parsing/validation
- Task-to-repo routing resolver
- External path mapping helpers
- Repo-group lane assignment determinism

## Integration tests (temp repos)
Create fixture workspace with:
- non-git root
- `platform-docs` repo with tasks
- two service repos

Validate:
1. `/task` executes routed task in correct repo
2. `/orch-plan all` builds global DAG with repo annotations
3. `/orch all` creates worktrees in correct repos
4. Mixed repo outcomes reported correctly
5. Resume after interruption restores repo-scoped lanes/tasks

## Regression tests (existing)
- Ensure monorepo tests continue to pass unchanged

---

## 8) Migration / Backward Compatibility Rules

1. No workspace config => behave exactly like today.
2. Existing `task-runner.yaml` + `task-orchestrator.yaml` remain valid.
3. State schema upgrade path documented and tested.
4. No mandatory task packet format changes in repo mode.

---

## 9) Risk Register

1. **Path handling bugs (Windows vs POSIX)**
   - Mitigation: centralize path normalization helpers; add Windows-path fixture tests.

2. **Session-name collisions across repos**
   - Mitigation: repo slug in tmux session naming contract.

3. **Operator confusion on partial cross-repo merge outcomes**
   - Mitigation: explicit repo-grouped summary and dashboard sections.

4. **Resume complexity inflation**
   - Mitigation: phase schema changes early (PR-6) with dedicated tests.

---

## 10) Implementation Readiness Checklist

- [x] Workspace config schema finalized *(TP-001: implemented in types.ts + workspace.ts, 12 error codes)*
- [ ] Routing precedence finalized (prompt > area map > default) *(WS-B)*
- [ ] Lane/session naming finalized *(WS-D)*
- [x] Persistence schema v2 approved *(WS-F, TP-006: delivered — v2 with mode, repoId/resolvedRepoId, v1 compat)*
- [ ] Integration fixture design approved
- [ ] Rollout repo (Emailgistics) identified for pilot

---

## 11) Pilot Rollout Plan (Emailgistics)

1. Implement through PR-3 (task correctness baseline)
2. Validate `/task` end-to-end with docs-root packets + service repo execution
3. Implement through PR-5 (`/orch` repo-scoped execution + merge)
4. Pilot on 2 repos and a small dependency chain
5. Enable resume + dashboard polish (PR-6/7)
6. Promote to default internal recommendation for polyrepo workspaces

---

## Related Internal Backlog

- Concrete execution backlog: `./polyrepo-execution-backlog.md`

---

## 12) Definition of Done (Polyrepo v1)

Polyrepo v1 is complete when:

- One Taskplane build supports both repo mode and workspace mode
- Emailgistics topology runs without workspace-root git requirement
- `/task` and `/orch` both operate correctly with central docs task root + multiple execution repos
- Resume and observability are repo-aware
- Monorepo workflows remain unchanged
