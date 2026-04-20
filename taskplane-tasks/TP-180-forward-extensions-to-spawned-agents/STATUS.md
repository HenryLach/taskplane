# TP-180: Forward Project and Global Extensions to Spawned Agents — Status

**Current Step:** Step 3: Wire extensions into all three spawn points
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-20
**Review Level:** 2
**Review Counter:** 7
**Iteration:** 1
**Size:** L

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Required files and paths exist
- [x] Dependencies satisfied
- [x] Read `agent-host.ts` to confirm `--no-extensions` + `-e` pattern
- [x] Read all three spawn points to understand current extension wiring

---

### Step 1: Create settings-loader utility
**Status:** ✅ Complete

- [x] Implement `loadPiSettingsPackages(stateRoot)` — project `.pi/settings.json`
- [x] Implement global packages loading from `~/.pi/agent/settings.json`
- [x] Merge: union, deduplicated, project first
- [x] Filter out taskplane packages
- [x] Return `string[]` specifiers or empty array
- [x] Handle missing/malformed files gracefully

---

### Step 2: Add per-agent-type exclusion config
**Status:** ✅ Complete

- [x] Add `excludeExtensions?: string[]` to worker config in schema + types
- [x] Add `excludeExtensions?: string[]` to reviewer config in schema + types
- [x] Add `excludeExtensions?: string[]` to merge config in schema + types
- [x] Update config-loader to load and default `excludeExtensions`
- [x] Implement `filterExcludedExtensions()` in settings-loader

---

### Step 3: Wire extensions into all three spawn points
**Status:** ✅ Complete

- [x] Worker: inject packages into `extensions` array in lane-runner.ts
- [x] Reviewer: thread state root via env for settings resolution, add `-e` flags in agent-bridge-extension.ts
- [x] Merge agent: add `extensions` field to opts in merge.ts
- [x] Thread exclusion config to each spawn point

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
| 2026-04-20 21:41 | Task started | Runtime V2 lane-runner execution |
| 2026-04-20 21:41 | Step 0 started | Preflight |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
| 2026-04-20 21:44 | Review R001 | plan Step 1: APPROVE |
| 2026-04-20 21:46 | Review R002 | code Step 1: APPROVE |
| 2026-04-20 21:48 | Review R003 | plan Step 2: APPROVE |
| 2026-04-20 21:52 | Review R004 | code Step 2: APPROVE |
| 2026-04-20 21:55 | Review R005 | plan Step 3: REVISE |
| 2026-04-20 21:56 | Review R006 | plan Step 3: APPROVE |
| 2026-04-20 22:05 | Review R007 | code Step 3: REVISE |
