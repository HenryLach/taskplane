# TP-180: Forward Project and Global Extensions to Spawned Agents — Status

**Current Step:** Not Started
**Status:** 🔵 Ready for Execution
**Last Updated:** 2026-04-20
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 0
**Size:** L

---

### Step 0: Preflight
**Status:** ⬜ Not Started

- [ ] Required files and paths exist
- [ ] Dependencies satisfied
- [ ] Read `agent-host.ts` to confirm `--no-extensions` + `-e` pattern
- [ ] Read all three spawn points to understand current extension wiring

---

### Step 1: Create settings-loader utility
**Status:** ⬜ Not Started

- [ ] Implement `loadPiSettingsPackages(stateRoot)` — project `.pi/settings.json`
- [ ] Implement global packages loading from `~/.pi/agent/settings.json`
- [ ] Merge: union, deduplicated, project first
- [ ] Filter out taskplane packages
- [ ] Return `string[]` specifiers or empty array
- [ ] Handle missing/malformed files gracefully

---

### Step 2: Add per-agent-type exclusion config
**Status:** ⬜ Not Started

- [ ] Add `excludeExtensions?: string[]` to worker config in schema + types
- [ ] Add `excludeExtensions?: string[]` to reviewer config in schema + types
- [ ] Add `excludeExtensions?: string[]` to merge config in schema + types
- [ ] Update config-loader to load and default `excludeExtensions`
- [ ] Implement `filterExcludedExtensions()` in settings-loader

---

### Step 3: Wire extensions into all three spawn points
**Status:** ⬜ Not Started

- [ ] Worker: inject packages into `extensions` array in lane-runner.ts
- [ ] Reviewer: add `-e` flags to spawn args in agent-bridge-extension.ts
- [ ] Merge agent: add `extensions` field to opts in merge.ts
- [ ] Thread exclusion config to each spawn point

---

### Step 4: Add Settings TUI submenu
**Status:** ⬜ Not Started

- [ ] Discover installed packages via `loadPiSettingsPackages()`
- [ ] Display toggle list per agent type (Worker, Reviewer, Merger)
- [ ] Toggle off → add to `excludeExtensions`; toggle on → remove
- [ ] Save to `taskplane-config.json`
- [ ] Follow existing settings-tui save/reload patterns

---

### Step 5: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Create `settings-loader.test.ts` with project, global, merge, filter tests
- [ ] Create `extension-forwarding.test.ts` with spawn arg validation tests
- [ ] Run FULL test suite
- [ ] Fix all failures

---

### Step 6: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] Update `docs/how-to/configure-task-runner.md`
- [ ] Check `docs/reference/commands.md` for settings section
- [ ] Discoveries logged in STATUS.md

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
| 2026-04-20 | Task staged | PROMPT.md and STATUS.md created |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
