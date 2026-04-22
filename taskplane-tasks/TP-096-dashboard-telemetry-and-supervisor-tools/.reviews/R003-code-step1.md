# R003 — Code Review (Step 1: Merge agent telemetry in dashboard #328)

## Verdict
**CHANGES REQUESTED**

The Step 1 implementation is close, but there is a correctness issue in merge session attribution that will misreport live merge telemetry/attach targets in common multi-wave flows.

## Reviewed artifacts
- `dashboard/server.cjs`
- `dashboard/public/app.js`
- `dashboard/public/style.css`
- Neighboring pattern checks:
  - `extensions/taskplane/merge.ts`
  - `extensions/task-runner.ts`

## What looks good
- Server-side telemetry model now includes merge-relevant fields (`currentTool`, `contextPct`, `startedAt`) and parses additional events (`tool_execution_end`, `agent_start`, `response`).
- Merge table UI moved from inline styles to class-based styling with theme variables (`merge-*` CSS classes), which is consistent with dark/light requirements.
- Merge telemetry rendering now includes tool count, context %, tokens/cost, and current tool for active sessions.

---

## Blocking findings

### 1) Wave row ↔ merge session mapping is incorrect (lane-based sessions are being mapped by wave index)
**Severity:** Blocking

`renderMergeAgents()` maps wave rows to an expected session using `mr.waveIndex + 1`:
- `dashboard/public/app.js:726-743`

But merge session names are lane-number based, not wave-number based:
- `extensions/taskplane/merge.ts:1428` (`...-merge-${lane.laneNumber}`)
- file naming docs confirm merge suffix is `-merge-{N}` derived from session/lane number (`extensions/taskplane/merge.ts:31-52`)

### Why this breaks
- In multi-wave batches, a lane’s merge session name is reused across waves.
- A completed wave row can incorrectly attach to a currently running merge session from a later wave.
- Telemetry and attach command can appear on the wrong wave row, and true active sessions can be hidden by `shownSessions` suppression.

### Required fix
Use a mapping keyed by **lane numbers actually involved in that row** (e.g., from `mr.laneResults` / `repoResults.laneNumbers`) or stop binding session/telemetry directly to wave-summary rows and render active merge sessions separately with unambiguous lane/session identity.

---

## Non-blocking findings

### 2) Completed merge rows never show `lastTool` even when available
- `dashboard/public/app.js:665-667` has an empty branch for `!alive && tel.lastTool`.
- This leaves completed rows without the “last tool” detail despite server extraction.

### 3) Context usage parsing is less compatible than task-runner sidecar parsing
- Dashboard parser accepts only `contextUsage.percent` (`dashboard/server.cjs:517-522`).
- Task-runner parser also supports legacy `percentUsed` fallback (`extensions/task-runner.ts:1538-1540`).

Aligning these improves telemetry consistency across older pi versions.

---

## Validation run
- `node --check dashboard/public/app.js`
- `node --check dashboard/server.cjs`

(Both passed syntax check.)
