# TP-139: Init Model Picker and Global Defaults — Status

**Current Step:** Step 5: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-04-05
**Review Level:** 2
**Review Counter:** 9
**Iteration:** 1
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete
- [x] Read PROMPT.md and STATUS.md
- [x] Read bin/taskplane.mjs init flow
- [x] Read config-loader.ts preferences functions
- [x] Read config-schema.ts UserPreferences
- [x] Understand settings-tui.ts pickModel pattern
- [x] Determine model registry CLI access approach

### Step 1: Model registry access from CLI
**Status:** ✅ Complete
> ⚠️ Hydrate: Approach depends on Step 0 investigation of pi's model registry API

- [x] Implement CLI model discovery helper using `pi --list-models`
- [x] Parse provider/model output into `{ provider, id, displayName }[]`
- [x] Handle missing `pi`/query failures with graceful fallback behavior
- [x] Add targeted tests for model discovery parsing + fallback
- [x] R002 fix: make CLI direct-execution guard symlink-safe and add regression test

### Step 2: Interactive model selection in init
**Status:** ✅ Complete
- [x] Add provider → model picker to init flow
- [x] "Inherit" as default first option
- [x] Per-agent or "same for all" selection
- [x] Thinking mode prompt after model
- [x] Write to generated config
- [x] Graceful fallback if unavailable

### Step 3: Global defaults infrastructure
**Status:** ✅ Complete
- [x] Extend UserPreferences schema
- [x] Pre-populate from defaults during init
- [x] Add `taskplane config --save-as-defaults` command
- [x] Detect global vs local install
- [x] Show save confirmation

### Step 4: Testing & Verification
**Status:** ✅ Complete
- [x] Full test suite passing
- [x] Init with no defaults → inherit
- [x] Init with defaults → pre-populated
- [x] save-as-defaults writes correctly
- [x] Graceful degradation without model list
- [x] CLI smoke tests
- [x] All failures fixed

### Step 5: Documentation & Delivery
**Status:** ✅ Complete
- [x] Update commands.md
- [x] Update README if needed
- [x] Update STATUS.md
- [x] Discoveries logged

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| 1 | Plan | 1 | APPROVE | - |
| 2 | Code | 1 | REVISE | .reviews/R002-code-step1.md |
| 3 | Code | 1 | APPROVE | - |
| 4 | Plan | 2 | APPROVE | - |
| 5 | Code | 2 | APPROVE | - |
| 6 | Plan | 3 | APPROVE | - |
| 7 | Code | 3 | APPROVE | - |
| 8 | Plan | 4 | APPROVE | - |
| 9 | Code | 4 | APPROVE | - |

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| `pi --list-models` provides a stable tabular provider/model list in standalone CLI context. | Implemented parser + fallback path for init picker | `bin/taskplane.mjs` |
| Global init defaults are stored in `preferences.json` under `initAgentDefaults` and reused during interactive init. | Implemented save/read pipeline + schema allowlist | `bin/taskplane.mjs`, `extensions/taskplane/config-schema.ts`, `extensions/taskplane/config-loader.ts` |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-04-05 | Task staged | Split from TP-138, PROMPT.md and STATUS.md created |
| 2026-04-05 18:55 | Task started | Runtime V2 lane-runner execution |
| 2026-04-05 18:55 | Step 0 started | Preflight |
| 2026-04-05 18:59 | Review R001 | plan Step 1: APPROVE |
| 2026-04-05 19:06 | Review R002 | code Step 1: REVISE |
| 2026-04-05 19:07 | Step 1 tests | `tests/init-model-discovery.test.ts` passed (4/4) |
| 2026-04-05 19:14 | R002 regression tests | `tests/cli-command-surface.test.ts` + `tests/init-model-discovery.test.ts` passed (7/7) |
| 2026-04-05 19:15 | Review R003 | code Step 1: APPROVE |
| 2026-04-05 19:16 | Review R004 | plan Step 2: APPROVE |
| 2026-04-05 19:23 | Step 2 tests | `tests/init-model-picker.test.ts` + related CLI tests passed (11/11) |
| 2026-04-05 19:24 | Review R005 | code Step 2: APPROVE |
| 2026-04-05 19:25 | Review R006 | plan Step 3: APPROVE |
| 2026-04-05 19:30 | Step 3 tests | config/defaults targeted tests passed (16/16) |
| 2026-04-05 19:31 | Review R007 | code Step 3: APPROVE |
| 2026-04-05 19:32 | Review R008 | plan Step 4: APPROVE |
| 2026-04-05 19:36 | Step 4 full suite | `node --test tests/*.test.ts` passed (3177/3177) |
| 2026-04-05 19:37 | Step 4 smoke | `taskplane help` + `taskplane doctor` smoke checks passed in temp repo |
| 2026-04-05 19:38 | Review R009 | code Step 4: APPROVE |
| 2026-04-05 19:43 | Step 5 docs | Updated CLI command docs + README command table/init notes |
| 2026-04-05 19:38 | Worker iter 1 | done in 2588s, tools: 239 |
| 2026-04-05 19:38 | Task complete | .DONE created |

---

## Blockers

- **TP-138** must complete first (inherit defaults and thinking picker)

---

## Notes

- Suggestion from R002 (advisory): tighten parser filtering for non-table lines if `pi --list-models` format changes.
