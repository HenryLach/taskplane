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
**Status:** 🟨 In Progress

- [ ] Read `types.ts` — locate runtime state, persisted state, config interfaces, defaults
- [ ] Read `config-schema.ts` — understand config field definitions
- [ ] Read `config-loader.ts` — understand camelCase↔snake_case mappings and legacy snake_case adapter
- [ ] Read `settings-tui.ts` — understand TUI field declarations
- [ ] Read `persistence.ts` — locate backward-compat defaults for new persisted fields, serialization/deserialization paths
- [ ] Read `settings-tui.test.ts` — scan test coverage for section schema constraints, Advanced discoverability
- [ ] Record preflight discoveries (file+line anchors) in STATUS.md Notes

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

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
