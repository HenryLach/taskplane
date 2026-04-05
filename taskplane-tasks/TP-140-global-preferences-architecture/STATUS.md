# TP-140: Global Preferences Architecture — Status

**Current Step:** Step 6: Testing & Verification
**Status:** 🟡 In Progress
**Last Updated:** 2026-04-05
**Review Level:** 2
**Review Counter:** 18
**Iteration:** 2
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
**Status:** ✅ Complete
- [x] Rename UserPreferences → GlobalPreferences
- [x] Rename load/resolve/apply functions
- [x] Update all imports and references
- [x] Update variable names, comments, JSDoc
- [x] Run targeted tests

### Step 2: Expand global preferences schema
**Status:** ✅ Complete
- [x] Expand GlobalPreferences to cover all configurable fields
- [x] Add backward-compatible support for legacy flat-key global preferences files
- [x] Preserve preferences-only fields (dashboardPort, initAgentDefaults) during schema expansion
- [x] Update extractAllowlistedPreferences for expanded fields
- [x] Update applyGlobalPreferences for all new fields
- [x] Add targeted tests for legacy flat keys + expanded nested preference parsing
- [x] Normalize nested legacy spawnMode values (tmux → subprocess) during global preference application
- [x] Add regression tests for nested orchestrator/worker spawnMode migration and update stale migration comment

### Step 3: Flip config loading precedence
**Status:** ✅ Complete
- [x] Rewrite loadProjectConfig: schema → global → project
- [x] Implement deep merge for sparse project config
- [x] Update loadLayer1Config similarly
- [x] Update tests for new precedence

### Step 4: Settings TUI — source badges and save behavior
**Status:** ✅ Complete
- [x] Source badges: (global) and (project) only
- [x] Default save: global preferences
- [x] Sparse write for project overrides
- [x] "Remove project override" option
- [x] Update field layers
- [x] Treat destination-picker cancel/escape as skip (no write)
- [x] Add tests for cancel semantics and resolveWriteAction remove-project route
- [x] Preserve existing YAML project overrides when first project JSON override is written
- [x] Add regression tests for YAML-only write/remove-project compatibility
- [x] Seed first project JSON write from canonical loader YAML overrides (including supervisor/verification/qualityGate/modelFallback/workspace)
- [x] Add regression tests for preserving non-source-detection YAML keys and workspace YAML on first write

### Step 5: Sparse project config in taskplane init
**Status:** ✅ Complete
- [x] generateProjectConfig writes only project-specific fields
- [x] Agent settings NOT included
- [x] Persist only explicit init-time orchestrator overrides (non-default/user-chosen values)
- [x] Existing full configs continue working
- [x] Update init integration tests to sparse orchestrator contract and preserve legacy migration coverage

### Step 6: Testing & Verification
**Status:** ✅ Complete
- [x] Full test suite passing
- [x] Sparse config merge tests
- [x] Precedence tests
- [x] Settings TUI tests
- [x] CLI smoke tests
- [x] All failures fixed

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
| 2026-04-05 23:08 | Worker iter 1 | done in 3736s, tools: 329 |

---

## Blockers

*None*

---

## Notes

- Suggestion (R003): consider modeling GlobalPreferences as config deep-partial + preferences-only extension to reduce schema drift.
- Suggestion (R003): keep allowlist extraction centralized so new config keys are not missed.
- Suggestion (R005): optionally harden nested override validation against schema/allowlist to prevent unsupported nested keys.
- Suggestion (R010): clean up stale test names that still mention legacy terms (default/user/project config wording).
- Suggestion (R011): consider broader test-name cleanup for legacy wording in settings-tui tests.
- Suggestion (R012): consider removing stale legacy wording in test names/comments during follow-up cleanup.
- Suggestion (R014): if init still asks for agent model/thinking values, message clearly that they are global-only and not project-persisted.
- Suggestion (R016): optional UX note in init flow clarifying that model/thinking selections are global preference defaults, not project JSON fields.
| 2026-04-05 22:07 | Review R001 | plan Step 1: APPROVE |
| 2026-04-05 22:11 | Review R002 | code Step 1: APPROVE |
| 2026-04-05 22:13 | Review R003 | plan Step 2: REVISE |
| 2026-04-05 22:13 | Review R004 | plan Step 2: APPROVE |
| 2026-04-05 22:19 | Review R005 | code Step 2: REVISE |
| 2026-04-05 22:22 | Review R006 | code Step 2: APPROVE |
| 2026-04-05 22:23 | Review R007 | plan Step 3: APPROVE |
| 2026-04-05 22:30 | Review R008 | code Step 3: APPROVE |
| 2026-04-05 22:31 | Review R009 | plan Step 4: APPROVE |
| 2026-04-05 22:40 | Review R010 | code Step 4: REVISE |
| 2026-04-05 22:44 | Review R011 | code Step 4: REVISE |
| 2026-04-05 22:48 | Review R012 | code Step 4: REVISE |
| 2026-04-05 22:51 | Review R013 | code Step 4: APPROVE |
| 2026-04-05 22:53 | Review R014 | plan Step 5: REVISE |
| 2026-04-05 22:54 | Review R015 | plan Step 5: APPROVE |
| 2026-04-05 23:00 | Review R016 | code Step 5: REVISE |
| 2026-04-05 23:04 | Review R017 | code Step 5: APPROVE |
| 2026-04-05 23:05 | Review R018 | plan Step 6: APPROVE |
