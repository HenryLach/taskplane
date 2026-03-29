# R002 — Plan Review (Step 1: Merge agent telemetry in dashboard #328)

## Verdict
**REVISE (blocking)** — Step 1 planning is still not implementation-ready.

## Reviewed artifacts
- `taskplane-tasks/TP-096-dashboard-telemetry-and-supervisor-tools/PROMPT.md`
- `taskplane-tasks/TP-096-dashboard-telemetry-and-supervisor-tools/STATUS.md`
- `dashboard/server.cjs`
- `dashboard/public/app.js`
- `dashboard/public/style.css`
- Prior review: `.reviews/R001-plan-step1.md`

## What changed since R001
No substantive Step 1 plan updates are visible yet:
- `STATUS.md` Step 1 still contains only two coarse checkboxes (`STATUS.md:20-24`).
- R001’s required planning clarifications have not been incorporated.

---

## Blocking findings

### 1) Step 1 plan remains too high-level for deterministic execution
Prompt requires specific outputs (tool count, last tool, token classes, cost, context %, elapsed, status, current tool, theme consistency) (`PROMPT.md:71-75`), but Step 1 plan remains only:
- “Server-side sidecar reading for merge agents”
- “Client-side telemetry rendering”

(`STATUS.md:23-24`)

This is still insufficient to execute safely without ambiguity.

### 2) Server telemetry contract is still incomplete relative to Step 1 requirements
Current accumulator fields do not include explicit merge-ready status/context/elapsed/current-tool lifecycle fields (`dashboard/server.cjs:427-432`).

Event handling currently processes:
- `message_end`
- `tool_execution_start`
- `auto_retry_start` / `auto_retry_end`
- `auto_compaction_start`

(`dashboard/server.cjs:457-517`)

But Step 1 needs context % and elapsed/current tool semantics (`PROMPT.md:72-74`). Plan must specify handling of `response` (for `contextUsage.percent`) and start/end timestamps (`agent_start`/`agent_end`, plus tool end behavior).

### 3) Merge row ↔ session ↔ telemetry mapping is still ambiguous
In `renderMergeAgents`, each merge-result row currently:
- picks the first alive merge session (`app.js:677-679`)
- picks the first telemetry object among all merge sessions (`app.js:682-686`)

This can misattribute telemetry/status across rows/waves.
Plan must define deterministic mapping rules before implementation.

### 4) Status model (running/done/error) is not planned
Prompt explicitly requires status display (`PROMPT.md:74`). Current merge row status uses `mr.status` while session aliveness is separately computed and not governed by precedence rules (`app.js:670-691`).

Need a declared precedence model and fallback behavior for:
- live session + no merge result yet,
- merge result terminal + no live session,
- partial/error cases,
- legacy/no-telemetry cases.

### 5) UI rendering contract and theme strategy remain unspecified
Current merge telemetry cell only shows token/cost (`app.js:693-706`, `755-768`) and uses inline snippets. Step 1 needs richer fields (status/tool count/cost/elapsed/current tool/context). Plan should define:
- exact telemetry cell layout,
- truncation/fallback (`—`) rules,
- class-based styling approach using existing theme variables (`style.css:687-714`, `764+`).

---

## Required plan updates before coding

1. Expand `STATUS.md` Step 1 into concrete sub-steps:
   - server parsing + accumulator schema,
   - merge session/wave attribution strategy,
   - client rendering contract,
   - CSS/theming updates,
   - verification checklist.
2. Define server-side merge telemetry schema additions (at minimum):
   - `contextPct`
   - `startedAt` / `endedAt` / computed `elapsedMs`
   - `currentTool` (active tool), with clear transitions
   - terminal/running flags as needed.
3. Define event-to-field derivation explicitly:
   - `tool_execution_start` / `tool_execution_end`
   - `response` (`contextUsage.percent`)
   - `agent_start` / `agent_end`.
4. Define deterministic row mapping:
   - which session belongs to each row,
   - how historical rows are handled when no live session exists,
   - no global “first match” selection.
5. Define status precedence and fallback behavior.
6. Define exact telemetry UI output (tool count, cost, elapsed, current tool, context %) and `—` conditions.
7. Add a Step 1 verification checklist (manual acceptable):
   - active merge shows live telemetry fields,
   - completed merge shows terminal status,
   - no regressions in worker/reviewer rendering,
   - dark/light readability verified.

## Optional cleanup note
- `getMergeSessionName` is currently unused in merge rendering (`app.js:646`). Either use it in final mapping or remove it when touching this section.
