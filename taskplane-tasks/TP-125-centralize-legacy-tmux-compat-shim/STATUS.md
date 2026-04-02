# TP-125: Centralize Legacy TMUX Compatibility Shim — Status

**Current Step:** Step 4: Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-04-02
**Review Level:** 2
**Review Counter:** 5
**Iteration:** 1
**Size:** M

---

### Step 0: Inventory compatibility call sites
**Status:** ✅ Complete
- [x] Identify every remaining runtime call site for TMUX-shaped legacy inputs
- [x] Confirm each site is ingress compatibility only
- [x] Log list in STATUS.md

### Step 1: Introduce compatibility shim module
**Status:** ✅ Complete
- [x] Create `extensions/taskplane/tmux-compat.ts`
- [x] Add config alias normalization helpers
- [x] Add persisted lane alias normalization helpers
- [x] Add spawnMode legacy classification/deprecation helper

### Step 2: Replace scattered compatibility logic
**Status:** ✅ Complete
- [x] Update `config-loader.ts` to use shim helpers
- [x] Update `persistence.ts` normalization to use shim helpers
- [x] Update other ingress paths to use shim helpers
- [x] Keep behavior identical

### Step 3: Tests
**Status:** ✅ Complete
- [x] Add/adjust compatibility tests via shim
- [x] Run full extension suite
- [x] Fix failures

### Step 4: Delivery
**Status:** ✅ Complete
- [x] Record TMUX-reference count delta
- [x] Document exactly which legacy inputs remain supported

---

## Step 0 Inventory Findings

Remaining runtime TMUX-shaped legacy-input handling call sites:

1. `extensions/taskplane/config-loader.ts`
   - `mapOrchestratorYaml`: normalizes legacy `orchestrator.tmuxPrefix` → `orchestrator.sessionPrefix`.
   - `loadJsonConfig`: normalizes legacy `orchestrator.orchestrator.tmuxPrefix` → `sessionPrefix`.
   - `extractAllowlistedPreferences`: normalizes legacy user pref `tmuxPrefix` → `sessionPrefix`; accepts legacy `spawnMode: "tmux"` input.
   - `emitSpawnModeDeprecationWarnings`: classifies `spawnMode: "tmux"` as legacy and emits deprecation messaging.
2. `extensions/taskplane/persistence.ts`
   - state-file lane normalization accepts legacy `lanes[].tmuxSessionName`, validates it, maps to `laneSessionId`, then deletes legacy key.
3. `extensions/taskplane/worktree.ts`
   - `runPreflight` classifies `orchestrator.spawn_mode === "tmux"` for compatibility warning-only preflight output.
4. `extensions/taskplane/extension.ts`
   - `/orch-plan` preflight banner warns when configured `spawn_mode` is legacy `tmux`.
   - startup runtime summary appends `legacy compatibility mode` when configured `spawn_mode` is `tmux`.

Ingress-only confirmation: all identified sites are config/state compatibility normalization or deprecation/warning/reporting. None of them route execution into a tmux backend under Runtime V2.

## Step 4 Delivery Findings

### TMUX-reference count delta (legacy ingress patterns)

Pattern counted: `tmuxPrefix|tmuxSessionName|spawnMode === "tmux"|spawn_mode === "tmux"`

- Pre-centralization (Step 2 baseline `8e15f25`) across ingress runtime files
  (`config-loader.ts`, `persistence.ts`, `worktree.ts`, `extension.ts`): **24** matches
- Post-centralization (HEAD) across the same ingress runtime files: **7** matches
- Net delta in scattered ingress files: **-17**
- Centralized in shim (`extensions/taskplane/tmux-compat.ts`): **15** matches

### Legacy inputs still supported (and where)

1. `orchestrator.tmuxPrefix` (legacy YAML shape) → normalized to `sessionPrefix`
   via `normalizeSessionPrefixAlias` in `config-loader.ts` (`mapOrchestratorYaml`).
2. `orchestrator.orchestrator.tmuxPrefix` (legacy JSON shape) → normalized to `sessionPrefix`
   via `normalizeSessionPrefixAlias` in `config-loader.ts` (`loadJsonConfig`).
3. User preference `tmuxPrefix` → normalized to `sessionPrefix`
   via `resolveSessionPrefixAlias` in `config-loader.ts` (`extractAllowlistedPreferences`).
4. Persisted lane field `lanes[].tmuxSessionName` → normalized to `laneSessionId`
   via `readLaneSessionAliases` + `normalizeLaneSessionAlias` in `persistence.ts`.
5. `spawnMode: "tmux"` / `spawn_mode: "tmux"` (legacy value) remains accepted for
   compatibility, classified as legacy via `classifySpawnModeCompatibility` /
   `isLegacyTmuxSpawnMode`, and reported through deprecation/warning messaging.

## Execution Log

| Timestamp | Action | Outcome |
| 2026-04-02 21:13 | Task started | Runtime V2 lane-runner execution |
| 2026-04-02 21:13 | Step 0 started | Inventory compatibility call sites |
|-----------|--------|---------|
| 2026-04-02 21:15 | Review R001 | plan Step 1: APPROVE |
| 2026-04-02 21:18 | Review R002 | plan Step 2: APPROVE |
| 2026-04-02 21:23 | Review R003 | code Step 2: APPROVE |
| 2026-04-02 21:23 | Review R004 | plan Step 3: APPROVE |
| 2026-04-02 21:29 | Review R005 | code Step 3: APPROVE |
| 2026-04-02 21:31 | Worker iter 1 | done in 1037s, tools: 110 |
| 2026-04-02 21:31 | Task complete | .DONE created |
