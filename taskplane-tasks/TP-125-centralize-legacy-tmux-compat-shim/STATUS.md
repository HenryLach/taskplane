# TP-125: Centralize Legacy TMUX Compatibility Shim — Status

**Current Step:** Step 3: Tests
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-02
**Review Level:** 2
**Review Counter:** 2
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
**Status:** 🟨 In Progress
- [ ] Add/adjust compatibility tests via shim
- [ ] Run full extension suite
- [ ] Fix failures

### Step 4: Delivery
**Status:** ⬜ Not Started
- [ ] Record TMUX-reference count delta
- [ ] Document exactly which legacy inputs remain supported

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

## Execution Log

| Timestamp | Action | Outcome |
| 2026-04-02 21:13 | Task started | Runtime V2 lane-runner execution |
| 2026-04-02 21:13 | Step 0 started | Inventory compatibility call sites |
|-----------|--------|---------|
| 2026-04-02 21:15 | Review R001 | plan Step 1: APPROVE |
| 2026-04-02 21:18 | Review R002 | plan Step 2: APPROVE |
