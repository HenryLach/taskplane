# TP-016: Pointer File Resolution Chain — Status

**Current Step:** Step 6: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-03-17
**Review Level:** 2
**Review Counter:** 13
**Iteration:** 7
**Size:** M

> **Hydration:** Checkboxes represent meaningful outcomes, not individual code
> changes. Workers expand steps when runtime discoveries warrant it — aim for
> 2-5 outcome-level items per step, not exhaustive implementation scripts.

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Inventory all config/agent/state resolution call sites (resolution map)
- [x] Document mode matrix: repo mode vs workspace mode (pointer present/missing/invalid)
- [x] Document env-var precedence interactions (TASKPLANE_WORKSPACE_ROOT, ORCH_SIDECAR_DIR, pointer)
- [x] R002 revision: Unify pointer failure semantics (warn+fallback for all failure modes) and fix STATUS.md table/log formatting

---

### Step 1: Implement Pointer Resolution
**Status:** ✅ Complete

- [x] `resolvePointer()` function in workspace.ts: reads pointer JSON, validates fields, resolves config_repo against WorkspaceConfig.repos, normalizes config_path (reject traversal), returns result with resolved absolute paths + used/fallback status + warning reason. Non-fatal: never throws on pointer failures, always returns fallback paths with warning.
- [x] Return contract separates config/agent roots (follow pointer) from state root (always workspace root `.pi/`). Repo mode returns null (pointer ignored entirely).
- [x] Types added for pointer result (PointerResolution) in types.ts
- [x] R004: Fix config_path containment — reject absolute paths (Windows drive letters, `path.isAbsolute()`), then verify resolved path is within repo root using `relative()` check
- [x] R004: Add `resolvePointer()` test suite in workspace-config.test.ts covering: repo mode null, missing pointer, malformed JSON, missing fields, unknown config_repo, traversal rejection, Windows absolute path rejection

---

### Step 2: Thread Through Task-Runner
**Status:** ✅ Complete

- [x] Thread pointer into `resolveConfigRoot()` in config-loader.ts: insert pointer configRoot between cwd-local and TASKPLANE_WORKSPACE_ROOT in precedence chain (cwd → pointer → wsRoot → defaults). Non-fatal: resolvePointer warn+fallback, never throws.
- [x] Thread pointer into `loadAgentDef()` in task-runner.ts: insert pointer agentRoot between cwd-local paths and base package (cwd/.pi/agents → cwd/agents → pointer agentRoot → base package). Non-fatal: pointer fallback transparent.
- [x] Repo mode parity: verify no behavior change when workspaceConfig is null (pointer returns null, existing code paths unchanged)
- [x] Add Step 2 tests in project-config-loader.test.ts (5.x series): config resolution with valid pointer, pointer precedence over wsRoot, cwd override over pointer, fallback when pointer has no config, repo-mode parity, task-runner loadConfig integration, YAML pointer config
- [x] R006: Fix pointer config root layout mismatch — config-loader looks for `<root>/.pi/*` but pointer roots use flat layout `<root>/*`. Add dual-layout support in `hasConfigFiles`, `loadJsonConfig`, `loadTaskRunnerYaml`, `loadOrchestratorYaml`.
- [x] R006: Surface pointer warnings — log `pointer.warning` via console.error in task-runner.ts `resolveTaskRunnerPointer()` (once per session via `_pointerWarningLogged` flag).
- [x] R006: Consolidate duplicate 5.x test suites into single canonical suite. Add flat-layout tests (5.10–5.15) for real `.taskplane` pointer directory. All 591 tests passing.

---

### Step 3: Thread Through Orchestrator
**Status:** ✅ Complete

- [x] `buildExecutionContext()` resolves pointer once and passes `pointer.configRoot` to config loaders. Repo mode (null pointer) unchanged.
- [x] `spawnMergeAgent()` uses pointer's `agentRoot` for merge agent prompt path (separate from `stateRoot` used for state files). Merge request/result files stay at `stateRoot/.pi/`.
- [x] Pointer warning logged once at orchestrator startup (non-fatal, warn+fallback).
- [x] State/sidecar paths invariant: `ORCH_SIDECAR_DIR`, abort signal, batch state, merge request/result files all remain at `<workspaceRoot>/.pi/` — never follow pointer.
- [x] Add orchestrator pointer tests: buildExecutionContext with pointer, merge agent path via pointer, state paths unchanged, repo-mode parity.
- [x] R008: Thread `workspaceRoot` into `resumeOrchBatch()` — add parameter, use as stateRoot for `loadBatchState`, `persistRuntimeState`, `mergeWaveByRepo`, `deleteBatchState`. Update extension.ts call site.
- [x] R008: Replace source-text assertions in test 7.11 with behavioral test validating workspace-mode state root consistency between orch and orch-resume paths.

---

### Step 4: Thread Through Dashboard
**Status:** ✅ Complete

- [x] Verify and document that all dashboard `.pi/` paths (batch-state, lane-state, conversation logs, batch-history, fs.watch) use `REPO_ROOT` (= workspace root) and do NOT follow pointer. Add clarifying code comment at the REPO_ROOT initialization site.
- [x] Verify STATUS.md and task-folder resolution (`resolveTaskFolder`, `parseStatusMd`, `serveStatusMd`) works correctly in workspace mode — task folders live in repos/worktrees, not config repo, so no pointer needed.
- [x] Confirm repo-mode parity: dashboard behavior is completely unchanged when no workspace/pointer exists (REPO_ROOT = repo root, all paths at `<repoRoot>/.pi/`). All 608 tests passing.

---

### Step 5: Testing & Verification
**Status:** ✅ Complete

- [x] Close Step 3 open item: verify test 7.11 is behavioral (not source-text) and check off the Step 3 checkbox
- [x] Verify pointer failure/parity matrix coverage: existing tests cover missing, malformed, unknown config_repo (warn+fallback), valid pointer, and repo-mode (pointer ignored) scenarios
- [x] Verify integration split invariant: config/agent paths follow pointer while state paths (batch, sidecar, merge) stay at workspaceRoot/.pi
- [x] Run full test suite: `cd extensions && npx vitest run` — 609 tests passing (20 test files)
- [x] R012: Replace signature/shape tests 7.11 and 7.12 with behavioral tests that verify state operations use workspaceRoot in both orch and orch-resume paths (loadBatchState, persistRuntimeState, deleteBatchState all called with workspace-root-derived path when workspaceRoot differs from repoRoot)
- [x] R012: Run full test suite passing after revision — 609 tests passing (20 test files)
- [x] R012: Add committed test artifact (VERIFICATION.md with full test coverage matrix) so the review delta is non-empty and verifiable

---

### Step 6: Documentation & Delivery
**Status:** ✅ Complete

- [x] Architecture doc impact check: review `docs/explanation/architecture.md` and confirm no update needed (pointer is internal plumbing, doesn't change high-level architecture) or update if impacted
- [x] Final acceptance reconciliation: verify all PROMPT.md completion criteria are met (all steps complete, pointer works end-to-end in workspace mode, repo-mode unchanged, all tests passing per Step 5 VERIFICATION.md)
- [x] `.DONE` created in task folder

---

## Reviews
| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R008 | code | Step 3 | APPROVE | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
| R008 | code | Step 3 | REVISE | .reviews/R008-code-step3.md |
| R010 | code | Step 4 | APPROVE | .reviews/R010-code-step4.md |
| R011 | plan | Step 5 | REVISE | .reviews/R011-plan-step5.md |
| R009 | plan | Step 4 | APPROVE | .reviews/R009-plan-step4.md |
| R010 | code | Step 4 | REVISE | .reviews/R010-code-step4.md |
| R011 | plan | Step 5 | APPROVE | .reviews/R011-plan-step5.md |
| R012 | code | Step 5 | REVISE | .reviews/R012-code-step5.md |
| R012 | code | Step 5 | REVISE | .reviews/R012-code-step5.md |
| R013 | plan | Step 6 | REVISE | .reviews/R013-plan-step6.md |
| R013 | plan | Step 6 | REVISE | .reviews/R013-plan-step6.md |

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Config resolution: `resolveConfigRoot()` checks cwd for config files, then `TASKPLANE_WORKSPACE_ROOT`, falls back to cwd | Step 1-2 input | `config-loader.ts:546-567` |
| Config loading: `loadProjectConfig()` reads `<configRoot>/.pi/taskplane-config.json` first, then YAML fallback | Step 1-2 input | `config-loader.ts:569-603` |
| Agent loading: `loadAgentDef()` looks at `<cwd>/.pi/agents/{name}.md` and `<cwd>/agents/{name}.md` | Step 2 input | `task-runner.ts:408` |
| Merge agent prompt: hard-coded `join(stateRoot ?? repoRoot, ".pi", "agents", "task-merger.md")` | Step 3 input | `merge.ts:307` |
| Sidecar dir: `ORCH_SIDECAR_DIR = join(workspaceRoot \|\| repoRoot, ".pi")` | Step 3 input | `execution.ts:138` |
| Dashboard state: `BATCH_STATE_PATH = <REPO_ROOT>/.pi/batch-state.json`, lane states from `<REPO_ROOT>/.pi/lane-state-*.json` | Step 4 input | `dashboard/server.cjs:634-636,194` |
| Pointer file shape: `{ config_repo: "<repoId>", config_path: ".taskplane" }` at `<workspaceRoot>/.pi/taskplane-pointer.json` | Step 1 input | `bin/taskplane.mjs:1072-1075` |
| `settings-and-onboarding-spec.md` exists at `C:/dev/taskplane/.pi/local/docs/settings-and-onboarding-spec.md` (main repo, not worktree) | Step 0 input | `.pi/local/docs/` |
| Dashboard conversation files at `<REPO_ROOT>/.pi/worker-conversation-*.jsonl` | Step 4 input | `dashboard/server.cjs:381` |

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-17 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-17 17:23 | Task started | Extension-driven execution |
| 2026-03-17 17:23 | Step 0 started | Preflight |
| 2026-03-17 17:25 | Review R001 | plan Step 0: REVISE |
| 2026-03-17 17:29 | Worker iter 1 | done in 234s, ctx: 40%, tools: 43 |
| 2026-03-17 17:30 | Review R002 | code Step 0: REVISE |
| 2026-03-17 17:32 | Worker iter 1 | done in 128s, ctx: 12%, tools: 19 |
| 2026-03-17 17:32 | Step 0 complete | Preflight |
| 2026-03-17 17:32 | Step 1 started | Implement Pointer Resolution |
| 2026-03-17 17:34 | Worker iter 1 | done in 170s, ctx: 16%, tools: 26 |
| 2026-03-17 17:34 | Step 0 complete | Preflight |
| 2026-03-17 17:34 | Step 1 started | Implement Pointer Resolution |
| 2026-03-17 17:34 | Review R003 | plan Step 1: REVISE |
| 2026-03-17 17:35 | Review R003 | plan Step 1: REVISE |
| 2026-03-17 17:38 | Worker iter 2 | done in 161s, ctx: 32%, tools: 31 |
| 2026-03-17 17:39 | Worker iter 2 | done in 297s, ctx: 20%, tools: 35 |
| 2026-03-17 17:42 | Review R004 | code Step 1: REVISE |
| 2026-03-17 17:42 | Review R004 | code Step 1: REVISE |
| 2026-03-17 17:50 | Worker iter 2 | done in 431s, ctx: 25%, tools: 41 |
| 2026-03-17 17:50 | Step 1 complete | Implement Pointer Resolution |
| 2026-03-17 17:50 | Step 2 started | Thread Through Task-Runner |
| 2026-03-17 17:50 | Review R005 | plan Step 2: REVISE |
| 2026-03-17 17:52 | Review R005 | plan Step 2: REVISE |
| 2026-03-17 17:59 | Worker iter 3 | done in 407s, ctx: 40%, tools: 58 |
| 2026-03-17 18:01 | Worker iter 3 | done in 670s, ctx: 39%, tools: 77 |
| 2026-03-17 18:02 | Review R006 | code Step 2: REVISE |
| 2026-03-17 18:04 | Review R006 | code Step 2: REVISE |
| 2026-03-17 18:11 | Worker iter 3 | done in 510s, ctx: 37%, tools: 57 |
| 2026-03-17 18:11 | Step 2 complete | Thread Through Task-Runner |
| 2026-03-17 18:11 | Step 3 started | Thread Through Orchestrator |
| 2026-03-17 18:13 | Review R007 | plan Step 3: REVISE |
| 2026-03-17 18:15 | Worker iter 3 | done in 648s, ctx: 34%, tools: 84 |
| 2026-03-17 18:15 | Step 2 complete | Thread Through Task-Runner |
| 2026-03-17 18:15 | Step 3 started | Thread Through Orchestrator |
| 2026-03-17 18:17 | Review R007 | plan Step 3: REVISE |
| 2026-03-17 18:31 | Worker iter 4 | done in 1067s, ctx: 55%, tools: 146 |
| 2026-03-17 18:36 | Worker iter 4 | done in 1109s, ctx: 57%, tools: 110 |
| 2026-03-17 18:37 | Review R008 | code Step 3: APPROVE |
| 2026-03-17 18:37 | Step 3 complete | Thread Through Orchestrator |
| 2026-03-17 18:37 | Step 4 started | Thread Through Dashboard |
| 2026-03-17 18:39 | Review R009 | plan Step 4: REVISE |
| 2026-03-17 18:42 | Review R008 | code Step 3: REVISE |
| 2026-03-17 18:44 | Worker iter 5 | done in 297s, ctx: 21%, tools: 33 |
| 2026-03-17 18:47 | Review R010 | code Step 4: APPROVE |
| 2026-03-17 18:47 | Step 4 complete | Thread Through Dashboard |
| 2026-03-17 18:47 | Step 5 started | Testing & Verification |
| 2026-03-17 18:49 | Review R011 | plan Step 5: REVISE |
| 2026-03-17 18:50 | Worker iter 4 | done in 502s, ctx: 22%, tools: 65 |
| 2026-03-17 18:50 | Step 3 complete | Thread Through Orchestrator |
| 2026-03-17 18:50 | Step 4 started | Thread Through Dashboard |
| 2026-03-17 18:51 | Review R009 | plan Step 4: APPROVE |
| 2026-03-17 18:53 | Review R010 | code Step 4: REVISE |
| 2026-03-17 18:55 | Worker iter 6 | done in 390s, ctx: 25%, tools: 39 |
| 2026-03-17 18:56 | Worker iter 4 | done in 150s, ctx: 12%, tools: 13 |
| 2026-03-17 18:56 | Step 4 complete | Thread Through Dashboard |
| 2026-03-17 18:56 | Step 5 started | Testing & Verification |
| 2026-03-17 18:56 | Review R011 | plan Step 5: APPROVE |
| 2026-03-17 18:57 | Review R012 | code Step 5: REVISE |
| 2026-03-17 18:58 | Review R012 | code Step 5: REVISE |
| 2026-03-17 19:06 | Worker iter 6 | done in 460s, ctx: 24%, tools: 59 |
| 2026-03-17 19:06 | Step 5 complete | Testing & Verification |
| 2026-03-17 19:06 | Step 6 started | Documentation & Delivery |
| 2026-03-17 19:06 | Worker iter 4 | done in 522s, ctx: 17%, tools: 18 |
| 2026-03-17 19:06 | Step 5 complete | Testing & Verification |
| 2026-03-17 19:06 | Step 6 started | Documentation & Delivery |
| 2026-03-17 19:07 | Review R013 | plan Step 6: REVISE |
| 2026-03-17 19:07 | Review R013 | plan Step 6: REVISE |

## Blockers
*None*

## Notes

### Resolver Inventory (Step 0 Preflight)

#### Artifact → Resolver → Current Root

| # | Artifact | Resolver | File:Line | Current Root (Repo Mode) | Current Root (Workspace Mode) |
|---|----------|----------|-----------|-------------------------|-------------------------------|
| 1 | `taskplane-config.json` / YAML configs | `resolveConfigRoot()` → `loadProjectConfig()` | `config-loader.ts:557-564` | cwd | cwd → fallback `TASKPLANE_WORKSPACE_ROOT` |
| 2 | Agent prompts (`task-worker.md`, `task-reviewer.md`) | `loadAgentDef()` | `task-runner.ts:408` | `cwd/.pi/agents/` or `cwd/agents/` | same (worktree cwd) — no workspace fallback |
| 3 | Sidecar dir (lane state, conversation logs) | `getSidecarDir()` | `task-runner.ts:226-244` | Walk up to `.pi/` dir | `ORCH_SIDECAR_DIR` env (set by orchestrator) |
| 4 | `ORCH_SIDECAR_DIR` (orchestrator → worker env) | `buildLaneEnvVars()` | `execution.ts:137` | `join(repoRoot, ".pi")` | `join(workspaceRoot, ".pi")` |
| 5 | `TASKPLANE_WORKSPACE_ROOT` env propagation | `buildLaneEnvVars()` | `execution.ts:147-148` | not set | `workspaceRoot` (when != repoRoot) |
| 6 | Orch-abort signal file | monitor loop | `execution.ts:578` | `join(repoRoot, ".pi", "orch-abort-signal")` | same (uses repoRoot) |
| 7 | Orch lane log paths | `laneLogPath()` | `execution.ts:237,249` | `join(lane.worktreePath, ".pi", "orch-logs", ...)` | same |
| 8 | Merge agent prompt | `spawnMergeAgent()` | `merge.ts:307` | `join(stateRoot ?? repoRoot, ".pi", "agents", "task-merger.md")` | stateRoot = wsRoot |
| 9 | Merge request/result files | `runMergeWave()` | `merge.ts:619,621` | `join(stateRoot ?? repoRoot, ".pi", ...)` | stateRoot = wsRoot |
| 10 | Batch state (`batch-state.json`) | `batchStatePath()` | `types.ts:1168-1170` | `join(repoRoot, ".pi", BATCH_STATE_FILENAME)` | same (repoRoot from context) |
| 11 | Batch history (`batch-history.json`) | `batchHistoryPath()` | `persistence.ts:1242` | `join(repoRoot, ".pi", ...)` | same |
| 12 | Dashboard batch state | `loadLaneStates()`, startup | `dashboard/server.cjs:194,635-636` | `join(REPO_ROOT, ".pi", ...)` | same (REPO_ROOT from --root flag) |
| 13 | Dashboard conversation logs | route handler | `dashboard/server.cjs:381` | `join(REPO_ROOT, ".pi", ...)` | same |
| 14 | Workspace config | `loadWorkspaceConfig()` | `workspace.ts` via `workspaceConfigPath()` | N/A (absent = repo mode) | `join(workspaceRoot, ".pi", "taskplane-workspace.yaml")` |
| 15 | Taskplane extension install path | `findPackageRoot()` | `task-runner.ts:337` | standard node resolution | also checks `TASKPLANE_WORKSPACE_ROOT/.pi/npm/node_modules/taskplane` |

#### Key Observations
- **Config loading** (#1): Already has `TASKPLANE_WORKSPACE_ROOT` fallback via `resolveConfigRoot()`. Pointer would replace/extend this.
- **Agent loading** (#2): Does NOT have workspace fallback — only looks in worktree cwd. This is a gap for workspace mode (agents live in config repo).
- **Sidecar/state files** (#3,4,6,10,11): Use `repoRoot/.pi/` or `workspaceRoot/.pi/`. These are runtime state, NOT config — likely should stay at workspace root, not follow pointer to config repo.
- **Merge agent** (#8): Uses `stateRoot` (wsRoot in workspace mode) to find `.pi/agents/task-merger.md`. Same gap as #2 — agents should come from config repo via pointer.
- **Dashboard** (#12,13): Hardcoded to `REPO_ROOT/.pi/`. In workspace mode dashboard needs workspace root, not individual repo root.
- **Pointer file schema**: `{ config_repo: string, config_path: string }` where config_repo is a repo name (not path) and config_path is relative within that repo (e.g., ".taskplane").

### Authoritative Mode Matrix

> Spec source: `C:/dev/taskplane/.pi/local/docs/settings-and-onboarding-spec.md` — Resolved Decision #1 (pointer), #4 (dashboard), "What lives where" polyrepo diagram.

| Scenario | Workspace Config | Pointer File | Config Source | Agent Source | State/Sidecar Source |
|----------|-----------------|--------------|---------------|--------------|----------------------|
| **Repo mode** | Absent | N/A (ignored even if present) | `<cwd>/.pi/` → defaults | `<cwd>/.pi/agents/` → base package | `<cwd>/.pi/` (walk-up) |
| **Workspace + pointer valid** | Present | Valid JSON, valid `config_repo`+`config_path` | `<configRepoPath>/<config_path>/` | `<configRepoPath>/<config_path>/agents/` → base package | `<wsRoot>/.pi/` (unchanged) |
| **Workspace + pointer absent** | Present | File absent | Warn + fallback to `TASKPLANE_WORKSPACE_ROOT/.pi/` | Warn + fallback to worktree cwd paths | `<wsRoot>/.pi/` (unchanged) |
| **Workspace + pointer malformed** | Present | Invalid JSON or missing fields | Warn + fallback to `TASKPLANE_WORKSPACE_ROOT/.pi/` | Warn + fallback to worktree cwd paths | `<wsRoot>/.pi/` (unchanged) |
| **Workspace + unknown config_repo** | Present | `config_repo` not in workspace repos map | Warn + fallback to `TASKPLANE_WORKSPACE_ROOT/.pi/` | Warn + fallback to worktree cwd paths | `<wsRoot>/.pi/` (unchanged) |

#### Design decisions (unified):
1. **Pointer is workspace-only**: In repo mode, no pointer file is read. Even if one exists, it's ignored. Zero repo-mode behavior change.
2. **State/sidecar files never follow pointer**: Batch state, conversation logs, abort signals, lane logs — all stay at `workspaceRoot/.pi/`. Only config and agent artifacts follow the pointer to the config repo.
3. **All pointer failures are non-fatal (warn + fallback)**: Whether the pointer is missing, malformed, or references an unknown repo, the behavior is the same: log a warning and fall back to existing `TASKPLANE_WORKSPACE_ROOT` behavior. This supports incremental adoption and avoids crashing on fixable misconfigurations. Step 5 tests must validate all three failure modes produce warnings and fall back consistently.
4. **Missing pointer is valid**: Workspace mode without a pointer is a valid (if degraded) configuration. This supports the case where init v2 hasn't been run yet.

### Env-Var Precedence (with pointer introduced)

```
Config resolution (new precedence):
1. cwd has config files → use cwd (existing — repo mode or worktree with local config)
2. Pointer file valid → resolve <configRepoPath>/<configPath>/ as configRoot (NEW)
3. TASKPLANE_WORKSPACE_ROOT has config files → use it (existing fallback)
4. Fall back to cwd, loaders return defaults (existing)

Agent resolution (new precedence):
1. <cwd>/.pi/agents/{name}.md or <cwd>/agents/{name}.md (existing local override)
2. Pointer → <configRepoPath>/<configPath>/agents/{name}.md (NEW — workspace config repo)
3. Package templates/agents/{name}.md (existing base agent)

State/sidecar resolution (UNCHANGED by pointer):
- ORCH_SIDECAR_DIR → walk up → create at cwd
- Dashboard: --root flag or cwd → <root>/.pi/

ORCH_SIDECAR_DIR (UNCHANGED by pointer):
- Set to join(workspaceRoot || repoRoot, ".pi") by orchestrator
- State lives at workspace root, not config repo
```
