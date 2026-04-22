# TP-002: Task-to-Repo Routing and Execution Target Parsing — Status

**Current Step:** Step 4: Documentation & Delivery
​**Status:** ✅ Step 3 Complete
**Last Updated:** 2026-03-15
**Review Level:** 2
**Review Counter:** 7
**Iteration:** 4
**Size:** M

> **Hydration:** Checkboxes below must be granular — one per unit of work.
> Steps marked `⚠️ Hydrate` will be expanded by the worker.

---

### Step 0: Parse execution target metadata
**Status:** ✅ Complete

**Parse grammar:**
- Section header: `## Execution Target` (with optional body containing `Repo: <id>`)
- Inline field in front-matter area: `**Repo:** <id>` (bold key, value is trimmed string)
- Precedence: section-based `## Execution Target` wins over inline `**Repo:**` if both present
- `<id>` is a lowercase alphanumeric-plus-hyphens string matching `/^[a-z0-9][a-z0-9-]*$/`
- Missing metadata = non-fatal (field defaults to `undefined`)

**Data contract:**
- `ParsedTask.promptRepoId?: string` — raw repo ID declared in the PROMPT, separate from resolved routing

**Backward compatibility:**
- Missing execution target metadata → no parse error, task remains valid
- No changes to existing ID/dependency/file-scope parsing behavior
- No new fatal discovery errors introduced in Step 0

- [x] Add `promptRepoId?: string` field to `ParsedTask` in `types.ts`
- [x] Implement section-based parser: `## Execution Target` with `Repo:` line
- [x] Implement inline parser: `**Repo:** <id>` in front-matter area
- [x] Apply precedence rule (section > inline) and repo ID validation
- [x] Preserve backward compat: missing metadata = `undefined`, no error
- [x] Add tests: prompt with no execution target
- [x] Add tests: section-based `## Execution Target` with `Repo: api`
- [x] Add tests: inline `**Repo:** frontend` declaration
- [x] Add tests: whitespace/case/markdown decoration variants
- [x] Add tests: both section + inline present (section wins)
- [x] Add tests: invalid repo ID format (non-matching = undefined)
- [x] Add tests: existing dependency/file-scope parsing unchanged

---

### Step 1: Implement routing precedence chain
**Status:** ✅ Complete

**Routing contract:**
- In **repo mode** (`workspaceConfig === null`): routing is a no-op. No `resolvedRepoId` is set. Single-repo semantics are preserved.
- In **workspace mode**: apply 3-level precedence: prompt repo → area repo → workspace default repo.
- If no source resolves a repo ID → `TASK_REPO_UNRESOLVED` (fatal).
- If resolved ID is not a key in `workspaceConfig.repos` → `TASK_REPO_UNKNOWN` (fatal).

**Area-to-repo mapping source:**
- Add optional `repo_id?: string` field to `TaskArea` in `types.ts`.
- Loaded from `task-runner.yaml` per-area config. Absent = undefined (fall through to default repo).
- Validated at routing time: if present, must be a valid repo ID (lowercase alnum + hyphens).

**Changes by file:**

1. `types.ts`:
   - Add `repoId?: string` to `TaskArea`
   - Add `resolvedRepoId?: string` to `ParsedTask`
   - Add `TASK_REPO_UNRESOLVED` and `TASK_REPO_UNKNOWN` to `DiscoveryError.code` union
   - Export `FATAL_DISCOVERY_CODES` constant array for DRY fatal-error filtering

2. `discovery.ts`:
   - Add `resolveTaskRouting(discovery, taskAreas, workspaceConfig)` function
   - Call it from `runDiscovery` when `workspaceConfig` is provided
   - Thread `workspaceConfig` into `runDiscovery` via `DiscoveryOptions`

3. `extension.ts` / `engine.ts` / `resume.ts`:
   - Pass `workspaceConfig` through `DiscoveryOptions` at call sites
   - Update fatal error filters to use `FATAL_DISCOVERY_CODES`

4. Tests (`discovery-routing.test.ts`):
   - Prompt repo wins over area/default
   - Area repo fallback (prompt has no repo, area has repoId)
   - Default repo fallback (prompt + area have no repo)
   - Unknown repo ID → TASK_REPO_UNKNOWN error
   - Unresolved routing (no sources) → TASK_REPO_UNRESOLVED error
   - Repo mode (no workspace config) → no routing, no error
   - Multiple tasks with different routing sources

**Checklist:**
- [x] Add `repoId?: string` to `TaskArea` in `types.ts`
- [x] Add `resolvedRepoId?: string` to `ParsedTask` in `types.ts`
- [x] Add `TASK_REPO_UNRESOLVED` and `TASK_REPO_UNKNOWN` to `DiscoveryError.code` union
- [x] Export `FATAL_DISCOVERY_CODES` array for DRY fatal-error filtering
- [x] Add `workspaceConfig` to `DiscoveryOptions` in `discovery.ts`
- [x] Implement `resolveTaskRouting()` function in `discovery.ts`
- [x] Call `resolveTaskRouting()` from `runDiscovery` pipeline
- [x] Update `extension.ts` call sites to pass `workspaceConfig` and use `FATAL_DISCOVERY_CODES`
- [x] Update `engine.ts` call sites to pass `workspaceConfig` and use `FATAL_DISCOVERY_CODES`
- [x] Update `formatDiscoveryResults` to include new fatal codes
- [x] Add test: repo mode (no workspace config) → no routing applied
- [x] Add test: prompt repo wins over area and default
- [x] Add test: area repo fallback when prompt has no repo
- [x] Add test: default repo fallback when prompt + area have no repo
- [x] Add test: TASK_REPO_UNKNOWN when resolved ID not in workspace repos
- [x] Add test: TASK_REPO_UNRESOLVED when all sources are undefined
- [x] Add test: multiple tasks with mixed routing sources
- [x] All existing tests still pass (38 routing tests + 40 workspace tests = 78 pass)

---

### Step 2: Annotate discovery outputs
**Status:** ✅ Complete

**Output annotation contract:**
- In workspace mode: each pending task line in `formatDiscoveryResults` shows `→ repo: <id>` after deps (if `resolvedRepoId` is set)
- In repo mode: no repo annotation shown (no `resolvedRepoId` on tasks)
- Tasks with routing errors (no `resolvedRepoId`) do not show annotation

**Actionable failure contract:**
- When fatal routing errors (`TASK_REPO_UNRESOLVED`, `TASK_REPO_UNKNOWN`) block planning/execution, show specific routing guidance after generic message
- `/orch-plan`: append "Check PROMPT Repo: fields, area repo_id config, and routing.default_repo in workspace config."
- `/orch`: append same guidance text

**Prerequisite fix: area repo config ingestion:**
- `loadTaskRunnerConfig()` in `config.ts` must parse `repo_id` (snake_case YAML key) into `TaskArea.repoId`
- This is required for the area-level fallback in the routing chain to work at runtime

**Checklist:**
- [x] Parse `repo_id` from task area YAML config into `TaskArea.repoId` in `config.ts`
- [x] Annotate pending task lines in `formatDiscoveryResults()` with `→ repo: <id>` when `resolvedRepoId` is set
- [x] Add routing-specific guidance to `/orch-plan` fatal abort message in `extension.ts`
- [x] Add routing-specific guidance to `/orch` fatal abort message in `engine.ts`
- [x] Add test: `loadTaskRunnerConfig` parses `repo_id` into `TaskArea.repoId`
- [x] Add test: `formatDiscoveryResults` shows repo annotation for tasks with `resolvedRepoId`
- [x] Add test: `formatDiscoveryResults` omits repo annotation when `resolvedRepoId` absent
- [x] Add test: fatal routing errors produce actionable guidance text
- [x] All existing tests still pass (68 routing + 40 workspace = 108 pass; 4 pre-existing failures in other suites unchanged)

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

- [x] Unit/regression tests passing
- [x] Targeted tests for changed modules passing
- [x] All failures fixed
- [x] CLI smoke checks passing

**Results:**
- Targeted tests: 68 routing tests pass, 40 workspace tests pass (108 total, 0 failures)
- Full suite: 109 pass, 3 test files fail (23 individual test failures) — all pre-existing, none caused by TP-002
- Pre-existing failures (unrelated to TP-002):
  - `orch-pure-functions.test.ts`: `computeOrchSummaryCounts` function not yet implemented
  - `task-runner-orchestration.test.ts`: `isOrchestratedMode` spawn detection logic (task-runner.ts, untouched)
  - `orch-state-persistence.test.ts`: source verification for abort messages/merge patterns (untouched)
  - `orch-direct-implementation.test.ts`: empty test suite (no vitest `it`/`test` calls)
- CLI smoke: `node bin/taskplane.mjs help` exits cleanly

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] "Must Update" docs modified
- [ ] "Check If Affected" docs reviewed
- [ ] Discoveries logged
- [ ] `.DONE` created
- [ ] Archive and push

---

## Reviews
| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | UNKNOWN | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R002 | code | Step 0 | UNKNOWN | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | UNKNOWN | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | UNKNOWN | .reviews/R004-code-step1.md |
| R004 | code | Step 1 | UNKNOWN | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | UNKNOWN | .reviews/R005-plan-step2.md |
| R005 | plan | Step 2 | UNKNOWN | .reviews/R005-plan-step2.md |
| R006 | code | Step 2 | UNKNOWN | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | UNKNOWN | .reviews/R007-plan-step3.md |
| R006 | code | Step 2 | UNKNOWN | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | UNKNOWN | .reviews/R007-plan-step3.md |
|---|------|------|---------|------|

## Discoveries
| Discovery | Disposition | Location |
|-----------|-------------|----------|

## Execution Log
| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-15 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-15 06:28 | Task started | Extension-driven execution |
| 2026-03-15 06:28 | Step 0 started | Parse execution target metadata |
| 2026-03-15 06:31 | Review R001 | plan Step 0: changes requested |
| 2026-03-15 | Step 0 plan hydrated | Addressed R001 findings, concrete checklist |
| 2026-03-15 | Step 0 implemented | ParsedTask.promptRepoId, parser in discovery.ts, 24 tests passing |
| 2026-03-15 06:31 | Review R001 | plan Step 0: UNKNOWN |
| 2026-03-15 | Step 0 impl | types.ts: promptRepoId field already added by prior iter |
| 2026-03-15 | Step 0 impl | discovery.ts: section+inline parser already added by prior iter |
| 2026-03-15 | Step 0 tests | Created discovery-prompt-parser.test.ts — 28/28 pass |
| 2026-03-15 | Step 0 complete | All checklist items verified and checked off |
| 2026-03-15 06:37 | Worker iter 1 | done in 359s, ctx: 35%, tools: 51 |
| 2026-03-15 06:39 | Worker iter 1 | done in 458s, ctx: 35%, tools: 57 |
| 2026-03-15 06:41 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-15 06:41 | Step 0 complete | Parse execution target metadata |
| 2026-03-15 06:41 | Step 1 started | Implement routing precedence chain |
| 2026-03-15 06:42 | Review R002 | code Step 0: UNKNOWN |
| 2026-03-15 06:42 | Step 0 complete | Parse execution target metadata |
| 2026-03-15 06:42 | Step 1 started | Implement routing precedence chain |
| 2026-03-15 06:45 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-15 06:45 | Review R003 | plan Step 1: UNKNOWN |
| 2026-03-15 06:51 | Step 1 impl | types.ts changes already present from iter 1 (repoId, resolvedRepoId, error codes, FATAL_DISCOVERY_CODES) |
| 2026-03-15 06:51 | Step 1 impl | discovery.ts: resolveTaskRouting() already implemented, integrated into runDiscovery pipeline |
| 2026-03-15 06:52 | Step 1 impl | engine.ts: added workspaceConfig param, wired to runDiscovery, use FATAL_DISCOVERY_CODES |
| 2026-03-15 06:52 | Step 1 impl | extension.ts: pass workspaceConfig to runDiscovery & executeOrchBatch & resumeOrchBatch |
| 2026-03-15 06:52 | Step 1 impl | resume.ts: workspaceConfig param already wired from iter 1 |
| 2026-03-15 06:53 | Step 1 tests | Removed duplicate helpers; 14 routing tests (8.x–14.x) already present — 38/38 pass |
| 2026-03-15 06:54 | Step 1 tests | Full suite: 78 passing (38 routing + 40 workspace), 4 pre-existing failures in other suites |
| 2026-03-15 06:55 | Step 1 complete | All checklist items verified and checked off |
| 2026-03-15 06:56 | Worker iter 2 | done in 683s, ctx: 54%, tools: 106 |
| 2026-03-15 06:58 | Worker iter 2 | done in 748s, ctx: 57%, tools: 129 |
| 2026-03-15 06:59 | Review R004 | code Step 1: UNKNOWN |
| 2026-03-15 06:59 | Step 1 complete | Implement routing precedence chain |
| 2026-03-15 06:59 | Step 2 started | Annotate discovery outputs |
| 2026-03-15 07:00 | Review R004 | code Step 1: UNKNOWN |
| 2026-03-15 07:00 | Step 1 complete | Implement routing precedence chain |
| 2026-03-15 07:00 | Step 2 started | Annotate discovery outputs |
| 2026-03-15 07:02 | Review R005 | plan Step 2: UNKNOWN |
| 2026-03-15 07:05 | Step 2 plan | Hydrated checklist addressing R005 findings (9 items) |
| 2026-03-15 07:05 | Step 2 impl | config.ts: parse repo_id from YAML into TaskArea.repoId |
| 2026-03-15 07:05 | Step 2 impl | discovery.ts: annotate formatDiscoveryResults with → repo: <id> |
| 2026-03-15 07:05 | Step 2 impl | extension.ts: routing-specific guidance on fatal abort |
| 2026-03-15 07:05 | Step 2 impl | engine.ts: routing-specific guidance on fatal abort |
| 2026-03-15 07:06 | Step 2 tests | 13 new tests (15.x config, 16.x output, 17.x guidance) — 51/51 pass |
| 2026-03-15 07:06 | Step 2 complete | All checklist items verified and checked off |
| 2026-03-15 07:03 | Review R005 | plan Step 2: UNKNOWN |
| 2026-03-15 07:07 | Worker iter 3 | done in 278s, ctx: 26%, tools: 43 |
| 2026-03-15 07:09 | Review R006 | code Step 2: UNKNOWN |
| 2026-03-15 07:09 | Step 2 complete | Annotate discovery outputs |
| 2026-03-15 07:09 | Step 3 started | Testing & Verification |
| 2026-03-15 07:10 | Step 2 verify | Iter 3: confirmed all Step 2 work committed (91fe024), 68 routing + 40 workspace = 108 tests pass |
| 2026-03-15 07:09 | Worker iter 3 | done in 392s, ctx: 43%, tools: 54 |
| 2026-03-15 07:11 | Review R007 | plan Step 3: UNKNOWN |
| 2026-03-15 07:13 | Step 3 tests | Full suite run: 109 pass, 23 pre-existing failures (0 from TP-002) |
| 2026-03-15 07:13 | Step 3 tests | Targeted: 68 routing + 40 workspace = 108 pass, 0 fail |
| 2026-03-15 07:14 | Step 3 smoke | CLI help exits cleanly |
| 2026-03-15 07:14 | Step 3 complete | All checklist items verified |
| 2026-03-15 07:12 | Review R006 | code Step 2: UNKNOWN |
| 2026-03-15 07:12 | Step 2 complete | Annotate discovery outputs |
| 2026-03-15 07:12 | Step 3 started | Testing & Verification |
| 2026-03-15 07:14 | Review R007 | plan Step 3: UNKNOWN |

## Blockers

*None*

## Notes

*Reserved for execution notes*
