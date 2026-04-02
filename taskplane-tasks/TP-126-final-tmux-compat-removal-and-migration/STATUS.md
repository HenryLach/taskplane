# TP-126: Final TMUX Compatibility Removal and Migration — Status

**Current Step:** Step 2: Update schema/types/docs/templates
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-02
**Review Level:** 3
**Review Counter:** 2
**Iteration:** 1
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

### Step 2: Update schema/types/docs/templates
**Status:** 🟨 In Progress
- [ ] Update schema/types to canonical non-TMUX contract
- [ ] Update templates/config docs to canonical keys
- [ ] Update command/doctor docs to final no-TMUX contract

### Step 3: Tests and migration coverage
**Status:** ⬜ Not Started
- [ ] Update fixtures using TMUX-era fields
- [ ] Add migration/failure tests for legacy input detection and guidance
- [ ] Run full extension suite
- [ ] Run CLI smoke tests (`help`, `doctor`)

### Step 4: Final verification & delivery
**Status:** ⬜ Not Started
- [ ] Re-run TMUX reference audit and record final counts
- [ ] Confirm no functional TMUX runtime logic remains
- [ ] Publish migration notes in docs and STATUS.md

---

## Notes

- R001 suggestion: keep Step 1 operator guidance consistent by ensuring hard failures include concrete fix hints (`tmuxPrefix` → `sessionPrefix`, `spawn_mode: tmux` → `subprocess`).

## Execution Log

| Timestamp | Action | Outcome |
| 2026-04-02 21:32 | Task started | Runtime V2 lane-runner execution |
| 2026-04-02 21:32 | Step 0 started | Removal plan and migration contract |
| 2026-04-02 21:45 | Step 0 completed | Legacy inputs + migration policy documented in STATUS.md |
| 2026-04-02 21:45 | Step 1 started | Remove remaining compatibility paths |
| 2026-04-02 22:31 | Step 1 tests | Targeted suite passed (`project-config-loader`, `user-preferences`, `monorepo-compat-regression`) |
| 2026-04-02 22:32 | Step 1 completed | Legacy tmuxPrefix/spawn_mode ingress now hard-fails with migration hints; lane tmuxSessionName kept migration-only with warning |
| 2026-04-02 22:32 | Step 2 started | Update schema/types/docs/templates |
|-----------|--------|---------|
| 2026-04-02 21:35 | Review R001 | plan Step 1: REVISE |
| 2026-04-02 21:35 | Review R002 | plan Step 1: APPROVE |
