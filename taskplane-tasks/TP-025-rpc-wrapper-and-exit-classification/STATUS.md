# TP-025: RPC Wrapper Script & Exit Classification Types — Status

**Current Step:** Step 1: Define TaskExitDiagnostic Type & Classification Logic
**Status:** 🟡 In Progress
**Last Updated:** 2026-03-19
**Review Level:** 2
**Review Counter:** 4
**Iteration:** 2
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
**Status:** ⬜ Not Started

- [ ] CLI arg parsing
- [ ] Spawn pi --mode rpc --no-session
- [ ] Send prompt via JSONL framing
- [ ] Route and capture RPC events to sidecar JSONL
- [ ] Redaction policy applied
- [ ] Live progress display on stderr
- [ ] Exit summary JSON on process exit
- [ ] Signal forwarding and crash handling

---

### Step 3: Testing & Verification
**Status:** ⬜ Not Started

- [ ] Unit tests for classifyExit()
- [ ] Unit tests for redaction logic
- [ ] Unit tests for exit summary accumulation
- [ ] Integration test with mock RPC process
- [ ] Full test suite passes
- [ ] rpc-wrapper.mjs runs

---

### Step 4: Documentation & Delivery
**Status:** ⬜ Not Started

- [ ] JSDoc on exported types and functions
- [ ] Usage comment in rpc-wrapper.mjs
- [ ] package.json files array updated
- [ ] `.DONE` created

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
