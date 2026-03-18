# TP-020: Orch-Managed Branch Schema & Config — Status

**Current Step:** Step 0: Preflight
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-18
**Review Level:** 1
**Review Counter:** 1
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read `types.ts` — locate runtime state, persisted state, config interfaces, defaults
- [x] Read `config-schema.ts` — understand config field definitions
- [x] Read `config-loader.ts` — understand camelCase↔snake_case mappings and legacy snake_case adapter
- [x] Read `settings-tui.ts` — understand TUI field declarations
- [x] Read `persistence.ts` — locate backward-compat defaults for new persisted fields, serialization/deserialization paths
- [x] Read `settings-tui.test.ts` — scan test coverage for section schema constraints, Advanced discoverability
- [x] Record preflight discoveries (file+line anchors) in STATUS.md Notes

---

### Step 1: Add `orchBranch` to Runtime + Persisted State
**Status:** ⬜ Not Started

- [ ] Add `orchBranch` to `OrchBatchRuntimeState` and `PersistedBatchState`
- [ ] Initialize to `""` in `freshOrchBatchState()`
- [ ] Update `persistence.ts` serialization/deserialization with backward compat

---

### Step 2: Add `integration` to Orchestrator Config
**Status:** ⬜ Not Started

- [ ] Add `integration` to config interface and defaults in `types.ts`
- [ ] Add to `config-schema.ts` validation
- [ ] Add camelCase↔snake_case mapping in `config-loader.ts`

---

### Step 3: Add Integration Toggle to Settings TUI
**Status:** ⬜ Not Started

- [ ] Add Integration toggle to Orchestrator section in `settings-tui.ts`

---

### Step 4: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Unit tests passing
- [ ] Schema defaults verified
- [ ] Settings TUI tests passing
- [ ] All failures fixed

---

### Step 5: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Discoveries logged
- [ ] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | APPROVE | .reviews/R001-plan-step0.md |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-18 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-18 03:23 | Task started | Extension-driven execution |
| 2026-03-18 03:23 | Step 0 started | Preflight |
| 2026-03-18 03:23 | Task started | Extension-driven execution |
| 2026-03-18 03:23 | Step 0 started | Preflight |
| 2026-03-18 03:24 | Review R001 | plan Step 0: REVISE |
| 2026-03-18 03:26 | Review R001 | plan Step 0: APPROVE |

---

## Blockers

*None*

---

## Notes

### Preflight Discoveries (file+line anchors)

**types.ts:**
- `OrchBatchRuntimeState` — ~line 530. Add `orchBranch: string` after `baseBranch`.
- `PersistedBatchState` — ~line 900. Add `orchBranch: string` after `baseBranch`.
- `freshOrchBatchState()` — ~line 565. Add `orchBranch: ""` after `baseBranch: ""`.
- `OrchestratorConfig` (legacy snake_case) — ~line 11. Add `integration: "manual" | "auto"` to `orchestrator` sub-object.
- `DEFAULT_ORCHESTRATOR_CONFIG` — ~line 133. Add `integration: "manual"` to `orchestrator` sub-object.

**config-schema.ts:**
- `OrchestratorCoreConfig` — ~line 195. Add `integration: "manual" | "auto"` field.
- `DEFAULT_ORCHESTRATOR_SECTION` — ~line 360. Add `integration: "manual"` to `orchestrator` sub-object.

**config-loader.ts:**
- `toOrchestratorConfig()` — ~line 430. Add `integration: o.orchestrator.integration` mapping.
- `mapOrchestratorYaml()` uses `convertStructuralKeys()` for `orchestrator` section — `integration` has no underscore, auto-maps to itself. No special handling needed.

**persistence.ts:**
- `serializeBatchState()` — ~line 796. Add `orchBranch: state.orchBranch` to the persisted object assembly.
- `validatePersistedState()` — ~line 370. Add optional `orchBranch` string validation like `baseBranch` pattern. Default to `""` if missing (backward compat).
- No schema version bump needed — `orchBranch` is an optional string field within v2, defaults to `""` when absent.

**settings-tui.ts:**
- `SECTIONS[0]` (Orchestrator) — ~line 100. Add Integration toggle field after `operatorId`.
- `COVERED_PATHS` is auto-built from `SECTIONS` fields, so adding the field definition is sufficient.

**settings-tui.test.ts:**
- Test 12.3 (~line 531): validates all editable sections have ≥1 field — passes automatically.
- Test 18.2 (~line 1423): validates editable fields NOT in Advanced. New `integration` field will be editable, so covered automatically.
- Test 18.8 (~line 1509): every editable section field excluded from Advanced — auto-covered by COVERED_PATHS rebuild.
- Key concern: tests that snapshot exact field counts or section sizes may break if hardcoded.
