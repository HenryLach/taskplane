# R001 — Plan Review (Step 1: Fix Telemetry Key for Merge Agents)

## Verdict
**REVISE** — the direction is correct, but the current Step 1 plan can regress workspace-mode merge telemetry.

## Reviewed artifacts
- `taskplane-tasks/TP-067-merge-telemetry-key-fix/PROMPT.md`
- `taskplane-tasks/TP-067-merge-telemetry-key-fix/STATUS.md`
- `dashboard/server.cjs` (`parseTelemetryFilename`, `loadTelemetryData`)
- `dashboard/public/app.js` (`renderMergeAgents` telemetry lookups)
- `extensions/taskplane/waves.ts` (lane tmux naming)
- `extensions/taskplane/merge.ts` (merge tmux naming)

## Blocking finding

### 1) Prefix derivation from the first lane session is not workspace-safe
The proposed/server implementation derives merger telemetry key base from:
- first lane tmux session name (`Object.values(laneToPrefix)[0]`) and
- `replace(/-lane-\d+$/, "")`

This works in repo mode, but can be wrong in workspace mode.

Evidence:
- Workspace lane sessions include repo in name: `"{prefix}-{opId}-{repoId}-lane-{N}"` (`waves.ts`, `generateTmuxSessionName`).
- Merge sessions do **not** include repo: `"${tmuxPrefix}-${opId}-merge-${lane.laneNumber}"` (`merge.ts:1228`).

So for a lane like `orch-henrylach-api-lane-1`, the current approach yields `orch-henrylach-api-merge-*`, but actual merge session keys are `orch-henrylach-merge-*`.

That would keep telemetry mismatched in workspace runs.

## Required plan updates
1. **Change derivation strategy** for merger prefixes:
   - Use the lane record for `parsed.mergeNumber` (global lane number) when available.
   - Derive base from that lane’s `tmuxSessionName` by removing `-lane-\d+` and, if present, trimming trailing `-${repoId}`.
   - Then build `${base}-merge-${parsed.mergeNumber}`.
   - Keep current `orch-merge-*` fallback when lane context is unavailable.

2. **Add explicit workspace-mode check** in Step 1 acceptance notes:
   - repo mode example (`orch-{opId}-lane-1` -> `orch-{opId}-merge-1`)
   - workspace mode example (`orch-{opId}-{repo}-lane-1` -> `orch-{opId}-merge-{globalLane}`)

3. **Add targeted verification item** (even if lightweight):
   - one scenario where lane session includes repo segment and merger telemetry still maps to `orch-{opId}-merge-{N}`.

## Non-blocking notes
- `app.js` currently looks up telemetry by actual merge session names (`telemetry[sess]`), so server-key correctness is the main fix point.
- `renderMergeAgents` has some unused derived-prefix helper code; not required for this task, but worth cleaning in a follow-up.
