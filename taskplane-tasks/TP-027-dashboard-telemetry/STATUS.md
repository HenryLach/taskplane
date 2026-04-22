# TP-027: Dashboard Real-Time Telemetry — Status

**Current Step:** Step 4: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-03-20
**Review Level:** 1
**Review Counter:** 5
**Iteration:** 5
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read dashboard server data flow
- [x] Read dashboard frontend rendering
- [x] Read roadmap Phase 1 section 1d
- [x] Read Tier 2 context (CONTEXT.md) and capture constraints
- [x] Record preflight findings in Discoveries/Notes with file+line anchors and implementation guardrails

---

### Step 1: Dashboard Server — Serve Telemetry Data
**Status:** ✅ Complete

- [x] Implement loadTelemetryData() — read .pi/telemetry/*.jsonl with incremental byte-offset tailing, partial-line buffering, malformed-line skipping, and file-disappearance cleanup
- [x] Map telemetry files to lanes — parse filename pattern {opId}-{batchId}-{repoId}[-{taskId}][-lane-{N}]-{role}.jsonl to extract lane number; merge worker+reviewer files per lane; key by lane tmux prefix using batch-state lane records
- [x] Parse JSONL events for metrics not in lane-state: compaction count (auto_compaction_start), and provide fallback tokens/cost/retry data for lanes where lane-state is absent
- [x] Compute batch total cost from lane-state (primary) + telemetry JSONL (supplementary); avoid double-counting
- [x] Include telemetry in buildDashboardState() response as additive field alongside existing laneStates; degrade gracefully when .pi/telemetry/ is missing (pre-RPC sessions)
- [x] Verify server.cjs loads cleanly: node --check dashboard/server.cjs

---

### Step 2: Dashboard Frontend — Display Telemetry
**Status:** ✅ Complete

- [x] Consume `currentData.telemetry[tmuxPrefix]` in renderLanesTasks() — show retry badge (active/count), compaction badge, and telemetry-sourced lastTool for all task states (running, done, error), not just running
- [x] Use `currentData.batchTotalCost` in renderSummary() with backward-compatible fallback to lane-state aggregation when batchTotalCost is absent
- [x] Add CSS for telemetry badges (.telem-badge, .telem-retry-active, .telem-compaction) as compact chips in .worker-stats — secondary to existing lane-state display
- [x] Graceful "—" fallback: lanes/tasks without telemetry show no telemetry badges (no empty containers, no layout shift)

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

- [x] Syntax check: `node --check dashboard/server.cjs` and `node --check dashboard/public/app.js` pass
- [x] API contract: Create mock telemetry JSONL + batch-state, verify buildDashboardState() returns `telemetry` and `batchTotalCost` fields with correct values (retry lifecycle, compaction count, cost dedup)
- [x] Fallback/edge cases: Verify graceful behavior with missing .pi/telemetry/, malformed JSONL lines, file deletion mid-read, and pre-RPC sessions (no telemetry files)
- [x] Full test suite: `cd extensions && npx vitest run` passes with zero failures (32 files, 1321 tests)
- [x] Fix any issues discovered during verification (fixed: telemetry accumulators were not persisted across poll ticks — added module-level telemetryAccumulators Map + telemetryPrefixFiles for file rotation detection)

---

### Step 4: Documentation & Delivery
**Status:** ✅ Complete

- [x] Review docs/reference/commands.md dashboard section and record decision (update or no-change rationale)
- [x] Finalize STATUS.md: mark Step 4 complete, update top-level status, add execution-log entry
- [x] Confirm .DONE file exists as final action (reconcile with STATUS.md completion)

---

## Reviews

| # | Type | Step | Verdict | File |
| R001 | plan | Step 0 | APPROVE | .reviews/R001-plan-step0.md |
| R001 | plan | Step 0 | REVISE | .reviews/R001-plan-step0.md |
| R002 | plan | Step 1 | REVISE | .reviews/R002-plan-step1.md |
| R002 | plan | Step 1 | REVISE | .reviews/R002-plan-step1.md |
| R003 | plan | Step 2 | REVISE | .reviews/R003-plan-step2.md |
| R003 | plan | Step 2 | REVISE | .reviews/R003-plan-step2.md |
| R004 | plan | Step 3 | REVISE | .reviews/R004-plan-step3.md |
| R004 | plan | Step 3 | REVISE | .reviews/R004-plan-step3.md |
| R005 | plan | Step 4 | REVISE | .reviews/R005-plan-step4.md |
|---|------|------|---------|------|

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|
| Dashboard already displays tokens/cost/context%/lastTool from lane-state-*.json sidecar files | Inform Step 1 — server already loads these; new work is reading telemetry JSONL for retries/compactions | dashboard/server.cjs `loadLaneStates()`, dashboard/public/app.js `tokenSummaryFromLaneState()` |
| Telemetry JSONL files from RPC wrapper (TP-025/026) at `.pi/telemetry/` are the NEW data source | Step 1 must read these incrementally and merge with existing lane state data | docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md §1d |
| Server data flow: loadBatchState() → buildDashboardState() → SSE broadcast; loadLaneStates() reads .pi/lane-state-*.json | Step 1: add loadTelemetryData() alongside loadLaneStates() in buildDashboardState() | dashboard/server.cjs:73-78, 172-191, 197-215 |
| Frontend lane rendering: renderLanesTasks() shows worker-stats div with tokens/cost/context%/lastTool from laneStates | Step 2: extend worker-stats section; do NOT replace existing lane-state display — add telemetry overlay | dashboard/public/app.js:310-345 (worker-stats block) |
| Frontend batch cost: renderSummary() already aggregates lane-state tokens into batch total | Step 2: merge telemetry JSONL cost with lane-state cost; avoid double-counting | dashboard/public/app.js:240-260 (batch token aggregation) |
| Roadmap §1d target metrics: tokens, cost/lane, batch cost, context%, last tool, retries, compactions | Step 1/2: retries and compactions are NEW metrics not in lane-state; all others already exist from lane-state | resilience-and-diagnostics-roadmap.md §1d metrics table |
| CONTEXT.md has no constraints affecting dashboard work | No action needed | taskplane-tasks/CONTEXT.md |

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-19 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-20 02:36 | Task started | Extension-driven execution |
| 2026-03-20 02:36 | Step 0 started | Preflight |
| 2026-03-20 02:36 | Task started | Extension-driven execution |
| 2026-03-20 02:36 | Step 0 started | Preflight |
| 2026-03-20 02:37 | Review R001 | plan Step 0: APPROVE |
| 2026-03-20 02:38 | Review R001 | plan Step 0: REVISE |
| 2026-03-20 02:39 | Worker iter 1 | done in 98s, ctx: 26%, tools: 15 |
| 2026-03-20 02:39 | Step 0 complete | Preflight |
| 2026-03-20 02:39 | Step 1 started | Dashboard Server — Serve Telemetry Data |
| 2026-03-20 02:41 | Worker iter 1 | done in 171s, ctx: 30%, tools: 31 |
| 2026-03-20 02:41 | Step 0 complete | Preflight |
| 2026-03-20 02:41 | Step 1 started | Dashboard Server — Serve Telemetry Data |
| 2026-03-20 02:41 | Review R002 | plan Step 1: REVISE |
| 2026-03-20 02:44 | Review R002 | plan Step 1: REVISE |
| 2026-03-20 02:46 | Worker iter 2 | done in 290s, ctx: 28%, tools: 46 |
| 2026-03-20 02:46 | Step 1 complete | Dashboard Server — Serve Telemetry Data |
| 2026-03-20 02:46 | Step 2 started | Dashboard Frontend — Display Telemetry |
| 2026-03-20 02:47 | Worker iter 2 | done in 158s, ctx: 21%, tools: 29 |
| 2026-03-20 02:47 | Step 1 complete | Dashboard Server — Serve Telemetry Data |
| 2026-03-20 02:47 | Step 2 started | Dashboard Frontend — Display Telemetry |
| 2026-03-20 02:47 | Review R003 | plan Step 2: REVISE |
| 2026-03-20 02:48 | Review R003 | plan Step 2: REVISE |
| 2026-03-20 02:51 | Worker iter 3 | done in 220s, ctx: 29%, tools: 32 |
| 2026-03-20 02:51 | Step 2 complete | Dashboard Frontend — Display Telemetry |
| 2026-03-20 02:51 | Step 3 started | Testing & Verification |
| 2026-03-20 02:53 | Worker iter 3 | done in 263s, ctx: 30%, tools: 39 |
| 2026-03-20 02:53 | Step 2 complete | Dashboard Frontend — Display Telemetry |
| 2026-03-20 02:53 | Step 3 started | Testing & Verification |
| 2026-03-20 02:53 | Review R004 | plan Step 3: REVISE |
| 2026-03-20 02:54 | Review R004 | plan Step 3: REVISE |
| 2026-03-20 03:00 | Worker iter 4 | done in 440s, ctx: 30%, tools: 28 |
| 2026-03-20 03:00 | Step 3 complete | Testing & Verification |
| 2026-03-20 03:00 | Step 4 started | Documentation & Delivery |
| 2026-03-20 03:08 | Worker iter 4 | done in 836s, ctx: 41%, tools: 60 |
| 2026-03-20 03:08 | Step 3 complete | Testing & Verification |
| 2026-03-20 03:08 | Step 4 started | Documentation & Delivery |
| 2026-03-20 03:09 | Review R005 | plan Step 4: REVISE |
| 2026-03-20 | Step 4 complete | Documentation reviewed (no change needed), STATUS.md finalized, .DONE confirmed |
| 2026-03-20 | Task complete | All 5 steps done — dashboard telemetry feature delivered |

---

## Blockers

*None*

---

## Notes

### Preflight Findings

**Data flow architecture (server):**
- server.cjs:73-78 — loadBatchState() reads .pi/batch-state.json
- server.cjs:172-191 — loadLaneStates() reads .pi/lane-state-*.json (existing telemetry source)
- server.cjs:197-215 — buildDashboardState() assembles batch + laneStates for frontend
- NEW: Need loadTelemetryData() to read .pi/telemetry/*.jsonl files incrementally

**Data flow architecture (frontend):**
- app.js:56-70 — tokenSummaryFromLaneState() formats existing token display
- app.js:240-260 — renderSummary() aggregates batch-wide tokens/cost from laneStates
- app.js:310-345 — renderLanesTasks() renders worker-stats div per lane
- NEW: Extend worker-stats with retry/compaction badges; merge telemetry JSONL data

**Implementation guardrails:**
1. DO NOT remove or replace existing lane-state telemetry display — it works and is the primary source
2. Telemetry JSONL provides ADDITIONAL metrics (retries, compactions) and may supplement cost data
3. Avoid double-counting cost: if both lane-state and JSONL report cost, prefer lane-state (authoritative)
4. Handle missing .pi/telemetry/ directory gracefully — pre-RPC sessions won't have it
5. Incremental file reading: track byte offset per JSONL file to avoid re-parsing on each poll
6. Keep dashboard zero-dependency — no new npm packages

### Step 2 Design Decisions

**Field-level precedence (per metric):**
- **Tokens (↑↓):** lane-state primary; telemetry ignored when lane-state present (avoid double-count)
- **Cost (per-lane):** lane-state primary; telemetry only for lanes missing lane-state
- **Cost (batch total):** `currentData.batchTotalCost` from server (already deduped); fallback: sum from lane-states
- **Context %:** lane-state only (telemetry JSONL doesn't track context window %)
- **Last tool:** lane-state primary when running; telemetry supplementary for done/error lanes
- **Elapsed/tools:** lane-state only
- **Retries:** telemetry only (new metric — not in lane-state)
- **Compactions:** telemetry only (new metric — not in lane-state)

**Render matrix — when to show telemetry badges:**
- **Running task + lane-state present:** Show existing worker-stats from lane-state PLUS telemetry retry/compaction badges
- **Running task + telemetry only:** Show telemetry lastTool, retry badge, compaction badge (no lane-state tokens/elapsed)
- **Done/error task + telemetry present:** Show telemetry retry count + compaction count badges (compact summary)
- **Done/error task + no telemetry:** Show existing "✓ Worker done" / "✗ Worker error" — no telemetry badges
- **Pending task:** No worker stats, no telemetry badges
- **No telemetry + no lane-state:** No worker stats shown — graceful "—"

**UI placement:**
- Telemetry badges appended inside `.worker-stats` div after existing stats
- Compact chip style: small font, muted colors, icon prefix (🔄 retry, 🗜 compaction)
- Retry active state: yellow pulsing badge to indicate in-progress retry
- Batch cost in summary bar: use `batchTotalCost` from API response

### Step 4 Documentation Decision

Reviewed `docs/reference/commands.md` dashboard section (line 512-514). The section documents the `taskplane dashboard [--port <n>] [--no-open]` command with description "Launch the web dashboard server." This task adds real-time telemetry display (retry badges, compaction badges, batch total cost) as a **UI enhancement only** — no new CLI commands, no new flags, no new config keys. The dashboard is self-documenting via its UI. **No doc edit needed.**

### Step 1 Design Decisions

**Why read telemetry JSONL in the dashboard server:**
- Lane-state sidecar files (lane-state-*.json) already contain tokens, cost, retry counts, context % — the task-runner aggregates these from the JSONL
- BUT compaction count is NOT tracked by `tailSidecarJsonl()` in task-runner.ts — only in rpc-wrapper exit summary
- PROMPT forbids modifying task-runner.ts (TP-025/026 scope), so dashboard must read JSONL directly for compaction events
- Telemetry JSONL also provides data for lanes where lane-state files may not exist (edge cases)

**Lane attribution strategy:**
- Telemetry filenames follow: `{opId}-{batchId}-{repoId}[-{taskId}][-lane-{N}]-{role}.{ext}` (task-runner.ts:1488-1533)
- Extract lane number from `-lane-{N}-` segment in filename
- Map to tmux prefix using batch-state `lanes[*].laneNumber` → `lanes[*].tmuxSessionName`
- Worker + reviewer files for same lane are merged (accumulate tokens/cost/compactions)
- If no lane number in filename, it's standalone /task mode — skip or use as fallback

**API response contract (additive):**
- New field: `telemetry` in buildDashboardState() response, keyed by tmux prefix
- Contains: `{ compactions, retries, retryActive, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cost, lastTool, toolCalls }`
- Existing `laneStates` remains authoritative for tokens/cost — `telemetry` supplements with compaction count
- Frontend (Step 2) will merge both sources

**Tail state lifecycle:**
- Module-level `telemetryTailStates` Map<filename, {offset, partial}> persists across poll ticks
- On each poll: scan .pi/telemetry/ for *.jsonl files, create tail state for new files
- Clean up tail states for files that no longer exist (rotation/deletion)
- Partial-line buffering prevents split-line JSON parse errors
