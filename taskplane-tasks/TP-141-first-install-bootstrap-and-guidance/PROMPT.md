# Task: TP-141 - First-Install Bootstrap and Cross-Provider Guidance

**Created:** 2026-04-05
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** New first-run detection, global prefs bootstrap, and interactive guidance during init. Builds on TP-140's global prefs architecture.
**Score:** 4/8 — Blast radius: 2 (CLI init, config-loader, global prefs), Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-141-first-install-bootstrap-and-guidance/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Implement first-install detection, global preferences bootstrapping, and intelligent cross-provider model guidance so that a new Taskplane user gets a well-configured setup from their very first `taskplane init`.

### Goals

1. **First-install detection and global prefs bootstrap:**
   - When `~/.pi/agent/taskplane/preferences.json` doesn't exist, detect this as first install
   - Create the file seeded from schema defaults
   - Set thinking to `"high"` by default for worker and reviewer
   - Merge thinking defaults to `"off"` via schema default (see #439 — thinking causes merge agent timeout on large diffs). No special-case needed in bootstrap since it seeds from schema. (not just `"on"`)
   - Pi supports thinking levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`
   - For models that don't support thinking, thinking is ignored at runtime — safe to default to `"high"`

2. **Cross-provider reviewer/merger guidance during first init:**
   - On first `taskplane init` (detected by checking if global prefs were just bootstrapped or have no reviewer/merger model set)
   - Query available models via `pi --list-models`
   - If the user has 2+ providers configured, guide them to choose a DIFFERENT provider for reviewer and merger than their session/worker model
   - Explain the rationale: "Cross-provider review catches blind spots that same-model review misses"
   - If they only have 1 provider, skip the guidance (no cross-provider option available)
   - Save the chosen reviewer/merger model to global preferences (not project config)
   - Subsequent `taskplane init` runs in other projects skip this guidance (global prefs already configured)

3. **Thinking level picker enhancement:**
   - Update the thinking picker in both `/taskplane-settings` and `taskplane init` to show all pi thinking levels: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`
   - Default selection: `high`
   - Show `inherit (use session thinking)` as an option too
   - `pi --list-models` output has a `thinking` column (`yes`/`no`) — use this to indicate which models support thinking

4. **Zero-friction first run:**
   - After `taskplane init` + global prefs bootstrap + model guidance, the user should be able to run `/orch` and have everything work with good defaults
   - No additional manual configuration needed

## Dependencies

- **Task:** TP-140 (global preferences architecture must be complete — precedence flip, rename, sparse config)

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `extensions/taskplane/config-schema.ts` — `GlobalPreferences` (after TP-140 rename), schema defaults
- `extensions/taskplane/config-loader.ts` — `loadGlobalPreferences()` (after TP-140), bootstrap logic
- `extensions/taskplane/settings-tui.ts` — thinking picker implementation
- `bin/taskplane.mjs` — init flow, `collectInitAgentConfig()`, `queryAvailableModelsFromPi()`

## Environment

- **Workspace:** `extensions/taskplane/`, `bin/`
- **Services required:** None

## File Scope

- `extensions/taskplane/config-schema.ts`
- `extensions/taskplane/config-loader.ts`
- `extensions/taskplane/settings-tui.ts`
- `bin/taskplane.mjs`
- `extensions/tests/project-config-loader.test.ts`
- `extensions/tests/settings-tui.test.ts`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Verify TP-140 is complete (GlobalPreferences exists, precedence is flipped)
- [ ] Read current init flow and model discovery in bin/taskplane.mjs
- [ ] Read thinking picker in settings-tui.ts
- [ ] Check `pi --list-models` output format for thinking column

### Step 1: First-install detection and global prefs bootstrap
- [ ] In `loadGlobalPreferences()`: if prefs file doesn't exist, create it from schema defaults
- [ ] Set default thinking to `"high"` for worker, reviewer, and merger
- [ ] Return a flag indicating whether this was a fresh bootstrap (for downstream guidance)
- [ ] Ensure bootstrap is atomic (write to temp file, rename)
- [ ] If prefs file exists but is empty/corrupt, re-bootstrap from defaults
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/config-loader.ts` (modified)
- `extensions/taskplane/config-schema.ts` (modified — default thinking values)

### Step 2: Cross-provider model guidance in first init
- [ ] Detect "first init" condition: global prefs were just bootstrapped OR reviewer/merger model not yet configured
- [ ] Query available models via `queryAvailableModelsFromPi()`
- [ ] Count distinct providers with available models
- [ ] If 2+ providers: show guidance message explaining cross-provider review benefits
- [ ] Present provider → model picker for reviewer (pre-select a different provider than session default)
- [ ] Present provider → model picker for merger (same cross-provider guidance)
- [ ] If 1 provider: skip guidance, inform user they can add cross-provider review later
- [ ] Save selections to global preferences
- [ ] Subsequent inits skip guidance (check if reviewer/merger model already set in global prefs)
- [ ] Run targeted tests

**Artifacts:**
- `bin/taskplane.mjs` (modified — init flow)

### Step 3: Thinking level picker enhancement
- [ ] Update thinking picker in settings-tui.ts: show all pi levels (off, minimal, low, medium, high, xhigh)
- [ ] Add `inherit (use session thinking)` as first option
- [ ] Default selection: `high`
- [ ] Update thinking picker in bin/taskplane.mjs init flow similarly
- [ ] If model doesn't support thinking (from `pi --list-models` thinking column), show note but still allow setting (ignored at runtime)
- [ ] Run targeted tests

**Artifacts:**
- `extensions/taskplane/settings-tui.ts` (modified)
- `bin/taskplane.mjs` (modified)

### Step 4: Testing & Verification

> ZERO test failures allowed. Full suite quality gate.

- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Test: first install creates prefs with thinking: "high"
- [ ] Test: subsequent loadGlobalPreferences returns existing prefs (no re-bootstrap)
- [ ] Test: cross-provider guidance triggers only on first init
- [ ] Test: thinking picker shows all levels
- [ ] Test: single-provider setup skips cross-provider guidance
- [ ] CLI smoke: `node bin/taskplane.mjs help` and `node bin/taskplane.mjs doctor`
- [ ] Fix all failures

### Step 5: Documentation & Delivery
- [ ] Update config reference docs with thinking level options
- [ ] Update README first-run section if applicable
- [ ] Document the bootstrap behavior
- [ ] Update STATUS.md

## Documentation Requirements

**Must Update:**
- `docs/reference/configuration/taskplane-settings.md` — thinking levels

**Check If Affected:**
- `docs/how-to/configure-task-runner.md`
- `README.md` — getting started section

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] Documentation updated
- [ ] First install bootstraps global prefs with thinking: "high"
- [ ] Cross-provider guidance triggers on first init with 2+ providers
- [ ] Thinking picker shows all pi levels (off through xhigh)

## Git Commit Convention

- `feat(TP-141): complete Step N — description`
- `fix(TP-141): description`

## Do NOT

- Hardcode any specific model names as defaults
- Force cross-provider selection (always allow "inherit" or same-provider)
- Make thinking mandatory (user can always set to off or inherit)
- Change global preferences file path
- Skip the guidance for users with 2+ providers — the whole point is encouraging best practices

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
