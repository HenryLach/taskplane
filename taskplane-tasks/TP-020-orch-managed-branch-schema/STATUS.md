# TP-020: Orch-Managed Branch Schema & Config — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-03-18
**Review Level:** 1
**Review Counter:** 0
**Iteration:** 0
**Size:** M

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Read `types.ts` — locate runtime state, persisted state, config interfaces, defaults
- [ ] Read `config-schema.ts` — understand config field definitions
- [ ] Read `config-loader.ts` — understand camelCase↔snake_case mappings
- [ ] Read `settings-tui.ts` — understand TUI field declarations

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

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
