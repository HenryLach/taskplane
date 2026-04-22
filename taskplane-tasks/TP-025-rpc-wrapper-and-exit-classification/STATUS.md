# TP-025: RPC Wrapper Script & Exit Classification Types — Status

**Current Step:** Step 4: Documentation & Delivery
**Status:** ✅ Complete
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 9
**Iteration:** 5
**Size:** M

---

### Step 0: Preflight
**Status:** ✅ Complete

- [x] Read pi RPC docs to understand protocol
- [x] Read current task outcome types
- [x] Read naming contract
- [x] Read roadmap Phase 1 sections
- [x] R002 fix: Normalize top-level state metadata to be consistent with step states
- [x] R002 fix: Deduplicate and fix Reviews table markdown formatting
- [x] R002 fix: Deduplicate Execution Log rows and add Step 0 complete event
- [x] R002 fix: Add preflight findings to Discoveries/Notes for downstream traceability

---

### Step 1: Define TaskExitDiagnostic Type & Classification Logic
**Status:** ✅ Complete

- [x] ExitClassification string-literal union (9 values) and TokenCounts interface
- [x] ExitClassificationInput structured input type with all runtime signals (exit summary, .DONE, timeout/stall/user-kill flags, context %)
- [x] TaskExitDiagnostic interface with all fields, using ExitClassification return type
- [x] classifyExit(input: ExitClassificationInput) with roadmap precedence: .DONE → api_error → context_overflow → wall_clock_timeout → process_crash → session_vanished → stall_timeout → user_killed → unknown
- [x] JSDoc precedence table on classifyExit and types
- [x] Re-export from extensions/taskplane/index.ts barrel
- [x] R004 fix: Remove TokenCounts re-export from diagnostics.ts to avoid duplicate export via barrel index.ts
- [x] R004 fix: Correct ExitSummary JSDoc — mark required non-nullable fields accurately or make them optional for crash tolerance

---

### Step 2: Build RPC Wrapper Script
**Status:** ✅ Complete

- [x] R005: Align exit-summary schema — `ExitSummary` is wrapper output (no classification field); classification deferred to `classifyExit()` consumer
- [x] R005: Single-write finalization — guard ensures exit summary written exactly once across close/error/signal handlers; deterministic precedence for exitCode/exitSignal/error
- [x] CLI arg parsing (--sidecar-path, --exit-summary-path, --model, --system-prompt-file, --prompt-file, --tools, --extensions, plus passthrough)
- [x] Spawn pi --mode rpc --no-session and send prompt via JSONL framing (split on \n only, NOT readline)
- [x] Route and capture RPC events to sidecar JSONL with redaction (strip *_KEY/*_TOKEN/*_SECRET env vars, truncate large tool args to 500 chars)
- [x] Live progress display on stderr (current tool, cumulative tokens, cost)
- [x] Exit summary JSON on process exit with single-write guard
- [x] Signal forwarding (SIGTERM/SIGINT → abort RPC command) and crash handling (non-zero exit, no agent_end)
- [x] R006 fix: Close stdin after agent_end/terminal response to prevent pi from hanging indefinitely
- [x] R006 fix: Use shell:true in spawn() to match task-runner.ts pattern and ensure Windows compatibility (pi.cmd shim)
- [x] R006 fix: Apply redaction to exit summary fields (error, lastToolCall) before writing — add redactSummary helper
- [x] R006 fix: Use --tools (comma-list) instead of repeated --tool flags to match task-runner.ts pattern
- [x] R006 fix: Normalize exit codes (negative/NaN/non-finite → 1) in both exit summary and process.exitCode

---

### Step 3: Testing & Verification
**Status:** ✅ Complete

- [x] Unit tests for classifyExit() — all 9 classifications + precedence collisions (table-driven)
- [x] Unit tests for redaction logic — sidecar events AND exit summary, including *_KEY/*_TOKEN/*_SECRET + truncation
- [x] Unit tests for exit summary accumulation (token totals, retry aggregation, single-write guard)
- [x] Unit tests for JSONL framing (split on \n, optional \r, trailing partial buffer)
- [x] Integration test: mock pi process (scripted fixture stdout), verify sidecar + summary artifacts
- [x] Full test suite passes: `cd extensions && npx vitest run`
- [x] rpc-wrapper.mjs runs: `node bin/rpc-wrapper.mjs --help`
- [x] R008 fix: Real integration test — run rpc-wrapper.mjs with mock pi script, assert sidecar JSONL entries and exit summary JSON contents
- [x] R008 fix: Process-level tests for exit summary lifecycle — spawn error fallback, crash without agent_end, exit code normalization (null/negative → 1), single-write guard
- [x] R008 fix: Remove dead/placeholder code from integration test (unused imports, no-op assertions)
- [x] R008 fix: Full test suite passes after changes
- [x] R008 fix: Replace no-op integration test with real subprocess integration (spawn mock-pi fixture, verify sidecar JSONL + exit summary JSON contents)
- [x] R008 fix: Add lifecycle finalization tests — multi-message_end token accumulation, retry/compaction aggregation, single-write guard across close/error/signal, spawn-error summary persistence
- [x] R008 fix: Full test suite passes after additions

---

### Step 4: Documentation & Delivery
**Status:** ✅ Complete

- [x] JSDoc on exported types and functions in diagnostics.ts
- [x] Usage comment at top of rpc-wrapper.mjs
- [x] package.json files array — verified: bin/ glob already covers bin/rpc-wrapper.mjs (24.9kB in npm pack --dry-run)
- [x] R009: Evaluate docs/explanation/architecture.md and README.md for impact — NOT AFFECTED: rpc-wrapper is internal infra not yet integrated (TP-026); README covers user-facing features only
- [x] R009: Completion gate — all 47 prior checkboxes checked, 955/955 tests pass, rpc-wrapper.mjs --help OK, npm pack --dry-run confirms packaging
- [x] `.DONE` created

---

## Reviews

| # | Type | Step | Verdict | File |
|---|------|------|---------|------|
| R001 | plan | Step 0 | APPROVE | .reviews/R001-plan-step0.md |
| R002 | code | Step 0 | REVISE | .reviews/R002-code-step0.md |
| R003 | plan | Step 1 | REVISE | .reviews/R003-plan-step1.md |
| R003 | plan | Step 1 | APPROVE | .reviews/R003-plan-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R004 | code | Step 1 | REVISE | .reviews/R004-code-step1.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R005 | plan | Step 2 | REVISE | .reviews/R005-plan-step2.md |
| R006 | plan | Step 3 | UNAVAILABLE | .reviews/R006-plan-step3.md |
| R006 | plan | Step 3 | REVISE | .reviews/R006-plan-step3.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R006 | code | Step 2 | REVISE | .reviews/R006-code-step2.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R007 | plan | Step 3 | REVISE | .reviews/R007-plan-step3.md |
| R008 | code | Step 3 | REVISE | .reviews/R008-code-step3.md |
| R008 | code | Step 3 | REVISE | .reviews/R008-code-step3.md |
| R009 | plan | Step 4 | REVISE | .reviews/R009-plan-step4.md |
| R009 | plan | Step 4 | APPROVE | .reviews/R009-plan-step4.md |

---

## Discoveries

| Discovery | Disposition | Location |
|-----------|-------------|----------|

---

## Execution Log

| Timestamp | Action | Outcome |
|-----------|--------|---------|
| 2026-03-19 | Task staged | PROMPT.md and STATUS.md created |
| 2026-03-19 18:01 | Task started | Extension-driven execution |
| 2026-03-19 18:01 | Step 0 started | Preflight |
| 2026-03-19 18:01 | Review R001 | plan Step 0: APPROVE |
| 2026-03-19 18:03 | Worker iter 1 | done in 83s, ctx: 28%, tools: 17 |
| 2026-03-19 18:05 | Review R002 | code Step 0: REVISE |
| 2026-03-19 18:05 | Step 0 reopened | R002 REVISE — fixing STATUS.md inconsistencies |
| 2026-03-19 18:07 | Review R003 | plan Step 1: REVISE |
| 2026-03-19 18:07 | Worker iter 1 | done in 157s, ctx: 28%, tools: 27 |
| 2026-03-19 18:07 | Step 0 complete | Preflight |
| 2026-03-19 18:07 | Step 1 started | Define TaskExitDiagnostic Type & Classification Logic |
| 2026-03-19 18:09 | Review R003 | plan Step 1: APPROVE |
| 2026-03-19 18:12 | Worker iter 2 | done in 309s, ctx: 22%, tools: 34 |
| 2026-03-19 18:15 | Worker iter 2 | done in 358s, ctx: 32%, tools: 29 |
| 2026-03-19 18:16 | Review R004 | code Step 1: REVISE |
| 2026-03-19 18:18 | Review R004 | code Step 1: REVISE |
| 2026-03-19 18:20 | Worker iter 2 | done in 225s, ctx: 15%, tools: 22 |
| 2026-03-19 18:20 | Step 1 complete | Define TaskExitDiagnostic Type & Classification Logic |
| 2026-03-19 18:20 | Step 2 started | Build RPC Wrapper Script |
| 2026-03-19 18:22 | Worker iter 2 | done in 207s, ctx: 15%, tools: 22 |
| 2026-03-19 18:22 | Step 1 complete | Define TaskExitDiagnostic Type & Classification Logic |
| 2026-03-19 18:22 | Step 2 started | Build RPC Wrapper Script |
| 2026-03-19 18:22 | Review R005 | plan Step 2: REVISE |
| 2026-03-19 18:23 | Review R005 | plan Step 2: REVISE |
| 2026-03-19 18:28 | Worker iter 3 | done in 282s, ctx: 30%, tools: 42 |
| 2026-03-19 18:28 | Task started | Extension-driven execution |
| 2026-03-19 18:28 | Step 3 started | Testing & Verification |
| 2026-03-19 18:30 | Task started | Extension-driven execution |
| 2026-03-19 18:30 | Step 3 started | Testing & Verification |
| 2026-03-19 18:30 | Reviewer R006 | plan review — reviewer did not produce output |
| 2026-03-19 18:30 | Review R006 | plan Step 3: UNAVAILABLE |
| 2026-03-19 18:31 | Review R006 | plan Step 3: REVISE |
| 2026-03-19 18:31 | Worker iter 4 | error (code 3221225794) in 0s, ctx: 0%, tools: 0 |
| 2026-03-19 18:31 | Worker iter 5 | error (code 3221225794) in 0s, ctx: 0%, tools: 0 |
| 2026-03-19 18:31 | Worker iter 6 | error (code 3221225794) in 0s, ctx: 0%, tools: 0 |
| 2026-03-19 18:31 | Step 3 blocked | No progress after 3 iterations |
| 2026-03-19 18:33 | Review R006 | code Step 2: REVISE |
| 2026-03-19 18:34 | Review R006 | code Step 2: REVISE |
| 2026-03-19 18:35 | Worker iter 3 | done in 154s, ctx: 19%, tools: 24 |
| 2026-03-19 18:35 | Step 2 complete | Build RPC Wrapper Script |
| 2026-03-19 18:35 | Step 3 started | Testing & Verification |
| 2026-03-19 18:36 | Review R007 | plan Step 3: REVISE |
| 2026-03-19 18:37 | Worker iter 3 | done in 149s, ctx: 18%, tools: 24 |
| 2026-03-19 18:37 | Step 2 complete | Build RPC Wrapper Script |
| 2026-03-19 18:37 | Step 3 started | Testing & Verification |
| 2026-03-19 18:38 | Review R007 | plan Step 3: REVISE |
| 2026-03-19 18:44 | Worker iter 4 | done in 380s, ctx: 28%, tools: 36 |
| 2026-03-19 18:44 | Worker iter 4 | done in 476s, ctx: 27%, tools: 48 |
| 2026-03-19 18:47 | Review R008 | code Step 3: REVISE |
| 2026-03-19 18:47 | Review R008 | code Step 3: REVISE |
| 2026-03-19 18:56 | Worker iter 4 | done in 546s, ctx: 36%, tools: 34 |
| 2026-03-19 18:56 | Step 3 complete | Testing & Verification |
| 2026-03-19 18:56 | Step 4 started | Documentation & Delivery |
| 2026-03-19 18:58 | Review R009 | plan Step 4: REVISE |
| 2026-03-19 18:59 | Worker iter 4 | done in 698s, ctx: 45%, tools: 48 |
| 2026-03-19 18:59 | Step 3 complete | Testing & Verification |
| 2026-03-19 18:59 | Step 4 started | Documentation & Delivery |
| 2026-03-19 18:59 | Review R009 | plan Step 4: APPROVE |
| 2026-03-19 19:02 | Worker iter 5 | error (code 3221225786) in 163s, ctx: 12%, tools: 16 |

---

## Blockers

*None*

---

## Notes

### Preflight Findings

**RPC Protocol (rpc.md):**
- JSONL framing: split on `\n` only, accept optional `\r\n` by stripping trailing `\r`. Do NOT use Node `readline` (splits on U+2028/U+2029).
- Commands: `prompt` (send message), `abort` (interrupt). Both return `{"type":"response"}`.
- Key events: `agent_start`, `agent_end`, `message_end` (has `usage` with token counts), `tool_execution_start/end`, `auto_retry_start/end`, `auto_compaction_start/end`.
- `message_end.message` contains `AssistantMessage` with `usage: {input, output, cacheRead, cacheWrite, cost}`.
- `get_session_stats` command returns aggregate tokens + cost if needed.
- Signal forwarding: send `{"type":"abort"}` via stdin for graceful shutdown.

**Current Types (types.ts):**
- `LaneTaskOutcome` has `exitReason: string` (free-text) — `TaskExitDiagnostic` will sit alongside this.
- `LaneTaskStatus`: `"pending" | "running" | "succeeded" | "failed" | "stalled" | "skipped"`.
- No token/cost types exist yet — `TokenCounts` interface is new.

**Naming Contract (naming.ts):**
- `sanitizeNameComponent()` for safe FS/git/tmux names.
- `resolveOperatorId()` chain: env → config → OS username → "op".
- Telemetry paths follow: `.pi/telemetry/{opId}-{batchId}-{repoId}-lane-{N}.{ext}`.

**Roadmap Phase 1:**
- 9 exit classifications: completed, api_error, context_overflow, wall_clock_timeout, process_crash, session_vanished, stall_timeout, user_killed, unknown.
- Classification precedence: .DONE → retries w/final failure → compactions+high ctx% → timer kill → non-zero exit → no summary → no progress → unknown.
- Redaction: strip `*_KEY`, `*_TOKEN`, `*_SECRET` env vars; truncate large tool args to 500 chars.
- Sidecar JSONL + exit summary JSON are the two output artifacts per session.
