# TP-140: Global Preferences Architecture — Status

**Current Step:** Step 1: Rename user preferences → global preferences
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-05
**Review Level:** 2
**Review Counter:** 0
**Iteration:** 1
**Size:** L

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read PROMPT.md and STATUS.md
- [x] Read config-loader.ts merge chain
- [x] Read config-schema.ts UserPreferences and defaults
- [x] Read settings-tui.ts source detection and save logic
- [x] Map all UserPreferences references across codebase

### Step 1: Rename user preferences → global preferences
**Status:** 🟨 In Progress
- [ ] Rename UserPreferences → GlobalPreferences
- [ ] Rename load/resolve/apply functions
- [ ] Update all imports and references
- [ ] Update variable names, comments, JSDoc
- [ ] Run targeted tests

### Step 2: Expand global preferences schema
**Status:** ⬜ Not Started
- [ ] Expand GlobalPreferences to cover all configurable fields
- [ ] Update extractAllowlistedPreferences for expanded fields
- [ ] Update applyGlobalPreferences for all new fields

### Step 3: Flip config loading precedence
**Status:** ⬜ Not Started
- [ ] Rewrite loadProjectConfig: schema → global → project
- [ ] Implement deep merge for sparse project config
- [ ] Update loadLayer1Config similarly
- [ ] Update tests for new precedence

### Step 4: Settings TUI — source badges and save behavior
**Status:** ⬜ Not Started
- [ ] Source badges: (global) and (project) only
- [ ] Default save: global preferences
- [ ] Sparse write for project overrides
- [ ] "Remove project override" option
- [ ] Update field layers

### Step 5: Sparse project config in taskplane init
**Status:** ⬜ Not Started
- [ ] generateProjectConfig writes only project-specific fields
- [ ] Agent settings NOT included
- [ ] Existing full configs continue working

### Step 6: Testing & Verification
**Status:** ⬜ Not Started
- [ ] Full test suite passing
- [ ] Sparse config merge tests
- [ ] Precedence tests
- [ ] Settings TUI tests
- [ ] CLI smoke tests
- [ ] All failures fixed

### Step 7: Documentation & Delivery
**Status:** ⬜ Not Started
- [ ] Update config docs
- [ ] Update settings docs
- [ ] Rename "user preferences" in all docs
- [ ] Update STATUS.md

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
| 2026-04-05 | Task staged | PROMPT.md and STATUS.md created |
| 2026-04-05 22:05 | Task started | Runtime V2 lane-runner execution |
| 2026-04-05 22:05 | Step 0 started | Preflight |

---

## Blockers

*None*

---

## Notes

*Reserved for execution notes*
