# Task: TP-025 — RPC Wrapper Script & Exit Classification Types

**Created:** 2026-03-19
**Size:** M

## Review Level: 2 (Plan and Code)

**Assessment:** New module with novel pattern (RPC protocol integration) affecting diagnostic foundation. Moderate blast radius across telemetry path.
**Score:** 4/8 — Blast radius: 1, Pattern novelty: 2, Security: 0, Reversibility: 1

## Canonical Task Folder

```
taskplane-tasks/TP-025-rpc-wrapper-and-exit-classification/
├── PROMPT.md   ← This file (immutable above --- divider)
├── STATUS.md   ← Execution state (worker updates this)
├── .reviews/   ← Reviewer output (task-runner creates this)
└── .DONE       ← Created when complete
```

## Mission

Build `rpc-wrapper.mjs` — a thin Node.js script that wraps `pi --mode rpc` to
capture structured telemetry from worker/reviewer sessions. Also define the
`TaskExitDiagnostic` TypeScript interface and classification logic. This is the
foundation for all downstream resilience work (retry intelligence, cost tracking,
dashboard telemetry, quality verification).

The wrapper spawns `pi --mode rpc --no-session` as a child process, sends the
prompt command, captures RPC events to a sidecar JSONL file, and writes a final
exit summary JSON on process exit. It also displays minimal progress in stdout
(step, iteration, last tool, tokens) for tmux pane visibility.

## Dependencies

- **None**

## Context to Read First

**Tier 2 (area context):**
- `taskplane-tasks/CONTEXT.md`

**Tier 3 (load only if needed):**
- `docs/specifications/taskplane/resilience-and-diagnostics-roadmap.md` — Phase 1 spec (Sections 1a, 1b, 1e)
- `C:/Users/HenryLach/AppData/Roaming/npm/node_modules/@mariozechner/pi-coding-agent/docs/rpc.md` — Pi RPC protocol spec
- `extensions/taskplane/types.ts` — Current type definitions for task outcomes
- `extensions/taskplane/naming.ts` — Naming contract for telemetry file paths

## Environment

- **Workspace:** `bin/` (wrapper script), `extensions/taskplane/` (types)
- **Services required:** None

## File Scope

- `bin/rpc-wrapper.mjs` (new)
- `extensions/taskplane/types.ts`
- `extensions/taskplane/diagnostics.ts` (new)
- `extensions/tests/rpc-wrapper.test.ts` (new)
- `extensions/tests/exit-classification.test.ts` (new)

## Steps

### Step 0: Preflight

- [ ] Read pi RPC docs to understand protocol: commands, events, framing
- [ ] Read `extensions/taskplane/types.ts` for current task outcome types
- [ ] Read `extensions/taskplane/naming.ts` for naming contract
- [ ] Read roadmap Phase 1 sections 1a, 1b, 1e

### Step 1: Define TaskExitDiagnostic Type & Classification Logic

Create `extensions/taskplane/diagnostics.ts` with:

- [ ] `TaskExitDiagnostic` interface with all classification fields (classification, exitCode, errorMessage, tokensUsed, contextPct, partialProgressCommits, partialProgressBranch, durationSec, lastKnownStep, lastKnownCheckbox, repoId)
- [ ] `classifyExit()` function that takes an exit summary object + `.DONE` existence boolean and returns the classification string
- [ ] `TokenCounts` interface (input, output, cacheRead, cacheWrite)
- [ ] Export types for use by task-runner and dashboard

**Artifacts:**
- `extensions/taskplane/diagnostics.ts` (new)

### Step 2: Build RPC Wrapper Script

Create `bin/rpc-wrapper.mjs`:

- [ ] Parse CLI args: `--sidecar-path`, `--exit-summary-path`, `--model`, `--system-prompt-file`, `--prompt-file`, `--tools`, `--extensions`, plus passthrough pi args
- [ ] Spawn `pi --mode rpc --no-session` with correct args as child process
- [ ] Send `prompt` command via stdin using JSONL framing (split on `\n` only, NOT readline — per RPC docs)
- [ ] Read and route RPC events from stdout: `message_end`, `tool_execution_start/end`, `auto_retry_start/end`, `auto_compaction_start/end`, `agent_end`
- [ ] Write captured events to sidecar JSONL file (append mode), applying redaction policy (strip env var values matching `*_KEY`, `*_TOKEN`, `*_SECRET`; truncate large tool args to 500 chars)
- [ ] Display minimal live progress on stderr for tmux pane: current tool call, cumulative tokens, cost
- [ ] On process exit, accumulate totals and write exit summary JSON (exitCode, tokens, cost, toolCalls, retries, compactions, durationSec, lastToolCall, error, classification)
- [ ] Handle signal forwarding (SIGTERM/SIGINT → `abort` RPC command → graceful shutdown)
- [ ] Handle pi process crash (non-zero exit, no agent_end event) — still write exit summary with what we have

**Artifacts:**
- `bin/rpc-wrapper.mjs` (new)

### Step 3: Testing & Verification

> ZERO test failures allowed.

- [ ] Unit tests for `classifyExit()` — all 9 classification paths
- [ ] Unit tests for redaction logic (secrets stripped, large args truncated)
- [ ] Unit tests for exit summary accumulation (token totals, retry aggregation)
- [ ] Integration test: mock pi RPC process, verify sidecar + summary output
- [ ] Run full test suite: `cd extensions && npx vitest run`
- [ ] Fix all failures
- [ ] Verify `rpc-wrapper.mjs` runs: `node bin/rpc-wrapper.mjs --help`

### Step 4: Documentation & Delivery

- [ ] Add JSDoc to all exported types and functions in `diagnostics.ts`
- [ ] Add usage comment at top of `rpc-wrapper.mjs`
- [ ] Update `package.json` `files` array to include `bin/rpc-wrapper.mjs`
- [ ] `.DONE` created in this folder

## Documentation Requirements

**Must Update:**
- `package.json` — Add `bin/rpc-wrapper.mjs` to files array

**Check If Affected:**
- `docs/explanation/architecture.md` — mention RPC wrapper in execution model
- `README.md` — if adding user-facing telemetry features

## Completion Criteria

- [ ] All steps complete
- [ ] All tests passing
- [ ] `classifyExit()` handles all 9 classification paths correctly
- [ ] `rpc-wrapper.mjs` produces valid sidecar JSONL and exit summary JSON
- [ ] Redaction strips secrets from sidecar output
- [ ] `.DONE` created

## Git Commit Convention

- **Step completion:** `feat(TP-025): complete Step N — description`
- **Bug fixes:** `fix(TP-025): description`
- **Tests:** `test(TP-025): description`
- **Hydration:** `hydrate: TP-025 expand Step N checkboxes`

## Do NOT

- Modify `task-runner.ts` spawn logic (that's TP-026)
- Modify the dashboard (that's TP-027)
- Change `/orch` subprocess spawn path — only target `/task` tmux and merge agent sessions
- Use Node.js `readline` for JSONL parsing (splits on Unicode line separators — see pi RPC docs)
- Persist unredacted secrets in sidecar or summary files

---

## Amendments (Added During Execution)
