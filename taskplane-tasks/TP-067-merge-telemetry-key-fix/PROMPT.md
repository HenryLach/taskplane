# Task: TP-067 - Fix Merge Agent Telemetry Key Mismatch

**Created:** 2026-03-25
**Size:** S

## Review Level: 1 (Plan Only)

**Assessment:** Small fix in dashboard server telemetry key mapping. No new patterns, no security, easily reversible.
**Score:** 1/8 — Blast radius: 1, Pattern novelty: 0, Security: 0, Reversibility: 0

## Canonical Task Folder

```
taskplane-tasks/TP-067-merge-telemetry-key-fix/
├── PROMPT.md
├── STATUS.md
├── .reviews/
└── .DONE
```

## Mission

The dashboard's merge agents section shows active merge sessions (fixed in #202) but the Telemetry column always shows "—" because the telemetry key doesn't match the session name.

- **Session name:** `orch-henrylach-merge-1` (includes operator ID)
- **Telemetry key (from server):** `orch-merge-1` (operator ID stripped)

The server's `parseTelemetryFilename()` builds merge telemetry keys as `orch-merge-{N}`, but the client looks up `telemetry[sessionName]` using the full session name. Lane telemetry already uses the full session name (`orch-henrylach-lane-1`) — merge telemetry should be consistent.

## Dependencies

- **None**

## Context to Read First

**Tier 2:**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `dashboard/server.cjs` — search for `parseTelemetryFilename` (~line 245) and the merge telemetry key construction (~line 390). Also search for `orch-merge` to find all hardcoded merge prefix patterns.
- `dashboard/public/app.js` — search for `mergeSessions` and `telemetry[` to find client-side lookups.

## Environment

- **Workspace:** `dashboard/`
- **Services required:** None

## File Scope

- `dashboard/server.cjs`
- `dashboard/public/app.js`

## Steps

### Step 0: Preflight

- [ ] Read `parseTelemetryFilename()` in `server.cjs` — understand how merge telemetry keys are built
- [ ] Read `loadTelemetryData()` — find where `orch-merge-{N}` prefix is constructed for merger role
- [ ] Read merge section in `app.js` — find all `telemetry[...]` lookups for merge sessions

### Step 1: Fix Telemetry Key for Merge Agents

The fix should be on the **server side** to align merge telemetry keys with the actual session naming convention (same as lanes):

In `loadTelemetryData()` in `server.cjs`, the merge agent telemetry key is built as:
```js
prefix = parsed.mergeNumber != null ? `orch-merge-${parsed.mergeNumber}` : "orch-merge";
```

This should derive the prefix from the batch state's lane session names, matching the pattern used for lanes. If lanes use `orch-henrylach-lane-1`, merge should use `orch-henrylach-merge-1`.

Approach: extract the operator prefix from the first lane's session name (e.g., `orch-henrylach`) and use it for merge keys too:
```js
// Derive merge prefix from lane naming: orch-{opId}-lane-N → orch-{opId}-merge-N
if (parsed.role === "merger" && parsed.mergeNumber != null) {
    // Use the same prefix as lanes, replacing "lane" with "merge"
    const lanePrefix = Object.values(laneToPrefix)[0]; // e.g., "orch-henrylach-lane-1"
    const opPrefix = lanePrefix?.replace(/-lane-\d+$/, ''); // "orch-henrylach"
    prefix = opPrefix ? `${opPrefix}-merge-${parsed.mergeNumber}` : `orch-merge-${parsed.mergeNumber}`;
}
```

Also check if `app.js` has any remaining hardcoded `orch-merge-` patterns that need updating (lines 657, 661, 721 were partially fixed in #202 but the telemetry lookup may still use the wrong key).

**Artifacts:**
- `dashboard/server.cjs` (modified)
- `dashboard/public/app.js` (modified if needed)

### Step 2: Testing & Verification

> ZERO test failures allowed.

- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Build passes: `node bin/taskplane.mjs help`

### Step 3: Documentation & Delivery

- [ ] Discoveries logged in STATUS.md
- [ ] `.DONE` created in this folder

## Completion Criteria

- [ ] Merge agent telemetry key matches the actual tmux session name
- [ ] Dashboard merge agents section shows telemetry (tokens, cost) during merges
- [ ] All tests passing
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `fix(TP-067): complete Step N — description`

## Do NOT

- Change the telemetry filename format
- Change the merge session naming convention
- Modify lane telemetry key mapping (it already works)

---

## Amendments
