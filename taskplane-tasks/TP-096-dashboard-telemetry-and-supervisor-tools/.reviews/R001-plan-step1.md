# R001 — Plan Review (Step 1: Merge agent telemetry in dashboard #328)

## Verdict
**CHANGES REQUESTED** — the Step 1 plan is not yet implementation-ready.

## Reviewed artifacts
- `taskplane-tasks/TP-096-dashboard-telemetry-and-supervisor-tools/PROMPT.md`
- `taskplane-tasks/TP-096-dashboard-telemetry-and-supervisor-tools/STATUS.md`
- `dashboard/server.cjs`
- `dashboard/public/app.js`
- `dashboard/public/style.css`

## Blocking findings

### 1) Step 1 planning is too coarse for deterministic execution
`STATUS.md` still has only two broad checkboxes for Step 1 (`STATUS.md:20-24`), while `PROMPT.md` requires specific telemetry parity fields and UI behavior (`PROMPT.md:69-75`).

You need explicit sub-tasks for:
- server-side extraction fields,
- event-type handling,
- client rendering contract,
- status derivation,
- visual/theming changes,
- verification steps.

### 2) Server extraction contract is missing key fields required by the prompt
Current telemetry accumulator in `server.cjs` tracks tokens/cost/tool count/last tool/retry/compaction (`server.cjs:427-431`), and event handling currently ignores `response`, `tool_execution_end`, `agent_start`, and `agent_end` (`server.cjs:457-517`).

But Step 1 explicitly requires context %, elapsed, and current tool (`PROMPT.md:72-75`).

The plan must define how each is derived, including fallback behavior when data is absent.

### 3) Merge row attribution logic is currently ambiguous and must be planned explicitly
In merge rendering, each merge-result row currently picks the first alive merge session and first found merge telemetry (`app.js:677-686`), which can misattribute telemetry across rows/waves.

Before implementation, define deterministic row mapping:
- row → merge session key,
- merge session key → telemetry object,
- behavior when historical row has no live session.

### 4) Status mapping (running/done/error) is not specified
Prompt requires explicit status display (`PROMPT.md:74`). Current merge table mixes merge-result status and live-session presence without a defined precedence model.

Plan should define status precedence (e.g., live tmux session = running; terminal merge result succeeded = done; failed/partial = error/stalled) and fallback behavior for older/pre-telemetry batches.

### 5) Dark/light consistency is required but not planned at class level
Prompt calls out dark/light parity (`PROMPT.md:75`). Existing merge table styling is generic (`style.css:687-714`).

Plan must specify whether to reuse existing token/badge classes or add merge-specific classes using theme variables (not ad-hoc inline colors).

## Required plan updates before implementation

1. Expand Step 1 in `STATUS.md` into concrete implementation units (server parse/model, client mapping/render, CSS/theming, verification).
2. Define telemetry schema additions in `server.cjs` for merge parity fields (at minimum: `currentTool`, `contextPct`, `elapsedMs` or equivalent timestamps).
3. Define event handling additions and field derivation rules:
   - `tool_execution_start`/`tool_execution_end` for current tool,
   - `response` for authoritative `contextUsage.percent`,
   - `agent_start`/`agent_end` + timestamps for elapsed.
4. Define deterministic merge row/session telemetry mapping (avoid first-match global lookup).
5. Define status precedence and fallback behavior for missing telemetry/session data.
6. Define the exact UI rendering contract for the telemetry column (tool count, cost, elapsed, current tool, context %) and when to show `—`.
7. Add a Step 1 verification checklist (manual is acceptable if no dashboard test harness):
   - active merge session shows live fields,
   - completed merge shows terminal status,
   - no regression to lanes/reviewers telemetry,
   - dark and light themes both readable.

## Non-blocking note
- `getMergeSessionName()` is currently declared but unused (`app.js:646`); either use it in final mapping logic or remove it while touching this section.
