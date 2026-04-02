# TP-126: Final TMUX Compatibility Removal and Migration — Status

**Current Step:** Step 4: Final verification & delivery
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-02
**Review Level:** 3
**Review Counter:** 8
**Iteration:** 2
**Size:** L

---

### Step 0: Removal plan and migration contract
**Status:** ✅ Complete
- [x] Define exact legacy inputs to retire
- [x] Choose migration policy per input (normalize/error/grace period)
- [x] Document policy in STATUS.md before code changes

#### Step 0 Working Notes (legacy input inventory)
- `orchestrator.orchestrator.tmuxPrefix` alias ingress in JSON config loading (`loadJsonConfig()` in `config-loader.ts`).
- `tmuxPrefix` alias ingress in user preferences extraction (`extractAllowlistedPreferences()` in `config-loader.ts`).
- `lanes[].tmuxSessionName` ingress in persisted state validation/normalization (`validateBatchStateShape()` in `persistence.ts`).
- `spawn_mode: "tmux"` acceptance in config/preferences/task-runner adapters via compatibility classifier + union types (`config-loader.ts`, `config-schema.ts`, `types.ts`, and `tmux-compat.ts`).

#### Step 0 Working Notes (migration policy decisions)
- `tmuxPrefix` (project config + user preferences): **hard error with fix hint**. Do not alias silently. Error must name replacement key (`sessionPrefix`).
- `lanes[].tmuxSessionName` in persisted state: **one-release migration grace**. Accept only for migration path with explicit warning + normalize to `laneSessionId` in memory, then persist canonical field on next write.
- `spawn_mode: "tmux"` (orchestrator/task-runner/user preferences): **hard error with fix hint**. Runtime V2 contract is subprocess-only; reject `tmux` deterministically and point to `subprocess`.

### Step 1: Remove remaining compatibility paths
**Status:** ✅ Complete
- [x] Remove/retire `tmuxPrefix` config alias handling
- [x] Remove/retire `tmuxSessionName` persisted-lane ingress handling
- [x] [R001] Preserve one-release migration-only handling for `lanes[].tmuxSessionName` (warn + normalize to `laneSessionId` + canonical rewrite on save)
- [x] Remove/retire `spawnMode: "tmux"` acceptance paths
- [x] Keep explicit migration guidance in errors/warnings
- [x] [R003] Enforce hard failure in `/task` config loading for `CONFIG_LEGACY_FIELD` (no silent fallback to defaults) and add regression tests

### Step 2: Update schema/types/docs/templates
**Status:** ✅ Complete
- [x] Update schema/types to canonical non-TMUX contract
- [x] Align settings/UI metadata with no-TMUX schema values
- [x] Update templates/config docs to canonical keys
- [x] Update command/doctor docs to final no-TMUX contract
- [x] [R006] Update `taskplane init` scaffolding to emit canonical subprocess/session-prefix fields only and add CLI regression coverage

### Step 3: Tests and migration coverage
**Status:** ✅ Complete
- [x] Update fixtures using TMUX-era fields
- [x] Add migration/failure tests for legacy input detection and guidance
- [x] Run full extension suite
- [x] Run CLI smoke tests (`help`, `doctor`)

### Step 4: Final verification & delivery
**Status:** 🟨 In Progress
- [ ] Re-run TMUX reference audit and record final counts
- [ ] Confirm no functional TMUX runtime logic remains
- [ ] Publish migration notes in docs and STATUS.md

---

## Notes

- R001 suggestion: keep Step 1 operator guidance consistent by ensuring hard failures include concrete fix hints (`tmuxPrefix` → `sessionPrefix`, `spawn_mode: tmux` → `subprocess`).
- R003 suggestion: in Step 2, align settings/UI metadata that still advertises TMUX options so users are not encouraged to set invalid values.
- R006 suggestion: docs `commands.md` settings-section wording should reflect Worker-level spawn mode control (not Orchestrator-level).

## Execution Log

| Timestamp | Action | Outcome |
| 2026-04-02 21:32 | Task started | Runtime V2 lane-runner execution |
| 2026-04-02 21:32 | Step 0 started | Removal plan and migration contract |
| 2026-04-02 21:45 | Step 0 completed | Legacy inputs + migration policy documented in STATUS.md |
| 2026-04-02 21:45 | Step 1 started | Remove remaining compatibility paths |
| 2026-04-02 22:31 | Step 1 tests | Targeted suite passed (`project-config-loader`, `user-preferences`, `monorepo-compat-regression`) |
| 2026-04-02 22:32 | Step 1 completed | Legacy tmuxPrefix/spawn_mode ingress now hard-fails with migration hints; lane tmuxSessionName kept migration-only with warning |
| 2026-04-02 22:32 | Step 2 started | Update schema/types/docs/templates |
| 2026-04-02 22:34 | ⚠️ Review R003 (code, Step 1) | REVISE: `/task` loadConfig swallows CONFIG_LEGACY_FIELD via silent defaults fallback |
| 2026-04-02 22:38 | R003 fix + tests | Updated `/task` loadConfig to rethrow CONFIG_LEGACY_FIELD; targeted tests re-run and passing |
| 2026-04-02 22:38 | Step 1 re-completed | Code-review revision items resolved |
| 2026-04-02 22:38 | Step 2 started | Update schema/types/docs/templates |
| 2026-04-02 22:50 | Step 2 tests | Targeted suites passed (`settings-tui`, `project-config-loader`, `user-preferences`, `tmux-compat`, `monorepo-compat-regression`) |
| 2026-04-02 22:50 | Step 2 completed | Schema/types/settings metadata and config/command docs updated to subprocess-only contract |
| 2026-04-02 22:50 | Step 3 started | Tests and migration coverage |
| 2026-04-02 22:52 | ⚠️ Review R006 (code, Step 2) | REVISE: init scaffolding still emits TMUX-era keys/values inconsistent with no-TMUX contract |
| 2026-04-02 23:26 | R006 fix + tests | Updated `taskplane init` scaffolding to canonical `session_prefix`/`sessionPrefix` + subprocess-only defaults; targeted `init-mode-detection.integration` suite passed |
| 2026-04-02 23:41 | Step 3 fixture/test updates | Updated TMUX-era fixtures to subprocess defaults and added init scaffolding migration-failure regression coverage |
| 2026-04-02 23:44 | Step 3 targeted tests | Passed targeted suites (`init-mode-detection.integration`, `merge-repo-scoped`, `workspace-config.integration`, `worktree-lifecycle.integration`) |
| 2026-04-02 23:59 | Step 3 full suite | Full `extensions/tests/*.test.ts` suite passed (3400 pass / 0 fail) |
| 2026-04-03 00:00 | Step 3 CLI smoke | Ran `node bin/taskplane.mjs help` and `doctor`; doctor reported expected missing local `.pi` files in lane root |
| 2026-04-03 00:00 | Step 3 completed | Migration coverage complete; proceeding to final verification/delivery |
|-----------|--------|---------|
| 2026-04-02 21:35 | Review R001 | plan Step 1: REVISE |
| 2026-04-02 21:35 | Review R002 | plan Step 1: APPROVE |
| 2026-04-02 21:46 | Review R003 | code Step 1: REVISE |
| 2026-04-02 21:49 | Review R004 | code Step 1: APPROVE |
| 2026-04-02 21:50 | Review R005 | plan Step 2: APPROVE |
| 2026-04-02 22:01 | Review R006 | code Step 2: REVISE |
| 2026-04-02 22:02 | Worker iter 1 | killed (wall-clock timeout) in 1800s, tools: 224 |
| 2026-04-02 22:08 | Review R007 | code Step 2: APPROVE |
| 2026-04-02 22:08 | Review R008 | plan Step 3: APPROVE |
