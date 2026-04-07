# Task: TP-148 - Wave Display, MaxLanes Global Cap, and Session Naming

**Created:** 2026-04-07
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** Three moderate UX/correctness issues. Touches wave planner, lane allocator, and V2 registry naming. Independent fixes bundled for efficiency.
**Score:** 4/8 — Blast radius: 2 (waves, execution, dashboard), Pattern novelty: 1, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-148-wave-display-maxlanes-session-naming/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

Fix three moderate issues from polyrepo testing:

### Issue 1: Excessive/duplicate waves in dashboard (#454)

A batch with 6 tasks and a simple dependency graph created 6 waves with duplicate task IDs. TP-004 and TP-005 appeared in both wave 1 and wave 2 (once per segment). TP-006 appeared in waves 3, 4, and 5 (once per segment). The dashboard shows these as separate waves, which is confusing.

**Fix options:**
- **(A) Collapse same-task segment waves in the dashboard** — display "TP-006 (segment 2/3: api-service)" instead of a separate wave row.
- **(B) Include segment info in wave display** — show which segment is executing in each wave.
- **(C) Engine-level:** reduce wave count by not creating separate wave entries for subsequent segments of the same task.

**Recommended: Option B** — add segment context to the wave display. The engine behavior is correct (each segment needs its own wave for merge-between-segments), the display just needs to explain what's happening.

### Issue 2: maxLanes is per-repo, not global (#451)

In workspace mode, each repo gets its own `maxLanes` budget. With maxLanes=4 and tasks across 3 repos, the actual lane count exceeded 4. Users expect maxLanes to be a global cap.

**Fix:** Add a global lane cap that limits total concurrent lanes across all repos. The per-repo allocation continues to work within this cap. Implementation: after per-repo allocation, if total lanes > maxLanes, reduce lanes in repos with the most headroom.

### Issue 3: CLI widget shows "session dead" (#425)

The TUI widget shows "session dead" for all running lanes because batch state uses `laneSessionId` (e.g., `tp-test-henrylach-api-service-lane-1`) while V2 registry uses `agentId` (e.g., `tp-test-henrylach-lane-1-worker`). The widget can't find the session in the registry.

**Fix:** Align the naming — either the widget should look up by `agentId` pattern, or the batch state should store the V2 agent ID alongside the legacy session ID.

## Dependencies

- None

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3:**
- `extensions/taskplane/waves.ts` — per-repo lane allocation, wave computation
- `extensions/taskplane/engine.ts` — wave display, segment wave scheduling
- `extensions/taskplane/extension.ts` — TUI widget, session lookup
- `dashboard/public/app.js` — wave display in dashboard

## File Scope

- `extensions/taskplane/waves.ts`
- `extensions/taskplane/engine.ts`
- `extensions/taskplane/extension.ts`
- `dashboard/public/app.js`
- `dashboard/server.cjs`

## Steps

### Step 0: Preflight
- [ ] Read PROMPT.md and STATUS.md
- [ ] Read waves.ts per-repo allocation
- [ ] Read engine.ts wave display and segment scheduling
- [ ] Read extension.ts TUI widget session lookup
- [ ] Read dashboard wave display

### Step 1: Wave display with segment context
- [ ] Add segment info to wave display data (segment index, repo ID, total segments)
- [ ] Dashboard: show "TP-006 (segment 2/3: api-service)" in wave rows
- [ ] Supervisor events: include segment context in wave_start events
- [ ] Run targeted tests

### Step 2: Global maxLanes cap
- [ ] After per-repo allocation, count total lanes across all repos
- [ ] If total > maxLanes, reduce lanes in repos with most headroom
- [ ] Preserve at least 1 lane per repo with tasks
- [ ] Add test for global cap behavior
- [ ] Run targeted tests

### Step 3: Fix session naming mismatch
- [ ] Identify where batch state stores session ID vs where widget looks it up
- [ ] Add V2 agent ID to batch state lane record (or derive it from existing fields)
- [ ] Update widget to use the correct ID for registry lookup
- [ ] Run targeted tests

### Step 4: Testing & Verification

> ZERO test failures allowed. Full suite quality gate.

- [ ] Test: wave display includes segment context
- [ ] Test: maxLanes=4 with 3 repos produces at most 4 total lanes
- [ ] Test: widget finds running sessions (no "session dead" for active workers)
- [ ] Run FULL test suite: `cd extensions && node --experimental-strip-types --experimental-test-module-mocks --no-warnings --import ./tests/loader.mjs --test tests/*.test.ts`
- [ ] Fix all failures

### Step 5: Documentation & Delivery
- [ ] Update STATUS.md

## Git Commit Convention

- `feat(TP-148): complete Step N — description`

## Do NOT

- Change the per-repo allocation logic (it's correct, just needs a global cap)
- Break single-repo wave display
- Change V2 agent ID format (fix the lookup, not the IDs)

---

## Amendments (Added During Execution)

<!-- Workers add amendments here if issues discovered during execution. -->
